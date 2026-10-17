import { labelNl } from '../dutch.ts';
import { db, row, rows } from '../db.ts';
import { calculatePreset, PresetError } from './calculation.ts';
import type { Allocation, Preset, PresetRule, PresetSelection } from './calculation.ts';

export async function presetsReady() {
  return Boolean((await row<{ ready: boolean }>("SELECT to_regclass('posting_presets') IS NOT NULL ready"))?.ready);
}
export async function getPresets(includeInactive = false) {
  if (!await presetsReady()) return [];
  return rows<Preset>(`SELECT id,name,version,active,expense_account_id,vat_mode,rate_bps,input_vat_account_id,output_vat_account_id,project_id FROM posting_presets ${includeInactive ? '' : 'WHERE active'} ORDER BY name,id`);
}
export async function getPresetRules() {
  return await presetsReady() ? rows<PresetRule>('SELECT * FROM posting_preset_rules ORDER BY id') : [];
}
export async function validatePresetAccounts(preset: Omit<Preset, 'id' | 'version'>) {
  const expected: [number | null, string][] = [[preset.expense_account_id, 'expense']];
  if (preset.vat_mode !== 'none') expected.push([preset.input_vat_account_id, 'asset']);
  if (preset.vat_mode === 'reverse') expected.push([preset.output_vat_account_id, 'liability']);
  if (new Set(expected.map(([id]) => id)).size !== expected.length) throw new PresetError("Kies verschillende rekeningen voor kosten en btw.");
  for (const [id, kind] of expected) {
    if (!await row('SELECT 1 FROM accounts WHERE id=? AND kind=? AND can_post=1', id, kind)) throw new PresetError(`Kies een boekbare rekening van het type ${labelNl(kind)} voor het sjabloon.`);
  }
  if (preset.project_id && !await row('SELECT 1 FROM projects WHERE id=?', preset.project_id)) throw new PresetError("Het project bestaat niet meer.");
}
export async function loadSelectedPreset(selection: PresetSelection) {
  const preset = await row<Preset>('SELECT * FROM posting_presets WHERE id=? FOR SHARE', selection.id);
  if (!preset?.active) throw new PresetError("Dit sjabloon is niet meer actief. Vernieuw de pagina en kies een ander sjabloon.");
  if (preset.version !== selection.version) throw new PresetError("Dit sjabloon is gewijzigd. Vernieuw de pagina en pas het opnieuw toe voordat u boekt.");
  await validatePresetAccounts(preset);
  return preset;
}
export async function validateAllocations(allocations: Allocation[], bankAccountId: number, total: number) {
  if (!allocations.length || allocations.length > 50) throw new PresetError("Voeg 1 tot 50 boekingsregels toe.");
  let sum = BigInt(0);
  for (const a of allocations) {
    if (!Number.isSafeInteger(a.amountCents) || !a.amountCents || a.accountId === bankAccountId) throw new PresetError("Elke boekingsregel heeft een bedrag ongelijk aan nul en een andere rekening dan de bank nodig.");
    if (!await row('SELECT 1 FROM accounts WHERE id=? AND can_post=1', a.accountId)) throw new PresetError("Een rekening in de boekingsregels is niet meer beschikbaar.");
    sum += BigInt(a.amountCents);
  }
  if (sum !== BigInt(total)) throw new PresetError("De boekingsregels moeten samen het volledige betalingsbedrag vormen.");
}
export async function recordPreset(transactionId: number, preset: Preset, signedBankAmount: number, allocations: Allocation[], actor: string) {
  await db.prepare(`INSERT INTO transaction_preset_applications(transaction_id,preset_id,snapshot,actor) VALUES(?,?,?::jsonb,?)`).run(
    transactionId, preset.id, JSON.stringify({ preset, signedBankAmount, generated: calculatePreset(preset, Math.abs(signedBankAmount)).allocations, posted: allocations }), actor);
}
export async function savePreset(id: number | null, version: number | null, preset: Omit<Preset, 'id' | 'version'>) {
  if (!preset.name.trim() || preset.name.length > 100) throw new PresetError("Gebruik een sjabloonnaam van 1 tot 100 tekens.");
  calculatePreset({ ...preset, id: id ?? 0, version: version ?? 1 }, 10000);
  return db.transaction(async () => {
    await validatePresetAccounts(preset);
    const values = [preset.name.trim(), preset.active, preset.expense_account_id, preset.vat_mode, preset.rate_bps, preset.input_vat_account_id, preset.output_vat_account_id, preset.project_id];
    if (id) {
      const result = await db.prepare(`UPDATE posting_presets SET name=?,active=?,expense_account_id=?,vat_mode=?,rate_bps=?,input_vat_account_id=?,output_vat_account_id=?,project_id=?,version=version+1 WHERE id=? AND version=?`).run(...values, id, version);
      if (!result.changes) throw new PresetError("Dit sjabloon is in een ander venster gewijzigd. Vernieuw de pagina voordat u opslaat.");
      return id;
    }
    return (await db.prepare(`INSERT INTO posting_presets(name,active,expense_account_id,vat_mode,rate_bps,input_vat_account_id,output_vat_account_id,project_id) VALUES(?,?,?,?,?,?,?,?)`).run(...values)).lastInsertRowid;
  })();
}
export async function saveRule(presetId: number, field: string, pattern: string, direction: string) {
  pattern = field === 'iban' ? pattern.replace(/\s/g, '').toUpperCase() : pattern.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!['iban', 'name', 'description'].includes(field) || !['payment', 'refund', 'both'].includes(direction) || pattern.length < 3 || pattern.length > 200) throw new PresetError("Kies een herkenningsveld, betalingsrichting en specifieke tekst van 3 tot 200 tekens.");
  if (field === 'iban' && !/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(pattern)) throw new PresetError("Vul het volledige IBAN van de tegenpartij in.");
  if (!await row('SELECT 1 FROM posting_presets WHERE id=?', presetId)) throw new PresetError("Het sjabloon bestaat niet meer.");
  await db.prepare(`INSERT INTO posting_preset_rules(preset_id,field,pattern,direction) VALUES(?,?,?,?) ON CONFLICT DO NOTHING`).run(presetId, field, pattern, direction);
}
export async function applyManualPreset(transactionId: number, selection: PresetSelection, bankAccountId: number, amount: number, basis: 'total' | 'net', refund: boolean, acknowledgeRefund: boolean, allocations: Allocation[], projectId: number | null, actor: string) {
  return db.transaction(async () => {
    await row('SELECT pg_advisory_xact_lock(713053)');
    if (!await row('SELECT 1 FROM transactions WHERE id=? FOR UPDATE', transactionId)) throw new PresetError("De boeking bestaat niet meer.");
    if (await row('SELECT 1 FROM transaction_lines WHERE transaction_id=? LIMIT 1', transactionId)) throw new PresetError("Deze boeking bevat al regels. Sjablonen kunnen alleen op een lege boeking worden toegepast.");
    if (refund && !acknowledgeRefund) throw new PresetError("Bevestig de tegenboekingen voor deze terugbetaling.");
    const preset = await loadSelectedPreset(selection);
    const { total } = calculatePreset(preset, amount, basis);
    if (!await row("SELECT 1 FROM accounts WHERE id=? AND kind='asset' AND can_post=1", bankAccountId)) throw new PresetError("Kies een boekbare activarekening voor de bank.");
    if (projectId && !await row('SELECT 1 FROM projects WHERE id=?', projectId)) throw new PresetError("Het project bestaat niet meer.");
    await validateAllocations(allocations, bankAccountId, total);
    const sign = refund ? -1 : 1;
    const insert = async (accountId: number, signed: number, memo: string) => db.prepare('INSERT INTO transaction_lines(transaction_id,account_id,memo,debit_cents,credit_cents) VALUES(?,?,?,?,?)').run(transactionId, accountId, memo.slice(0, 500), Math.max(signed, 0), Math.max(-signed, 0));
    await insert(bankAccountId, -total * sign, refund ? "Terugbetaling ontvangen" : "Betaling");
    for (const a of allocations) await insert(a.accountId, a.amountCents * sign, a.memo);
    await db.prepare('UPDATE transactions SET project_id=? WHERE id=?').run(projectId, transactionId);
    await recordPreset(transactionId, preset, -total * sign, allocations, actor);
  })();
}
