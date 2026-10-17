import { getSuppliers } from '@/lib/suppliers/service';
import { SupplierRuleForm } from '@/app/(app)/suppliers/forms';
import { labelNl } from '@/lib/dutch';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { getReviewEntry, supplierRules } from '@/lib/vat/service';
import { period } from '@/lib/vat/calculation';
import { ReviewForm } from '../../../forms';
import { formatMoney, formatDate, formatDateTime } from '@/lib/format';

export default async function VatReviewPage({params,searchParams}:{params:Promise<{kind:string;id:string}>;searchParams:Promise<{year?:string;quarter?:string;supplier?:string}>}) {
  const {kind,id}=await params;const search=await searchParams;
  const suppliers=await getSuppliers();
  const entry=await getReviewEntry(kind,Number(id));if(!entry) notFound();
  const year=Number(search.year??entry.source.date.slice(0,4)),quarter=Number(search.quarter??Math.ceil(Number(entry.source.date.slice(5,7))/3));
  try {period(year,quarter);} catch {notFound();}
  const rule=entry.supplierRule??(await supplierRules()).find(r=>r.supplier_id===Number(search.supplier));
  return <><PageHeader title="Btw-behandeling controleren" subtitle={`${labelNl(entry.source.kind)} #${id} · ${formatDate(entry.source.date)} · ${entry.source.description}`}>
    <Link className="button" href={`/reports/vat/${year}/${quarter}#evidence`}>Terug naar aangifte</Link>
    {!entry.source.deleted&&<Link className="button" href={`/${kind==='invoice'?'invoices':'transactions'}/${id}`}>Bron openen</Link>}
  </PageHeader><div className="bank-message warning">{entry.hint}</div>
    {kind==='transaction'&&!entry.source.deleted&&<SupplierRuleForm entry={entry} suppliers={suppliers} start={period(year,quarter).start} currentRule={rule}/>}
    {entry.state==='changed'&&<p className="bank-message error">De bron is gewijzigd na de laatste btw-controle. Controleer alle bedragen opnieuw.</p>}
    <section className="card"><div className="card-header"><h2 className="card-title">Deze boeking afzonderlijk controleren</h2></div><div className="card-body"><ReviewForm entry={entry} year={year} quarter={quarter}/></div></section>
    <details className="bank-history" open><summary>Bronregels en vorige controle</summary><div className="table-wrap"><table className="data-table"><thead><tr><th>{kind==='transaction'?"Grootboekrekening":"Factuurregel"}</th><th className="numeric">{kind==='transaction'?"Debet":"Exclusief btw"}</th><th className="numeric">{kind==='transaction'?"Credit":"Btw-tarief"}</th></tr></thead><tbody>{entry.source.lines.map((line,i)=><tr key={i}><td>{String(line.account??line.description)}</td><td className="numeric">{formatMoney(kind==='transaction'?Number(line.debit):Math.round(Number(line.quantity)*Number(line.price)/1000))}</td><td className="numeric">{kind==='transaction'?formatMoney(Number(line.credit)):`${(Number(line.rate)/100).toLocaleString('nl-NL')}%`}</td></tr>)}</tbody></table></div>{entry.review&&<p>Gecontroleerd {formatDateTime(new Date(entry.review.created_at).toISOString())} — {entry.review.note}</p>}</details>
  </>;
}
