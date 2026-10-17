import { getBankSupplierLinks } from '@/lib/suppliers/bank';
import { RecognizeBankForm } from '../suppliers/bank-forms';
import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/ui";
import { rows } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { getEntries, getMatches, schemaReady } from "@/lib/bank/service";
import { ActionForm, SelectSuggested, UploadForm } from "./forms";
import { reviewSuggested } from "./actions";

export default async function BankPage({ searchParams }: { searchParams: Promise<{ import?: string; view?: string; q?: string; uploaded?: string; supplier?: string }> }) {
  const query = await searchParams;
  if (!await schemaReady()) return <><PageHeader title="Bankafschriften"/><div className="bank-message">Voor het importeren van bankafschriften is een database-update nodig. Voer uit: <code>npm run migrate:bank</code>. Vernieuw daarna deze pagina.</div></>;
  const accounts = await rows<{ id: number; name: string }>("SELECT id,name FROM accounts WHERE can_post=1 AND kind='asset' ORDER BY sort_order,name");
  const imports = await rows<{ id: number; filename: string; entry_count: number; new_count: number; created_at: Date }>("SELECT id,filename,entry_count,new_count,created_at FROM bank_imports ORDER BY id DESC LIMIT 100");
  const importId = Number.isSafeInteger(Number(query.import)) && Number(query.import) > 0 ? Number(query.import) : undefined;
  const entries = await getEntries(importId);
  const matches = await getMatches(entries);
  const supplierLinks=await getBankSupplierLinks();
  const supplierFilter=query.supplier??'';
  const pending = entries.filter(e => !e.transaction_id);
  const suggested = pending.filter(e => matches.get(e.id)?.suggestedId);
  const possible = pending.filter(e => !matches.get(e.id)?.suggestedId && matches.get(e.id)?.candidates.length);
  const view = ["suggested", "review", "new", "processed", "all"].includes(query.view ?? "") ? query.view! : "pending";
  const search = (query.q ?? "").trim().toLowerCase();
  const visible = entries.filter(e => {
    const match = matches.get(e.id);
    const included = view === "all" || (view === "processed" ? Boolean(e.transaction_id) : !e.transaction_id && (view === "pending" || (view === "suggested" ? match?.suggestedId : view === "review" ? !match?.suggestedId && match?.candidates.length : !match?.candidates.length)));
    const supplier=supplierLinks.get(e.id);
    const supplierIncluded=!supplierFilter||(supplierFilter==='missing'?!supplier?.supplier_id:supplierFilter==='ambiguous'?supplier?.status==='ambiguous':supplier?.supplier_id===Number(supplierFilter));
    return included && supplierIncluded && (!search || `${e.counterparty} ${e.description} ${e.reference} ${e.amount_cents / 100} ${supplier?.supplier_name??''}`.toLowerCase().includes(search));
  });
  const href = (tab: string) => `/bank?${new URLSearchParams({ ...(importId ? { import: String(importId) } : {}), view: tab, ...(search ? { q: search } : {}), ...(supplierFilter?{supplier:supplierFilter}:{}) })}`;
  return <>
    <PageHeader title="Bankafschriften" subtitle="Koppel uw bankafschrift aan bestaande boekingen. Controleer en boek daarna nieuwe bankmutaties."><Link href="/suppliers" className="button">Leveranciers</Link><Link href="/transactions" className="button">Boekingen bekijken</Link></PageHeader>
    {query.uploaded && <div role="status" className="bank-message">{query.uploaded === "duplicate" ? "Dit bestand is al geïmporteerd. Uw eerdere controles zijn behouden." : "De afschriftsaldi zijn gecontroleerd. Nieuwe bankmutaties staan klaar ter controle en zijn nog niet geboekt."}</div>}
    <section className="card bank-upload-card"><div className="card-header"><div><h2 className="card-title">Bankafschrift importeren</h2><p className="card-description">Overlappende perioden zijn toegestaan: eerder geïmporteerde bankreferenties worden herkend.</p></div></div><div className="card-body"><UploadForm accounts={accounts} defaultAccount={accounts.find(a => /ing.*bank|bank.*ing/i.test(a.name))?.id}/></div></section>
    <nav className="bank-tabs" aria-label="Status bankmutatie">{[["pending", `Te verwerken (${pending.length})`], ["suggested", `Voorgesteld (${suggested.length})`], ["review", `Koppelingen controleren (${possible.length})`], ["new", `Geen koppeling (${pending.length - suggested.length - possible.length})`], ["processed", `Verwerkt (${entries.length - pending.length})`], ["all", "Alles"]].map(([key, label]) => <Link key={key} href={href(key)} className={view === key ? "active" : ""} aria-current={view === key ? "page" : undefined}>{label}</Link>)}</nav>
    <div className="bank-toolbar" style={{marginBottom:16}}><RecognizeBankForm/><Link className="button" href="/bank?view=all&supplier=missing">Zonder leverancier</Link><Link className="button" href="/bank?view=all&supplier=ambiguous">Leverancier kiezen</Link>{supplierFilter&&<Link className="button" href={`/bank?view=${view}`}>Alle leveranciers</Link>}</div>
    <section className="card flush">
      <form className="bank-filter"><label className="sr-only" htmlFor="bank-search">Bankmutaties zoeken</label><input id="bank-search" name="q" defaultValue={query.q} placeholder="Zoek op naam, kenmerk of bedrag"/><input type="hidden" name="view" value={view}/>{supplierFilter&&<input type="hidden" name="supplier" value={supplierFilter}/>}<label className="sr-only" htmlFor="import-filter">Bankafschrift</label><select id="import-filter" name="import" defaultValue={importId ?? ""}><option value="">Alle bankafschriften</option>{imports.map(i => <option key={i.id} value={i.id}>{i.filename}</option>)}</select><button className="button small">Filteren</button>{(importId || search) && <Link href="/bank" className="button small">Wissen</Link>}</form>
      {visible.length ? <ActionForm action={reviewSuggested}>
        {visible.some(e => matches.get(e.id)?.suggestedId) && <div className="bank-bulk"><span>Selecteer de juiste voorgestelde koppelingen. De bestaande boekingen blijven behouden.</span><SelectSuggested/><button className="button soft small">Geselecteerde koppelingen bevestigen</button></div>}
        <div className="table-wrap"><table className="data-table bank-table"><thead><tr><th><span className="sr-only">Koppeling selecteren</span></th><th>Datum</th><th>Bankmutatie</th><th className="numeric">Bedrag</th><th>Leverancier</th><th>Aansluiting</th><th/></tr></thead><tbody>{visible.map(e => {
          const match = matches.get(e.id), candidate = match?.candidates[0],supplier=supplierLinks.get(e.id);
          const label = e.transaction_id ? "Verwerkt" : match?.suggestedId ? "Voorgestelde koppeling" : candidate ? "Koppeling controleren" : "Geen koppeling";
          return <tr key={e.id}><td>{match?.suggestedId && <input type="checkbox" name="entry_id" value={e.id} aria-label={`Bevestig koppeling voor ${e.counterparty || e.description} op ${e.booking_date}`}/>}</td><td className="bank-date">{formatDate(e.booking_date)}</td><td><Link className="row-link" href={`/bank/${e.id}`}>{e.counterparty || (e.description.length > 65 ? `${e.description.slice(0, 65)}…` : e.description) || "Bankmutatie"}</Link><div className="secondary bank-description">{e.description || e.reference}</div>{e.warning && <div className="bank-warning">Verzamelbetaling controleren</div>}</td><td className={`numeric ${e.amount_cents > 0 ? "bank-ok" : ""}`}>{e.amount_cents > 0 ? "+" : "−"}{formatMoney(Math.abs(e.amount_cents))}</td><td>{supplier?.supplier_id?<><Link className="row-link" href={`/suppliers/${supplier.supplier_id}`}>{supplier.supplier_name}</Link><div className="secondary">{supplier.mode==='manual'?'Handmatig':'Automatisch'}</div></>:<Link className="row-link" href={`/bank/${e.id}`}>{supplier?.status==='ambiguous'?'Leverancier kiezen':supplier?.status==='excluded'?'Geen leverancier (bewust)':supplier?.status==='batch'?'Verzamelbetaling controleren':'Leverancier koppelen'}</Link>}</td><td><span className={`badge ${e.transaction_id ? "paid" : match?.suggestedId ? "active" : "draft"}`}>{label}</span>{e.transaction_id ? <div className="secondary"><Link href={`/transactions/${e.transaction_id}`}>Boeking #{e.transaction_id}</Link></div> : candidate ? <><div className="secondary">#{candidate.id} · {candidate.description}</div><div className="secondary">{candidate.reasons.slice(1).join(" · ")}{match!.candidates.length > 1 ? ` · ${match!.candidates.length} mogelijkheden` : ""}</div></> : <div className="secondary">Kies rekeningen voordat u boekt</div>}</td><td><Link href={`/bank/${e.id}`} className="button small">{e.transaction_id ? "Bekijken" : "Controleren"}</Link></td></tr>;
        })}</tbody></table></div>
      </ActionForm> : <EmptyState title={entries.length ? "Geen bankmutaties in deze weergave" : "Geen bankmutaties om te verwerken"} copy={entries.length ? "Kies een andere status of importeer een volgend bankafschrift." : "Upload een ING CAMT.053-bestand om het afschrift aan uw boekhouding te koppelen."}/>}
    </section>
    {imports.length > 0 && <details className="bank-history"><summary>Importhistorie</summary><ul>{imports.map(i => <li key={i.id}><Link href={`/bank?import=${i.id}&view=all`}>{i.filename}</Link><span>{i.entry_count} mutaties · {i.new_count} nieuw · {formatDate(i.created_at.toISOString())}</span></li>)}</ul></details>}
  </>;
}
