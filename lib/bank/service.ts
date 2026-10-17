import { refreshBankSupplierLinks } from '../suppliers/bank.ts';
import { loadSelectedPreset, recordPreset } from "../presets/service.ts";
import type { PresetSelection } from "../presets/calculation.ts";
import { db, row, rows } from "../db.ts";
import { BankImportError, digest, parseCamt } from "./camt.ts";
import type { BankDetail } from "./camt.ts";
import { matchEntries } from "./matching.ts";
import type { LedgerCandidate, Match } from "./matching.ts";

export type BankEntry = {
  id: number; bank_account_id: number; account_id: number; account_name: string; account_iban: string;
  booking_date: string; value_date: string; amount_cents: number; counterparty: string; counterparty_iban: string;
  description: string; reference: string; bank_reference: string; service_reference: string; details: BankDetail[]; warning: string;
  transaction_id: number | null; resolution: string | null; reviewed_by: string | null;
};
export type Allocation = { accountId: number; amountCents: number; memo: string };
function fail(message: string): never { throw new BankImportError(message); }
const lock = async () => { await row("SELECT pg_advisory_xact_lock(713055)"); await row("SELECT pg_advisory_xact_lock(713053)"); };
export async function schemaReady() {
  return Boolean((await row<{ ready: boolean }>("SELECT to_regclass('bank_entries') IS NOT NULL AS ready"))?.ready);
}

export async function importStatement(xml: string, filename: string, accountId: number, actor: string) {
  const statements = parseCamt(xml);
  const hash = digest(xml);
  return db.transaction(async () => {
    await lock();
    const existing = await row<{ id: number; account_id: number }>(`SELECT i.id,a.account_id FROM bank_imports i JOIN bank_accounts a ON a.id=i.bank_account_id WHERE i.file_hash=?`, hash);
    if (existing) {
      if (existing.account_id !== accountId) fail("Dit afschrift is al toegewezen aan een andere grootboekrekening.");
      await refreshBankSupplierLinks(actor);
      return { id: existing.id, duplicate: true, added: 0 };
    }
    const account = await row<{ id: number }>("SELECT id FROM accounts WHERE id=? AND can_post=1 AND kind='asset'", accountId);
    if (!account) fail("Kies een boekbare activarekening voor de bankrekening.");
    const iban = statements[0].iban;
    let bank = await row<{ id: number; account_id: number }>("SELECT id,account_id FROM bank_accounts WHERE iban=?", iban);
    if (bank && bank.account_id !== accountId) fail("Dit IBAN is al gekoppeld aan een andere grootboekrekening.");
    if (!bank) {
      if (await row("SELECT id FROM bank_accounts WHERE account_id=?", accountId)) fail("Deze grootboekrekening wordt al gebruikt voor een ander IBAN.");
      const inserted = await db.prepare("INSERT INTO bank_accounts (iban,account_id) VALUES (?,?)").run(iban, accountId);
      bank = { id: inserted.lastInsertRowid!, account_id: accountId };
    }
    const imported = await db.prepare(`INSERT INTO bank_imports (file_hash,filename,source_xml,bank_account_id,statements,entry_count,imported_by)
      VALUES (?,?,?,?,?::jsonb,?,?)`).run(hash, filename.slice(0, 255), xml, bank.id,
      JSON.stringify(statements.map(s => ({ statementId: s.statementId, iban: s.iban, currency: s.currency, startDate: s.startDate, endDate: s.endDate, openingCents: s.openingCents, closingCents: s.closingCents }))), statements.reduce((n, s) => n + s.entries.length, 0), actor);
    let added = 0;
    for (const s of statements) for (const e of s.entries) {
      let stored = await row<{ id: number; amount_cents: number; booking_date: string }>("SELECT id,amount_cents,booking_date FROM bank_entries WHERE entry_key=?", e.key);
      if (stored && (stored.amount_cents !== e.amountCents || stored.booking_date !== e.bookingDate)) fail("Een eerder geïmporteerde bankreferentie heeft een andere datum of een ander bedrag. Controleer de bronafschriften.");
      if (!stored) {
        const created = await db.prepare(`INSERT INTO bank_entries (bank_account_id,entry_key,bank_reference,service_reference,booking_date,value_date,amount_cents,counterparty,counterparty_iban,reference,description,details,warning)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?::jsonb,?)`).run(bank.id, e.key, e.bankReference, e.serviceReference, e.bookingDate, e.valueDate, e.amountCents, e.name, e.iban, e.reference, e.description, JSON.stringify(e.details), e.warning);
        stored = { id: created.lastInsertRowid!, amount_cents: e.amountCents, booking_date: e.bookingDate };
        added++;
      }
      await db.prepare("INSERT INTO bank_import_entries (import_id,entry_id) VALUES (?,?) ON CONFLICT DO NOTHING").all(imported.lastInsertRowid, stored.id);
    }
    await db.prepare("UPDATE bank_imports SET new_count=? WHERE id=?").run(added, imported.lastInsertRowid);
    await refreshBankSupplierLinks(actor);
    return { id: imported.lastInsertRowid!, duplicate: false, added };
  })();
}

export async function getEntries(importId?: number) {
  return rows<BankEntry>(`SELECT e.*,b.account_id,b.iban account_iban,a.name account_name FROM bank_entries e
    JOIN bank_accounts b ON b.id=e.bank_account_id JOIN accounts a ON a.id=b.account_id
    ${importId ? "WHERE EXISTS (SELECT 1 FROM bank_import_entries ie WHERE ie.entry_id=e.id AND ie.import_id=?)" : ""}
    ORDER BY e.booking_date DESC,e.id DESC`, ...(importId ? [importId] : []));
}
export async function getEntry(id: number) {
  return row<BankEntry>(`SELECT e.*,b.account_id,b.iban account_iban,a.name account_name FROM bank_entries e
    JOIN bank_accounts b ON b.id=e.bank_account_id JOIN accounts a ON a.id=b.account_id WHERE e.id=?`, id);
}
export async function ledgerCandidates(accountId: number) {
  return rows<LedgerCandidate>(`SELECT t.id,t.transaction_date,t.description,t.reference,
    SUM(l.debit_cents-l.credit_cents) amount_cents,
    (SELECT COALESCE(SUM(x.debit_cents-x.credit_cents),0) FROM transaction_lines x WHERE x.transaction_id=t.id) difference
    FROM transactions t JOIN transaction_lines l ON l.transaction_id=t.id AND l.account_id=?
    WHERE NOT EXISTS (SELECT 1 FROM bank_entries e JOIN bank_accounts b ON b.id=e.bank_account_id WHERE e.transaction_id=t.id AND b.account_id=?)
    GROUP BY t.id ORDER BY t.transaction_date DESC`, accountId, accountId);
}
export async function getMatches(entries: BankEntry[]) {
  const matches = new Map<number, Match>();
  const allPending = (await getEntries()).filter(e => !e.transaction_id);
  for (const accountId of new Set(entries.map(e => e.account_id))) {
    // Include the complete pending inbox when checking whether two entries compete for one transaction.
    const pending = allPending.filter(e => e.account_id === accountId);
    for (const [id, match] of matchEntries(pending, await ledgerCandidates(accountId))) matches.set(id, match);
  }
  return matches;
}
async function pendingEntry(id: number) {
  const entry = await getEntry(id);
  if (!entry) fail("Bankmutatie niet gevonden.");
  if (entry.transaction_id) fail("Deze bankmutatie is al verwerkt. Vernieuw de pagina.");
  return entry;
}
async function audit(id: number, action: string, transactionId: number, actor: string) {
  await db.prepare("INSERT INTO bank_review_events (entry_id,action,transaction_id,actor) VALUES (?,?,?,?)").run(id, action, transactionId, actor);
}
async function setLink(entry: BankEntry, transactionId: number, actor: string, resolution: "linked" | "created") {
  await db.prepare("UPDATE bank_entries SET transaction_id=?,resolution=?,reviewed_by=?,reviewed_at=now() WHERE id=?").run(transactionId, resolution, actor, entry.id);
  await audit(entry.id, resolution, transactionId, actor);
  await refreshBankSupplierLinks(actor,[entry.id]);
}
async function link(entry: BankEntry, transactionId: number, actor: string, allowUnbalanced = false) {
  const candidate = (await ledgerCandidates(entry.account_id)).find(t => t.id === transactionId);
  if (!candidate || candidate.amount_cents !== entry.amount_cents) fail("De boeking moet ongekoppeld zijn en dezelfde bankrekening, hetzelfde bedrag en dezelfde betalingsrichting hebben.");
  if (candidate.difference !== 0 && !allowUnbalanced) fail("De bestaande boeking is niet in evenwicht. Bevestig deze waarschuwing om te koppelen zonder de boekingsregels te wijzigen.");
  await setLink(entry, transactionId, actor, "linked");
}
export async function linkEntry(id: number, transactionId: number, actor: string, allowUnbalanced: boolean) {
  return db.transaction(async () => { await lock(); await link(await pendingEntry(id), transactionId, actor, allowUnbalanced); })();
}
export async function confirmSuggested(ids: number[], actor: string) {
  if (!ids.length || ids.length > 10000 || new Set(ids).size !== ids.length) fail("Kies minstens één voorgestelde koppeling.");
  return db.transaction(async () => {
    await lock();
    const entries = (await getEntries()).filter(e => ids.includes(e.id));
    const matches = await getMatches(entries);
    if (entries.length !== ids.length) fail("Sommige bankmutaties zijn niet gevonden. Vernieuw de pagina.");
    for (const entry of entries) {
      const match = matches.get(entry.id);
      if (entry.transaction_id || !match?.suggestedId) fail("Een voorstel is gewijzigd. Vernieuw de pagina en controleer de koppelingen opnieuw.");
      await link(entry, match.suggestedId, actor);
    }
    return entries.length;
  })();
}
export async function unlinkEntry(id: number, actor: string) {
  return db.transaction(async () => {
    await lock(); const entry = await getEntry(id);
    if (!entry?.transaction_id) fail("Deze bankmutatie is al ontkoppeld.");
    await audit(id, "unlinked", entry.transaction_id, actor);
    await db.prepare("UPDATE bank_entries SET transaction_id=NULL,resolution=NULL,reviewed_by=NULL,reviewed_at=NULL WHERE id=?").run(id);
    await refreshBankSupplierLinks(actor,[id]);
  })();
}

export async function postEntry(id: number, description: string, projectId: number | null, allocations: Allocation[], actor: string, acknowledgeCandidates: boolean, selection?: PresetSelection, acknowledgeRefund = false) {
  return db.transaction(async () => {
    await lock(); const entry = await pendingEntry(id);
    const preset = selection ? await loadSelectedPreset(selection) : null;
    if (preset && entry.amount_cents > 0 && !acknowledgeRefund) fail("Bevestig de tegenboekingen voor deze terugbetaling.");
    if (!description.trim() || description.length > 1000) fail("Vul een omschrijving van maximaal 1.000 tekens in.");
    if (!allocations.length || allocations.length > 50) fail("Voeg 1 tot 50 boekingsregels toe.");
    if (allocations.some(a => !Number.isSafeInteger(a.amountCents) || !a.amountCents || a.accountId === entry.account_id)) fail("Elke boekingsregel heeft een bedrag en een andere grootboekrekening dan de bank nodig.");
    const sum = allocations.reduce((n, a) => n + BigInt(a.amountCents), BigInt(0));
    if (sum !== BigInt(Math.abs(entry.amount_cents))) fail("De boekingsregels moeten samen het volledige bankbedrag vormen.");
    const candidates = (await ledgerCandidates(entry.account_id)).filter(t => t.amount_cents === entry.amount_cents && Math.abs(Date.parse(t.transaction_date) - Date.parse(entry.booking_date)) <= 7 * 86400000);
    if (candidates.length && !acknowledgeCandidates) fail("Er zijn mogelijk bestaande boekingen gevonden. Controleer deze of bevestig dat u een afzonderlijke boeking aanmaakt.");
    if (projectId && !(await row("SELECT id FROM projects WHERE id=?", projectId))) fail("Project niet gevonden.");
    const accounts = await rows<{ id: number }>("SELECT id FROM accounts WHERE can_post=1");
    if (!accounts.some(a => a.id === entry.account_id)) fail("Op de grootboekrekening van de bank kan niet meer worden geboekt.");
    for (const a of allocations) if (!accounts.some(x => x.id === a.accountId)) fail("Elke boekingsregel heeft een geldige boekingsrekening nodig.");
    const created = await db.prepare("INSERT INTO transactions (transaction_date,description,reference,project_id) VALUES (?,?,?,?)").run(entry.booking_date, description.trim(), entry.reference || entry.bank_reference, projectId);
    const transactionId = created.lastInsertRowid!;
    const insert = async (accountId: number, signedDebit: number, memo: string) => {
      await db.prepare(`INSERT INTO transaction_lines (transaction_id,account_id,memo,debit_cents,credit_cents)
        VALUES (?,?,?,?,?)`).run(transactionId, accountId, memo, Math.max(signedDebit, 0), Math.max(-signedDebit, 0));
    };
    await insert(entry.account_id, entry.amount_cents, "Bankafschrift");
    for (const a of allocations) {
      const signedDebit = entry.amount_cents < 0 ? a.amountCents : -a.amountCents;
      await insert(a.accountId, signedDebit, a.memo.slice(0, 500));
    }
    if (preset) await recordPreset(transactionId, preset, entry.amount_cents, allocations, actor);
    await setLink(entry, transactionId, actor, "created");
    return transactionId;
  })();
}
