import { getSuppliers } from '@/lib/suppliers/service';
import { getBankSupplierLinks } from '@/lib/suppliers/bank';
import { BankSupplierForm } from '../../suppliers/bank-forms';
import { labelNl, bankWarningNl } from '@/lib/dutch';
import { getPresets, getPresetRules } from "@/lib/presets/service";
import { suggestPresets } from "@/lib/presets/calculation";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Field, PageHeader } from "@/components/ui";
import { rows } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { getEntry, getMatches, ledgerCandidates } from "@/lib/bank/service";
import { ActionForm, PostingForm } from "../forms";
import { reviewEntry } from "../actions";

export default async function BankEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const entry = await getEntry(id);
  if (!entry) notFound();
  const suppliers=await getSuppliers(),supplierLink=(await getBankSupplierLinks()).get(id);
  const supplierHistory=await rows<{supplier_name:string|null;mode:string;status:string;created_at:Date}>("SELECT s.name supplier_name,e.mode,e.status,e.created_at FROM bank_supplier_events e LEFT JOIN suppliers s ON s.id=e.supplier_id WHERE e.entry_id=? ORDER BY e.id DESC",id);
  const presets = await getPresets();
  const suggestions = suggestPresets(presets, await getPresetRules(), entry).map(p => p.id);
  const match = (await getMatches([entry])).get(id);
  const accounts = await rows<{ id: number; name: string; kind: string }>("SELECT id,name,kind FROM accounts WHERE can_post=1 ORDER BY sort_order,name");
  const projects = await rows<{ id: number; name: string }>("SELECT p.id,c.name || ' · ' || p.name name FROM projects p JOIN customers c ON c.id=p.customer_id ORDER BY c.name,p.name");
  const sources = await rows<{ id: number; filename: string; statements: { iban: string; openingCents: number; closingCents: number; startDate: string; endDate: string }[] }>("SELECT i.id,i.filename,i.statements FROM bank_imports i JOIN bank_import_entries ie ON ie.import_id=i.id WHERE ie.entry_id=? ORDER BY i.id", id);
  const history = await rows<{ action: string; transaction_id: number; created_at: Date }>("SELECT action,transaction_id,created_at FROM bank_review_events WHERE entry_id=? ORDER BY id DESC", id);
  const alternatives = entry.transaction_id ? [] : (await ledgerCandidates(entry.account_id)).filter(t => t.amount_cents === entry.amount_cents && !match?.candidates.some(c => c.id === t.id));
  return <>
    <PageHeader title={entry.counterparty || "Bankmutatie"} subtitle={`${formatDate(entry.booking_date)} · ${entry.account_name}`}><Link href="/bank" className="button">Terug naar bankafschriften</Link></PageHeader>
    <div className="bank-review-layout">
      <aside className="card bank-source">
        <div className="card-header"><h2 className="card-title">Afschriftregel</h2><strong className={`bank-amount ${entry.amount_cents > 0 ? "bank-ok" : ""}`}>{entry.amount_cents > 0 ? "+" : "−"}{formatMoney(Math.abs(entry.amount_cents))}</strong></div>
        <div className="card-body"><dl className="bank-facts">
          <div><dt>Boekdatum</dt><dd>{formatDate(entry.booking_date)}</dd></div><div><dt>Valutadatum</dt><dd>{formatDate(entry.value_date)}</dd></div>
          <div><dt>Bankrekening</dt><dd>{entry.account_iban}</dd></div>
          {entry.counterparty_iban && <div><dt>IBAN tegenpartij</dt><dd>{entry.counterparty_iban}</dd></div>}
          <div><dt>Omschrijving</dt><dd>{entry.description || "—"}</dd></div><div><dt>Betalingskenmerk</dt><dd>{entry.reference || "—"}</dd></div><div><dt>Bankreferentie</dt><dd>{entry.bank_reference || entry.service_reference}</dd></div>
        </dl>
        {entry.warning && <p className="bank-message warning">{bankWarningNl(entry.warning)}</p>}
        {entry.details.length > 1 && <details open><summary>Afzonderlijke betalingen ({entry.details.length})</summary><ul className="bank-batch">{entry.details.map((d, i) => <li key={i}><strong>{d.name || "Betaling"} {d.amountCents === null ? "" : formatMoney(d.amountCents)}</strong><p>{d.description}</p><p>{d.reference}</p></li>)}</ul></details>}
        <details className="bank-history"><summary>Bronafschriften</summary>{sources.map(s => <div key={s.id}><Link className="row-link" href={`/bank?import=${s.id}&view=all`}>{s.filename}</Link>{s.statements.map((statement, index) => <p className="secondary" key={index}>{formatDate(statement.startDate)} – {formatDate(statement.endDate)}<br/>{formatMoney(statement.openingCents)} beginsaldo · {formatMoney(statement.closingCents)} eindsaldo<br/>Afschriftsaldi gecontroleerd</p>)}</div>)}</details>
        {history.length > 0 && <details className="bank-history"><summary>Controlehistorie</summary><ul>{history.map((h, i) => <li key={i}>{labelNl(h.action)} boeking #{h.transaction_id}<span>{h.created_at.toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam" })}</span></li>)}</ul></details>}
        </div>
      </aside>
      <div className="grid">
        <BankSupplierForm key={`${id}-${supplierLink?.version??0}`} entry={entry} suppliers={suppliers} link={supplierLink}/>
        {supplierHistory.length>0&&<details className="bank-history"><summary>Historie leverancierskoppeling</summary><ul>{supplierHistory.map((h,i)=><li key={i}>{h.supplier_name??(h.status==='ambiguous'?'Meerdere leveranciers':h.status==='batch'?'Verzamelbetaling':'Geen leverancier')} · {h.mode==='manual'?'handmatig':'automatisch'}<span>{h.created_at.toLocaleString('nl-NL',{timeZone:'Europe/Amsterdam'})}</span></li>)}</ul></details>}
        {entry.transaction_id ? <section className="card"><div className="card-header"><h2 className="card-title">Bankmutatie verwerkt</h2><span className="badge paid">{entry.resolution === "created" ? "Geboekt" : "Gekoppeld"}</span></div><div className="card-body"><p className="bank-help">Deze bankmutatie is gekoppeld aan boeking #{entry.transaction_id}. Bij het importeren van een overlappend afschrift wordt deze herkend.</p><Link className="button primary" href={`/transactions/${entry.transaction_id}`}>Boeking bekijken</Link><hr className="divider"/><details><summary>Koppeling corrigeren</summary><p className="bank-help">Na het ontkoppelen moet u deze bankmutatie opnieuw controleren. De boeking blijft bestaan, ook als deze tijdens het importeren is aangemaakt.</p><ActionForm action={reviewEntry.bind(null, id)}><input type="hidden" name="action" value="unlink"/><button className="button">Boeking ontkoppelen</button></ActionForm></details></div></section> : <>
          <section className="card"><div className="card-header"><div><h2 className="card-title">Koppelen aan een bestaande boeking</h2><p className="card-description">Dezelfde bankrekening, hetzelfde bedrag en dezelfde betalingsrichting. Voorgestelde datums kunnen maximaal zeven dagen afwijken.</p></div></div><div className="card-body">
            {match?.candidates.length ? <div className="bank-candidates">{match.candidates.map(c => <article className="bank-candidate" key={c.id}>
              <div className="bank-toolbar"><Link className="row-link" href={`/transactions/${c.id}`} target="_blank">#{c.id} · {c.description}</Link><span className={`badge ${match.suggestedId === c.id ? "active" : "draft"}`}>{match.suggestedId === c.id ? "Voorgesteld" : "Koppeling controleren"}</span></div>
              <p className="secondary">{formatDate(c.transaction_date)} · {formatMoney(c.amount_cents)}</p><ul className="bank-reasons">{c.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
              <ActionForm action={reviewEntry.bind(null, id)}><input type="hidden" name="action" value="link"/><input type="hidden" name="transaction_id" value={c.id}/>{c.difference !== 0 && <label className="bank-check"><input type="checkbox" name="allow_unbalanced" required/>Koppelen zonder het bestaande {formatMoney(Math.abs(c.difference))} boekingsverschil te corrigeren.</label>}<button className="button soft">Deze boeking koppelen</button></ActionForm>
            </article>)}</div> : <p className="bank-help">Binnen zeven dagen is geen ongekoppelde boeking met dit bedrag en deze betalingsrichting gevonden.</p>}
            <details className="bank-history"><summary>Boeking met een andere datum zoeken</summary><p className="bank-help">Alleen ongekoppelde boekingen met hetzelfde bankbedrag en dezelfde betalingsrichting kunnen worden gekoppeld.</p><ActionForm action={reviewEntry.bind(null, id)}><input type="hidden" name="action" value="link"/><Field label="Boeking" name="transaction_id"><select id="transaction_id" name="transaction_id" required><option value="">Kies een boeking</option>{alternatives.map(t => <option key={t.id} value={t.id}>#{t.id} · {t.transaction_date} · {t.description}{t.difference ? " (niet in evenwicht)" : ""}</option>)}</select></Field><label className="bank-check"><input type="checkbox" name="allow_unbalanced"/>Koppelen toestaan als de bestaande boeking niet in evenwicht is.</label><button className="button">Geselecteerde boeking koppelen</button></ActionForm></details>
          </div></section>
          <section className="card"><div className="card-header"><div><h2 className="card-title">Nieuwe boeking verwerken</h2><p className="card-description">Gebruik dit als de betaling nog niet is geboekt.</p></div></div><div className="card-body"><PostingForm entryId={id} amountCents={entry.amount_cents} bankAccountId={entry.account_id} description={[entry.counterparty, entry.description || entry.reference].filter(Boolean).join(" · ").slice(0,1000)} accounts={accounts} projects={projects} hasCandidates={Boolean(match?.candidates.length)} presets={presets} suggestions={suggestions}/></div></section>
        </>}
      </div>
    </div>
  </>;
}
