import { outsideVatReturn, supplierTreatmentLabel } from '@/lib/vat/supplier-rules';
import { labelNl } from '@/lib/dutch';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { getWorkspace } from '@/lib/vat/service';
import { period, roundingDescription, rubricLabel } from '@/lib/vat/calculation';
import { formatMoney, formatDate } from '@/lib/format';
import { CopyValue, SnapshotForm } from '../../forms';

const guidance='https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/themaoverstijgend/brochures_en_publicaties/toelichting_bij_de_digitale_aangifte_omzetbelasting';
export default async function VatPage({params,searchParams}:{params:Promise<{year:string;quarter:string}>;searchParams:Promise<{rubric?:string;snapshot?:string;saved?:string;view?:string}>}) {
  const p=await params,search=await searchParams,year=Number(p.year),quarter=Number(p.quarter);
  try {period(year,quarter);} catch {notFound();}
  const {current,snapshots}=await getWorkspace(year,quarter);
  const selected=search.snapshot?snapshots.find(s=>s.id===Number(search.snapshot)):undefined;
  if(search.snapshot&&!selected) notFound();
  const data=selected?.payload??current,latest=snapshots[0];
  const path=`/reports/vat/${year}/${quarter}`;
  const entries=search.rubric?data.entries.filter(e=>e.lines.some(l=>l.date>=data.start&&l.date<=data.end&&(l.code===search.rubric||(search.rubric==='5b'&&['2a','4a','4b'].includes(l.code)&&l.deductibleBps>0)||(search.rubric==='5a'&&['1a','1b','1c','1d','2a','4a','4b'].includes(l.code))))):data.entries.filter(e=>selected||search.view==='all'||!['reviewed','rule_applied'].includes(e.state));
  const previousQuarter=quarter===1?{year:year-1,quarter:4}:{year,quarter:quarter-1},nextQuarter=quarter===4?{year:year+1,quarter:1}:{year,quarter:quarter+1};
  const ready=data.blockers.length===0;
  const status=selected?`${selected.status==='submitted'?"Ingediend":"Gecontroleerd"} versie #${selected.id}`:latest?.fingerprint===current.fingerprint?latest.status==='submitted'?"Ingediend · ongewijzigd":"Gecontroleerd · klaar om over te nemen":"Concept · controle nodig";
  const changes=latest?current.totals.flatMap(r=>{
    const before=latest.payload.totals.find(b=>b.code===r.code);
    return before&&(before.base!==r.base||before.tax!==r.tax||before.baseEuros!==r.baseEuros||before.taxEuros!==r.taxEuros)?[{code:r.code,before,after:r}]:[];
  }):[];
  return <>
    <PageHeader title={`Omzetbelasting ${year} · kwartaal ${quarter}`} subtitle={`${formatDate(data.start)} – ${formatDate(data.end)}`}>
      <Link className="button" href="/suppliers">Leveranciersregels</Link><Link className="button" href="/reports">Alle rapporten</Link>
      <Link className="button" href={`${path}/export?format=csv${selected?`&snapshot=${selected.id}`:''}`}>CSV exporteren</Link>
      <Link className="button" href={`${path}/export?format=pdf${selected?`&snapshot=${selected.id}`:''}`}>PDF downloaden</Link>
    </PageHeader>
    <nav className="vat-period-nav" aria-label="Btw-kwartalen">
      {year>2000||quarter>1?<Link href={`/reports/vat/${previousQuarter.year}/${previousQuarter.quarter}`}>Vorig kwartaal</Link>:<span/>}
      <span className="badge">{status}</span>
      {year<2100||quarter<4?<Link href={`/reports/vat/${nextQuarter.year}/${nextQuarter.quarter}`}>Volgend kwartaal</Link>:<span/>}
    </nav>
    {search.saved&&<p role="status" className="bank-message">De btw-controle is opgeslagen. Het aangifteoverzicht is opnieuw berekend.</p>}
    {selected&&<p className="bank-message">Vastgelegd op {formatDate(new Date(selected.created_at).toISOString())}{selected.receipt?` · Ontvangstbevestiging: ${selected.receipt}`:''}. <Link className="row-link" href={path}>Actueel aangifteoverzicht openen</Link></p>}
    {latest&&latest.fingerprint!==current.fingerprint&&<p className="bank-message warning">Boekingen, controles of rekenregels zijn gewijzigd sinds versie #{latest.id}. Actuele aangifte: € {current.balanceEuros}; opgeslagen aangifte: € {latest.payload.balanceEuros}. Controleer de onderbouwing ook als het totaal gelijk is gebleven. Een ingediende versie blijft ongewijzigd.</p>}
    {changes.length>0&&<details className="bank-history"><summary>Gewijzigde bedragen sinds versie #{latest.id}</summary><div className="table-wrap"><table className="data-table"><thead><tr><th>Rubriek</th><th>Opgeslagen grondslag / btw (exact)</th><th>Actuele grondslag / btw (exact)</th><th>Opgeslagen aangifte: grondslag / btw (€)</th><th>Actuele aangifte: grondslag / btw (€)</th></tr></thead><tbody>{changes.map(c=><tr key={c.code}><td>{c.code}</td><td>{c.before.base===null?'—':formatMoney(c.before.base)} / {c.before.tax===null?'—':formatMoney(c.before.tax)}</td><td>{c.after.base===null?'—':formatMoney(c.after.base)} / {c.after.tax===null?'—':formatMoney(c.after.tax)}</td><td>{c.before.baseEuros??'—'} / {c.before.taxEuros??'—'}</td><td>{c.after.baseEuros??'—'} / {c.after.taxEuros??'—'}</td></tr>)}</tbody></table></div></details>}
    {!ready&&<p className="bank-message warning"><strong>{data.blockers.length} posten moeten worden gecontroleerd.</strong> Deze bedragen bevatten ongecontroleerde voorstellen. Controleer de onderbouwing voordat u de bedragen overneemt in uw aangifte. <a className="row-link" href="#evidence">Naar de controlelijst</a></p>}
    <section className="card vat-worksheet">
      <div className="card-header"><div><h2 className="card-title">Aangifte omzetbelasting</h2><p className="card-description">Hele euro’s voor de aangifte. Klik op een bedrag om het te kopiëren of op een rubriek om de onderbouwing te bekijken.</p></div><a className="row-link" href={guidance} target="_blank" rel="noreferrer">Toelichting Belastingdienst</a></div>
      <div className="table-wrap"><table className="data-table vat-table"><thead><tr><th>Rubriek</th><th>Omschrijving</th><th className="numeric">Omzet (€)</th><th className="numeric">Btw (€)</th><th className="numeric">Btw vóór afronding</th></tr></thead>
        <tbody>{data.totals.map(r=><tr key={r.code} className={r.code.startsWith('5')?'vat-total-row':''}><td><Link className="vat-code" href={`${path}?${selected?`snapshot=${selected.id}&`:''}rubric=${r.code}#evidence`}>{r.code}</Link></td><td>{rubricLabel(r.code)}</td><td className="numeric">{r.baseEuros===null?'—':<CopyValue value={r.baseEuros}/>}</td><td className="numeric">{r.taxEuros===null?'—':<CopyValue value={r.taxEuros}/>}</td><td className="numeric vat-exact">{r.tax===null?'—':formatMoney(r.tax)}</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={2}><strong>{data.balanceEuros<0?'Terug te vragen':'Te betalen'}</strong></td><td/><td className="numeric"><CopyValue value={Math.abs(data.balanceEuros)}/></td><td className="numeric vat-exact">{formatMoney(data.balanceCents)}</td></tr></tfoot>
      </table></div>
      <p className="vat-footnote">{roundingDescription(data.rounding)} Rubriek 5a telt de afgeronde btw-bedragen op; het saldo is 5a − 5b. Boekings- en btw-bedragen blijven op centen nauwkeurig.</p>
    </section>
    <section className="card vat-evidence" id="evidence"><div className="card-header"><div><h2 className="card-title">{search.rubric?`Onderbouwing rubriek ${search.rubric}`:"Onderbouwing controleren"}</h2><p className="card-description">{data.entries.filter(e=>e.state==='reviewed').length} handmatig gecontroleerd · {data.entries.filter(e=>e.state==='rule_applied').length} automatisch volgens leveranciersregel · {data.entries.filter(e=>!['reviewed','rule_applied'].includes(e.state)).length} te controleren. Hieronder staan de datums voor de btw-aangifte. Bij de bron vindt u de boek- of factuurdatum.</p></div>{!selected&&<Link className="button" href={`${path}?view=${search.view==='all'?'attention':'all'}#evidence`}>{search.view==='all'?'Alleen controlepunten':'Alle boekingen tonen'}</Link>}</div>
      {entries.length?<div className="table-wrap"><table className="data-table"><thead><tr><th>Bron</th><th>Btw-datum / fiscale behandeling</th><th>Controlestatus</th><th/></tr></thead><tbody>{entries.map(e=>{
        const relevant=e.lines.filter(l=>l.date>=data.start&&l.date<=data.end);
        return <tr key={`${e.source.kind}:${e.source.id}`}><td>{e.source.deleted?<strong>Verwijderd {labelNl(e.source.kind)} #{e.source.id}</strong>:<Link className="row-link" href={`/${e.source.kind==='invoice'?'invoices':'transactions'}/${e.source.id}`}>{labelNl(e.source.kind)} #{e.source.id}</Link>}<div className="vat-description">{e.source.description}</div><small>{formatDate(e.source.date)}</small></td>
          <td>{relevant.length?relevant.map((l,i)=><div key={i}>{formatDate(l.date)} · {l.code} · {formatMoney(l.tax)}{['2a','4a','4b','5b'].includes(l.code)?` · ${(l.deductibleBps/100).toLocaleString('nl-NL')}% aftrekbaar`:''}</div>):e.lines.length?"Toegerekend aan een ander kwartaal":e.supplierRule&&outsideVatReturn(e.supplierRule.config.code)?supplierTreatmentLabel(e.supplierRule.config.code):e.state==='reviewed'?"Niet opgenomen in de btw-aangifte":"Btw-behandeling bepalen"}</td>
          <td><span className={`badge ${['reviewed','rule_applied'].includes(e.state)?'paid':'draft'}`}>{labelNl(e.state)}</span>{!e.source.deleted&&e.source.balance!==0&&<div className="bank-warning">Boeking is niet in evenwicht</div>}{e.review&&<div className="vat-description">{e.review.note}</div>}{e.supplierRule&&<div className="vat-description"><Link className="row-link" href={`/suppliers/${e.supplierRule.supplier_id}`}>{e.supplierRule.supplier.name}</Link> · regel #{e.supplierRule.id}</div>}{e.roundingNote&&<div className="vat-description">{e.roundingNote}</div>}{e.state==='needs_review'&&<div className="vat-description">{e.hint}</div>}</td>
          <td>{!selected&&<Link className="button small" href={`/reports/vat/review/${e.source.kind}/${e.source.id}?year=${year}&quarter=${quarter}`}>{e.state==='reviewed'?"Controle wijzigen":e.state==='rule_applied'?"Bekijken / afwijken":"Controleren"}</Link>}</td></tr>;
      })}</tbody></table></div>:<div className="card-body">Geen boekingen die nog gecontroleerd moeten worden in deze selectie.</div>}
      {data.pending.length>0&&<div className="card-body"><h3>Onverwerkte bankmutaties</h3><ul>{data.pending.map(b=><li key={b.id}><Link className="row-link" href={`/bank/${b.id}`}>{formatDate(b.booking_date)} · {b.description}</Link></li>)}</ul></div>}
    </section>
    {!selected&&<section className="card vat-completion"><div className="card-header"><div><h2 className="card-title">Controle en indiening</h2><p className="card-description">{ready?"Alle vastgelegde bronnen zijn handmatig gecontroleerd of verwerkt volgens een leveranciersregel. Controleer de volledigheid voordat u een versie opslaat.":"Werk de controlelijst af voordat u een gecontroleerde versie opslaat."}</p></div></div><div className="card-body"><SnapshotForm year={year} quarter={quarter} fingerprint={current.fingerprint} canSubmit={latest?.status==='reviewed'&&latest.fingerprint===current.fingerprint} blocked={!ready}/></div></section>}
    <section className="vat-archive"><h2>Opgeslagen versies</h2>{snapshots.length?<ul>{snapshots.map(s=><li key={s.id}><Link className="row-link" href={`${path}?snapshot=${s.id}`}>{s.status==='submitted'?"Ingediend":"Gecontroleerd"} #{s.id} · {formatDate(new Date(s.created_at).toISOString())} · € {s.payload.balanceEuros}</Link>{s.receipt&&<span> · {s.receipt}</span>}</li>)}</ul>:<p>Nog geen opgeslagen versies.</p>}</section>
    <p className="bank-help">Dit overzicht bevat de standaardrubrieken van de Nederlandse btw-aangifte. Controleer zelf of bijzondere regelingen van toepassing zijn. De opgaaf ICP, OSS-melding en suppletie zijn afzonderlijke procedures. De btw-datum volgt de factuur- of prestatiedatum volgens de toepasselijke regels, niet automatisch de bankdatum.</p>
  </>;
}
