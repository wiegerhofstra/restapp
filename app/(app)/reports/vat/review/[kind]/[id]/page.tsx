import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { getReviewEntry } from '@/lib/vat/service';
import { period } from '@/lib/vat/calculation';
import { ReviewForm } from '../../../forms';
import { formatMoney } from '@/lib/format';

export default async function VatReviewPage({params,searchParams}:{params:Promise<{kind:string;id:string}>;searchParams:Promise<{year?:string;quarter?:string}>}) {
  const {kind,id}=await params;const search=await searchParams;
  const entry=await getReviewEntry(kind,Number(id));if(!entry) notFound();
  const year=Number(search.year??entry.source.date.slice(0,4)),quarter=Number(search.quarter??Math.ceil(Number(entry.source.date.slice(5,7))/3));
  try {period(year,quarter);} catch {notFound();}
  return <><PageHeader title="Review VAT treatment" subtitle={`${entry.source.kind} #${id} · ${entry.source.date} · ${entry.source.description}`}>
    <Link className="button" href={`/reports/vat/${year}/${quarter}#evidence`}>Back to return</Link>
    {!entry.source.deleted&&<Link className="button" href={`/${kind==='invoice'?'invoices':'transactions'}/${id}`}>Open source</Link>}
  </PageHeader><div className="bank-message warning">{entry.hint}</div>
    {entry.state==='changed'&&<p className="bank-message error">The source changed after its last VAT review. Check all amounts again.</p>}
    <section className="card"><div className="card-body"><ReviewForm entry={entry} year={year} quarter={quarter}/></div></section>
    <details className="bank-history" open><summary>Source postings and previous review</summary><div className="table-wrap"><table className="data-table"><thead><tr><th>{kind==='transaction'?'Account':'Invoice line'}</th><th className="numeric">{kind==='transaction'?'Debit':'Net'}</th><th className="numeric">{kind==='transaction'?'Credit':'VAT rate'}</th></tr></thead><tbody>{entry.source.lines.map((line,i)=><tr key={i}><td>{String(line.account??line.description)}</td><td className="numeric">{formatMoney(kind==='transaction'?Number(line.debit):Math.round(Number(line.quantity)*Number(line.price)/1000))}</td><td className="numeric">{kind==='transaction'?formatMoney(Number(line.credit)):`${Number(line.rate)/100}%`}</td></tr>)}</tbody></table></div>{entry.review&&<p>Reviewed {new Date(entry.review.created_at).toISOString()} — {entry.review.note}</p>}</details>
  </>;
}
