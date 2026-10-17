import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/ui";
import { rows } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { getEntries, getMatches, schemaReady } from "@/lib/bank/service";
import { ActionForm, SelectSuggested, UploadForm } from "./forms";
import { reviewSuggested } from "./actions";

export default async function BankPage({ searchParams }: { searchParams: Promise<{ import?: string; view?: string; q?: string; uploaded?: string }> }) {
  const query = await searchParams;
  if (!await schemaReady()) return <><PageHeader title="Bank imports"/><div className="bank-message">Bank imports need a database update. Run <code>npm run migrate:bank</code>, then reload this page.</div></>;
  const accounts = await rows<{ id: number; name: string }>("SELECT id,name FROM accounts WHERE can_post=1 AND kind='asset' ORDER BY sort_order,name");
  const imports = await rows<{ id: number; filename: string; entry_count: number; new_count: number; created_at: Date }>("SELECT id,filename,entry_count,new_count,created_at FROM bank_imports ORDER BY id DESC LIMIT 100");
  const importId = Number.isSafeInteger(Number(query.import)) && Number(query.import) > 0 ? Number(query.import) : undefined;
  const entries = await getEntries(importId);
  const matches = await getMatches(entries);
  const pending = entries.filter(e => !e.transaction_id);
  const suggested = pending.filter(e => matches.get(e.id)?.suggestedId);
  const possible = pending.filter(e => !matches.get(e.id)?.suggestedId && matches.get(e.id)?.candidates.length);
  const view = ["suggested", "review", "new", "processed", "all"].includes(query.view ?? "") ? query.view! : "pending";
  const search = (query.q ?? "").trim().toLowerCase();
  const visible = entries.filter(e => {
    const match = matches.get(e.id);
    const included = view === "all" || (view === "processed" ? Boolean(e.transaction_id) : !e.transaction_id && (view === "pending" || (view === "suggested" ? match?.suggestedId : view === "review" ? !match?.suggestedId && match?.candidates.length : !match?.candidates.length)));
    return included && (!search || `${e.counterparty} ${e.description} ${e.reference} ${e.amount_cents / 100}`.toLowerCase().includes(search));
  });
  const href = (tab: string) => `/bank?${new URLSearchParams({ ...(importId ? { import: String(importId) } : {}), view: tab, ...(search ? { q: search } : {}) })}`;
  return <>
    <PageHeader title="Bank imports" subtitle="Match your statement to existing transactions, then review and post new payments."><Link href="/transactions" className="button">View ledger</Link></PageHeader>
    {query.uploaded && <div role="status" className="bank-message">{query.uploaded === "duplicate" ? "This file was already imported. Your earlier review is preserved." : "Statement balances verified. New bank entries are ready for review; nothing has been posted to the ledger."}</div>}
    <section className="card bank-upload-card"><div className="card-header"><div><h2 className="card-title">Import a statement</h2><p className="card-description">Overlapping periods are safe: previously imported bank references are recognised.</p></div></div><div className="card-body"><UploadForm accounts={accounts} defaultAccount={accounts.find(a => /ing.*bank|bank.*ing/i.test(a.name))?.id}/></div></section>
    <nav className="bank-tabs" aria-label="Bank entry status">{[["pending", `To process (${pending.length})`], ["suggested", `Suggested (${suggested.length})`], ["review", `Check matches (${possible.length})`], ["new", `No match (${pending.length - suggested.length - possible.length})`], ["processed", `Processed (${entries.length - pending.length})`], ["all", "All"]].map(([key, label]) => <Link key={key} href={href(key)} className={view === key ? "active" : ""} aria-current={view === key ? "page" : undefined}>{label}</Link>)}</nav>
    <section className="card flush">
      <form className="bank-filter"><label className="sr-only" htmlFor="bank-search">Search bank entries</label><input id="bank-search" name="q" defaultValue={query.q} placeholder="Search name, reference or amount"/><input type="hidden" name="view" value={view}/><label className="sr-only" htmlFor="import-filter">Statement</label><select id="import-filter" name="import" defaultValue={importId ?? ""}><option value="">All statements</option>{imports.map(i => <option key={i.id} value={i.id}>{i.filename}</option>)}</select><button className="button small">Filter</button>{(importId || search) && <Link href="/bank" className="button small">Clear</Link>}</form>
      {visible.length ? <ActionForm action={reviewSuggested}>
        {visible.some(e => matches.get(e.id)?.suggestedId) && <div className="bank-bulk"><span>Select the suggested matches you agree with. Linking preserves the existing transaction.</span><SelectSuggested/><button className="button soft small">Confirm selected matches</button></div>}
        <div className="table-wrap"><table className="data-table bank-table"><thead><tr><th><span className="sr-only">Select match</span></th><th>Date</th><th>Bank payment</th><th className="numeric">Amount</th><th>Reconciliation</th><th/></tr></thead><tbody>{visible.map(e => {
          const match = matches.get(e.id), candidate = match?.candidates[0];
          const label = e.transaction_id ? "Processed" : match?.suggestedId ? "Suggested match" : candidate ? "Check match" : "No match";
          return <tr key={e.id}><td>{match?.suggestedId && <input type="checkbox" name="entry_id" value={e.id} aria-label={`Confirm match for ${e.counterparty || e.description} on ${e.booking_date}`}/>}</td><td className="bank-date">{formatDate(e.booking_date)}</td><td><Link className="row-link" href={`/bank/${e.id}`}>{e.counterparty || (e.description.length > 65 ? `${e.description.slice(0, 65)}…` : e.description) || "Bank payment"}</Link><div className="secondary bank-description">{e.description || e.reference}</div>{e.warning && <div className="bank-warning">Batch requires review</div>}</td><td className={`numeric ${e.amount_cents > 0 ? "bank-ok" : ""}`}>{e.amount_cents > 0 ? "+" : "−"}{formatMoney(Math.abs(e.amount_cents))}</td><td><span className={`badge ${e.transaction_id ? "paid" : match?.suggestedId ? "active" : "draft"}`}>{label}</span>{e.transaction_id ? <div className="secondary"><Link href={`/transactions/${e.transaction_id}`}>Transaction #{e.transaction_id}</Link></div> : candidate ? <><div className="secondary">#{candidate.id} · {candidate.description}</div><div className="secondary">{candidate.reasons.slice(1).join(" · ")}{match!.candidates.length > 1 ? ` · ${match!.candidates.length} possibilities` : ""}</div></> : <div className="secondary">Choose accounts before posting</div>}</td><td><Link href={`/bank/${e.id}`} className="button small">{e.transaction_id ? "View" : "Review"}</Link></td></tr>;
        })}</tbody></table></div>
      </ActionForm> : <EmptyState title={entries.length ? "No entries in this view" : "Your bank inbox is empty"} copy={entries.length ? "Choose another status or import your next statement." : "Upload an ING CAMT.053 file to match your existing bookkeeping."}/>}
    </section>
    {imports.length > 0 && <details className="bank-history"><summary>Import history</summary><ul>{imports.map(i => <li key={i.id}><Link href={`/bank?import=${i.id}&view=all`}>{i.filename}</Link><span>{i.entry_count} entries · {i.new_count} new · {formatDate(i.created_at.toISOString())}</span></li>)}</ul></details>}
  </>;
}
