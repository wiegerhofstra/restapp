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
  const presets = await getPresets();
  const suggestions = suggestPresets(presets, await getPresetRules(), entry).map(p => p.id);
  const match = (await getMatches([entry])).get(id);
  const accounts = await rows<{ id: number; name: string; kind: string }>("SELECT id,name,kind FROM accounts WHERE can_post=1 ORDER BY sort_order,name");
  const projects = await rows<{ id: number; name: string }>("SELECT p.id,c.name || ' · ' || p.name name FROM projects p JOIN customers c ON c.id=p.customer_id ORDER BY c.name,p.name");
  const sources = await rows<{ id: number; filename: string; statements: { iban: string; openingCents: number; closingCents: number; startDate: string; endDate: string }[] }>("SELECT i.id,i.filename,i.statements FROM bank_imports i JOIN bank_import_entries ie ON ie.import_id=i.id WHERE ie.entry_id=? ORDER BY i.id", id);
  const history = await rows<{ action: string; transaction_id: number; created_at: Date }>("SELECT action,transaction_id,created_at FROM bank_review_events WHERE entry_id=? ORDER BY id DESC", id);
  const alternatives = entry.transaction_id ? [] : (await ledgerCandidates(entry.account_id)).filter(t => t.amount_cents === entry.amount_cents && !match?.candidates.some(c => c.id === t.id));
  return <>
    <PageHeader title={entry.counterparty || "Bank payment"} subtitle={`${formatDate(entry.booking_date)} · ${entry.account_name}`}><Link href="/bank" className="button">Back to bank imports</Link></PageHeader>
    <div className="bank-review-layout">
      <aside className="card bank-source">
        <div className="card-header"><h2 className="card-title">Statement entry</h2><strong className={`bank-amount ${entry.amount_cents > 0 ? "bank-ok" : ""}`}>{entry.amount_cents > 0 ? "+" : "−"}{formatMoney(Math.abs(entry.amount_cents))}</strong></div>
        <div className="card-body"><dl className="bank-facts">
          <div><dt>Booking date</dt><dd>{formatDate(entry.booking_date)}</dd></div><div><dt>Value date</dt><dd>{formatDate(entry.value_date)}</dd></div>
          <div><dt>Bank account</dt><dd>{entry.account_iban}</dd></div>
          {entry.counterparty_iban && <div><dt>Counterparty IBAN</dt><dd>{entry.counterparty_iban}</dd></div>}
          <div><dt>Description</dt><dd>{entry.description || "—"}</dd></div><div><dt>Payment reference</dt><dd>{entry.reference || "—"}</dd></div><div><dt>Bank reference</dt><dd>{entry.bank_reference || entry.service_reference}</dd></div>
        </dl>
        {entry.warning && <p className="bank-message warning">{entry.warning}</p>}
        {entry.details.length > 1 && <details open><summary>Individual payments ({entry.details.length})</summary><ul className="bank-batch">{entry.details.map((d, i) => <li key={i}><strong>{d.name || "Payment"} {d.amountCents === null ? "" : formatMoney(d.amountCents)}</strong><p>{d.description}</p><p>{d.reference}</p></li>)}</ul></details>}
        <details className="bank-history"><summary>Source statements</summary>{sources.map(s => <div key={s.id}><Link className="row-link" href={`/bank?import=${s.id}&view=all`}>{s.filename}</Link>{s.statements.map((statement, index) => <p className="secondary" key={index}>{formatDate(statement.startDate)} – {formatDate(statement.endDate)}<br/>{formatMoney(statement.openingCents)} opening · {formatMoney(statement.closingCents)} closing<br/>Statement balances verified</p>)}</div>)}</details>
        {history.length > 0 && <details className="bank-history"><summary>Review history</summary><ul>{history.map((h, i) => <li key={i}>{h.action} transaction #{h.transaction_id}<span>{h.created_at.toLocaleString("en-NL", { timeZone: "Europe/Amsterdam" })}</span></li>)}</ul></details>}
        </div>
      </aside>
      <div className="grid">
        {entry.transaction_id ? <section className="card"><div className="card-header"><h2 className="card-title">Payment processed</h2><span className="badge paid">{entry.resolution === "created" ? "Posted" : "Linked"}</span></div><div className="card-body"><p className="bank-help">This bank entry is linked to transaction #{entry.transaction_id}. It will be recognised when you import an overlapping statement.</p><Link className="button primary" href={`/transactions/${entry.transaction_id}`}>View accounting transaction</Link><hr className="divider"/><details><summary>Correct this match</summary><p className="bank-help">Unlinking returns this entry to review. The accounting transaction is kept, including any transaction created during import.</p><ActionForm action={reviewEntry.bind(null, id)}><input type="hidden" name="action" value="unlink"/><button className="button">Unlink transaction</button></ActionForm></details></div></section> : <>
          <section className="card"><div className="card-header"><div><h2 className="card-title">Match an existing transaction</h2><p className="card-description">Same bank account, amount and direction. Suggested dates can differ by up to seven days.</p></div></div><div className="card-body">
            {match?.candidates.length ? <div className="bank-candidates">{match.candidates.map(c => <article className="bank-candidate" key={c.id}>
              <div className="bank-toolbar"><Link className="row-link" href={`/transactions/${c.id}`} target="_blank">#{c.id} · {c.description}</Link><span className={`badge ${match.suggestedId === c.id ? "active" : "draft"}`}>{match.suggestedId === c.id ? "Suggested" : "Check match"}</span></div>
              <p className="secondary">{formatDate(c.transaction_date)} · {formatMoney(c.amount_cents)}</p><ul className="bank-reasons">{c.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
              <ActionForm action={reviewEntry.bind(null, id)}><input type="hidden" name="action" value="link"/><input type="hidden" name="transaction_id" value={c.id}/>{c.difference !== 0 && <label className="bank-check"><input type="checkbox" name="allow_unbalanced" required/>Link without correcting the existing {formatMoney(Math.abs(c.difference))} ledger imbalance.</label>}<button className="button soft">Link this transaction</button></ActionForm>
            </article>)}</div> : <p className="bank-help">No unlinked transaction with this amount and direction was found within seven days.</p>}
            <details className="bank-history"><summary>Find a transaction with another date</summary><p className="bank-help">Only unlinked transactions with the exact bank amount and direction can be linked.</p><ActionForm action={reviewEntry.bind(null, id)}><input type="hidden" name="action" value="link"/><Field label="Transaction" name="transaction_id"><select id="transaction_id" name="transaction_id" required><option value="">Choose a transaction</option>{alternatives.map(t => <option key={t.id} value={t.id}>#{t.id} · {t.transaction_date} · {t.description}{t.difference ? " (unbalanced)" : ""}</option>)}</select></Field><label className="bank-check"><input type="checkbox" name="allow_unbalanced"/>Allow linking if the existing transaction is unbalanced.</label><button className="button">Link selected transaction</button></ActionForm></details>
          </div></section>
          <section className="card"><div className="card-header"><div><h2 className="card-title">Post a new transaction</h2><p className="card-description">Use this when the payment has not been recorded yet.</p></div></div><div className="card-body"><PostingForm entryId={id} amountCents={entry.amount_cents} bankAccountId={entry.account_id} description={[entry.counterparty, entry.description || entry.reference].filter(Boolean).join(" · ").slice(0,1000)} accounts={accounts} projects={projects} hasCandidates={Boolean(match?.candidates.length)} presets={presets} suggestions={suggestions}/></div></section>
        </>}
      </div>
    </div>
  </>;
}
