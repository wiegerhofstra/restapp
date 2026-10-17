import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { getWorkspace } from '@/lib/vat/service';
import { period, roundingDescription } from '@/lib/vat/calculation';
import { formatMoney, formatDate } from '@/lib/format';
import { CopyValue, SnapshotForm } from '../../forms';

const guidance='https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/themaoverstijgend/brochures_en_publicaties/toelichting_bij_de_digitale_aangifte_omzetbelasting';
export default async function VatPage({params,searchParams}:{params:Promise<{year:string;quarter:string}>;searchParams:Promise<{rubric?:string;snapshot?:string;saved?:string}>}) {
  const p=await params,search=await searchParams,year=Number(p.year),quarter=Number(p.quarter);
  try {period(year,quarter);} catch {notFound();}
  const {current,snapshots}=await getWorkspace(year,quarter);
  const selected=search.snapshot?snapshots.find(s=>s.id===Number(search.snapshot)):undefined;
  if(search.snapshot&&!selected) notFound();
  const data=selected?.payload??current,latest=snapshots[0];
  const path=`/reports/vat/${year}/${quarter}`,suffix=selected?`?snapshot=${selected.id}`:'';
  const entries=search.rubric?data.entries.filter(e=>e.lines.some(l=>l.date>=data.start&&l.date<=data.end&&(l.code===search.rubric||(search.rubric==='5b'&&['2a','4a','4b'].includes(l.code)&&l.deductibleBps>0)||(search.rubric==='5a'&&['1a','1b','1c','1d','2a','4a','4b'].includes(l.code))))):data.entries;
  const previousQuarter=quarter===1?{year:year-1,quarter:4}:{year,quarter:quarter-1},nextQuarter=quarter===4?{year:year+1,quarter:1}:{year,quarter:quarter+1};
  const ready=data.blockers.length===0;
  const status=selected?`${selected.status==='submitted'?'Submitted':'Reviewed'} copy #${selected.id}`:latest?.fingerprint===current.fingerprint?latest.status==='submitted'?'Submitted · unchanged':'Reviewed · ready to transfer':'Draft · review required';
  const changes=latest?current.totals.flatMap(r=>{
    const before=latest.payload.totals.find(b=>b.code===r.code);
    return before&&(before.base!==r.base||before.tax!==r.tax||before.baseEuros!==r.baseEuros||before.taxEuros!==r.taxEuros)?[{code:r.code,before,after:r}]:[];
  }):[];
  return <>
    <PageHeader title={`Omzetbelasting ${year} · Q${quarter}`} subtitle={`${formatDate(data.start)} – ${formatDate(data.end)}`}>
      <Link className="button" href="/reports">All reports</Link>
      <Link className="button" href={`${path}/export?format=csv${selected?`&snapshot=${selected.id}`:''}`}>Export CSV</Link>
      <Link className="button" href={`${path}/export?format=pdf${selected?`&snapshot=${selected.id}`:''}`}>Download PDF</Link>
    </PageHeader>
    <nav className="vat-period-nav" aria-label="VAT quarters">
      {year>2000||quarter>1?<Link href={`/reports/vat/${previousQuarter.year}/${previousQuarter.quarter}`}>Previous quarter</Link>:<span/>}
      <span className="badge">{status}</span>
      {year<2100||quarter<4?<Link href={`/reports/vat/${nextQuarter.year}/${nextQuarter.quarter}`}>Next quarter</Link>:<span/>}
    </nav>
    {search.saved&&<p role="status" className="bank-message">VAT review saved. The worksheet has been recalculated.</p>}
    {selected&&<p className="bank-message">Frozen on {formatDate(new Date(selected.created_at).toISOString())}{selected.receipt?` · Receipt: ${selected.receipt}`:''}. <Link className="row-link" href={path}>Open live worksheet</Link></p>}
    {latest&&latest.fingerprint!==current.fingerprint&&<p className="bank-message warning">Bookkeeping, reviews or calculation rules changed since copy #{latest.id}. Current return: € {current.balanceEuros}; saved return: € {latest.payload.balanceEuros}. Check the evidence even if the total is unchanged. A submitted copy remains unchanged.</p>}
    {changes.length>0&&<details className="bank-history"><summary>Changed amounts since copy #{latest.id}</summary><div className="table-wrap"><table className="data-table"><thead><tr><th>Rubriek</th><th>Saved exact base / VAT</th><th>Current exact base / VAT</th><th>Saved declaration base / VAT (€)</th><th>Current declaration base / VAT (€)</th></tr></thead><tbody>{changes.map(c=><tr key={c.code}><td>{c.code}</td><td>{c.before.base===null?'—':formatMoney(c.before.base)} / {c.before.tax===null?'—':formatMoney(c.before.tax)}</td><td>{c.after.base===null?'—':formatMoney(c.after.base)} / {c.after.tax===null?'—':formatMoney(c.after.tax)}</td><td>{c.before.baseEuros??'—'} / {c.before.taxEuros??'—'}</td><td>{c.after.baseEuros??'—'} / {c.after.taxEuros??'—'}</td></tr>)}</tbody></table></div></details>}
    {!ready&&<p className="bank-message warning"><strong>{data.blockers.length} items need attention.</strong> These figures include unverified suggestions. Review the evidence before using them in a declaration. <a className="row-link" href="#evidence">Go to review list</a></p>}
    <section className="card vat-worksheet">
      <div className="card-header"><div><h2 className="card-title">Aangifte omzetbelasting</h2><p className="card-description">Whole euros for the declaration. Click a value to copy; click a rubriek to inspect its evidence.</p></div><a className="row-link" href={guidance} target="_blank" rel="noreferrer">Official guidance</a></div>
      <div className="table-wrap"><table className="data-table vat-table"><thead><tr><th>Rubriek</th><th>Omschrijving</th><th className="numeric">Omzet (€)</th><th className="numeric">Btw (€)</th><th className="numeric">Exact btw</th></tr></thead>
        <tbody>{data.totals.map(r=><tr key={r.code} className={r.code.startsWith('5')?'vat-total-row':''}><td><Link className="vat-code" href={`${path}?${selected?`snapshot=${selected.id}&`:''}rubric=${r.code}#evidence`}>{r.code}</Link></td><td>{r.label}</td><td className="numeric">{r.baseEuros===null?'—':<CopyValue value={r.baseEuros}/>}</td><td className="numeric">{r.taxEuros===null?'—':<CopyValue value={r.taxEuros}/>}</td><td className="numeric vat-exact">{r.tax===null?'—':formatMoney(r.tax)}</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={2}><strong>{data.balanceEuros<0?'Terug te vragen':'Te betalen'}</strong></td><td/><td className="numeric"><CopyValue value={Math.abs(data.balanceEuros)}/></td><td className="numeric vat-exact">{formatMoney(data.balanceCents)}</td></tr></tfoot>
      </table></div>
      <p className="vat-footnote">{roundingDescription(data.rounding)} 5a adds the rounded VAT fields; the balance is 5a − 5b. Exact ledger/VAT amounts stay in cents.</p>
    </section>
    <section className="card vat-evidence" id="evidence"><div className="card-header"><div><h2 className="card-title">{search.rubric?`Evidence for ${search.rubric}`:'Review evidence'}</h2><p className="card-description">{data.entries.filter(e=>e.state==='reviewed').length} of {data.entries.length} sources reviewed. Dates below are VAT dates; source links show booking/invoice dates.</p></div>{search.rubric&&<Link className="button" href={`${path}${suffix}#evidence`}>Show all</Link>}</div>
      {entries.length?<div className="table-wrap"><table className="data-table"><thead><tr><th>Source</th><th>VAT date / treatment</th><th>Review</th><th/></tr></thead><tbody>{entries.map(e=>{
        const relevant=e.lines.filter(l=>l.date>=data.start&&l.date<=data.end);
        return <tr key={`${e.source.kind}:${e.source.id}`}><td>{e.source.deleted?<strong>Deleted {e.source.kind} #{e.source.id}</strong>:<Link className="row-link" href={`/${e.source.kind==='invoice'?'invoices':'transactions'}/${e.source.id}`}>{e.source.kind} #{e.source.id}</Link>}<div className="vat-description">{e.source.description}</div><small>{e.source.date}</small></td>
          <td>{relevant.length?relevant.map((l,i)=><div key={i}>{l.date} · {l.code} · {formatMoney(l.tax)}{['2a','4a','4b','5b'].includes(l.code)?` · ${l.deductibleBps/100}% deductible`:''}</div>):e.lines.length?'Allocated to another quarter':e.state==='reviewed'?'Excluded from VAT':'Classification needed'}</td>
          <td><span className={`badge ${e.state==='reviewed'?'paid':'draft'}`}>{e.state.replaceAll('_',' ')}</span>{!e.source.deleted&&e.source.balance!==0&&<div className="bank-warning">Ledger is unbalanced</div>}{e.review&&<div className="vat-description">{e.review.note}</div>}</td>
          <td>{!selected&&<Link className="button small" href={`/reports/vat/review/${e.source.kind}/${e.source.id}?year=${year}&quarter=${quarter}`}>{e.state==='reviewed'?'Edit review':'Review'}</Link>}</td></tr>;
      })}</tbody></table></div>:<div className="card-body">No sources for this selection.</div>}
      {data.pending.length>0&&<div className="card-body"><h3>Unprocessed bank entries</h3><ul>{data.pending.map(b=><li key={b.id}><Link className="row-link" href={`/bank/${b.id}`}>{b.booking_date} · {b.description}</Link></li>)}</ul></div>}
    </section>
    {!selected&&<section className="card vat-completion"><div className="card-header"><div><h2 className="card-title">Review and submission</h2><p className="card-description">{ready?'All recorded sources are reviewed. Check completeness before saving a copy.':'Resolve the review list to unlock a reviewed copy.'}</p></div></div><div className="card-body"><SnapshotForm year={year} quarter={quarter} fingerprint={current.fingerprint} canSubmit={latest?.status==='reviewed'&&latest.fingerprint===current.fingerprint} blocked={!ready}/></div></section>}
    <section className="vat-archive"><h2>Saved copies</h2>{snapshots.length?<ul>{snapshots.map(s=><li key={s.id}><Link className="row-link" href={`${path}?snapshot=${s.id}`}>{s.status==='submitted'?'Submitted':'Reviewed'} #{s.id} · {formatDate(new Date(s.created_at).toISOString())} · € {s.payload.balanceEuros}</Link>{s.receipt&&<span> · {s.receipt}</span>}</li>)}</ul>:<p>No saved copies yet.</p>}</section>
    <p className="bank-help">This worksheet covers the standard Dutch VAT rubrieken. Review scheme-specific treatment yourself; ICP, OSS and suppletie filings are separate. Tax dates follow invoice/supply rules, not automatically the bank date.</p>
  </>;
}
