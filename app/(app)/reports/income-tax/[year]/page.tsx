import { requireUser } from "@/lib/auth";
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { PrintButton } from '@/components/print-button';
import { getIncomeTaxWorkspace } from '@/lib/income-tax/service';
import { categories, validYear } from '@/lib/income-tax/calculation';
import { formatMoney, formatDate } from '@/lib/format';
import { CopyAmount, SnapshotForm, YearConfigForm } from '../forms';

export default async function IncomeTaxYearPage({params,searchParams}:{params:Promise<{year:string}>;searchParams:Promise<{snapshot?:string;saved?:string}>}) {
  await requireUser();

  const year=Number((await params).year);try{validYear(year);}catch{notFound();}
  const search=await searchParams,{current,snapshots}=await getIncomeTaxWorkspace(year);
  const snapshot=search.snapshot?snapshots.find(s=>s.id===Number(search.snapshot)):undefined;
  if(search.snapshot&&!snapshot)notFound();
  const w=snapshot?.payload??current,concept=!snapshot||snapshot.status==='draft';
  const download=`/reports/income-tax/${year}/export${snapshot?`?snapshot=${snapshot.id}&`:'?'}format=`;
  const totals=Object.entries(categories).map(([key,label])=>({key,label,value:w.accountRows.filter(a=>a.category===key).reduce((n,a)=>n+a.value,0)}));
  const balance=w.accountRows.filter(a=>['fixed_assets','receivables','cash','other_assets','debts'].includes(a.category)&&(a.opening||a.closing||a.count));
  const used=w.accountRows.filter(a=>a.count||a.opening||a.closing);
  return <div className="income-workspace">
    <PageHeader eyebrow="Vof · Jaarwerkplek" title={`Inkomstenbelasting ${year}`} subtitle="Van gezamenlijke jaarcijfers naar een persoonlijk overzicht per vennoot.">
      <Link href={`${download}csv`} className="button">CSV downloaden</Link><Link href={`${download}pdf`} className="button">PDF downloaden</Link><PrintButton/>
    </PageHeader>
    {!snapshot&&<a href="#instellingen" className="button no-print">Jaarinstellingen aanpassen</a>}
    <nav className="vat-period-nav no-print" aria-label="Boekjaar"><Link href={`/reports/income-tax/${year-1}`}>← {year-1}</Link><span className={`badge ${concept?'':'active'}`}>{concept?'Concept':'Gecontroleerde versie'}{snapshot?` #${snapshot.id}`:''}</span><Link href={`/reports/income-tax/${year+1}`}>{year+1} →</Link></nav>
    <p className="income-print-title">Jaaroverzicht {year} — {concept?'CONCEPT':'GECONTROLEERD'}{snapshot?` — versie #${snapshot.id}`:''}</p>
    {search.saved&&<p role="status" className="balance-callout">Jaarinstellingen opgeslagen en berekening bijgewerkt.</p>}
    {snapshot&&<div className="balance-callout warning">U bekijkt de vaste versie van {formatDate(new Date(snapshot.created_at).toISOString().slice(0,10))}. {snapshot.fingerprint!==current.fingerprint?'De actuele gegevens of controlestatus wijken inmiddels af.':'Deze versie sluit aan op de actuele gegevens.'} <Link href={`/reports/income-tax/${year}`}>Actuele jaarwerkplek openen</Link></div>}
    <div className="grid three income-metrics">{[['Opbrengsten',w.revenue],['Kosten',w.costs],['Boekhoudkundige winst',w.profit]].map(([label,amount])=><section className="card metric" key={label}><span className="metric-top">{label}</span><strong className="metric-value">{formatMoney(Number(amount))}</strong><span className="metric-note">Volgens de indeling van dit jaaroverzicht</span></section>)}</div>
    <section className="card"><div className="card-body">
      <h2 className="card-title">{w.issues.length?`${w.issues.length} openstaande controles`:'Jaarcijfers gecontroleerd'}</h2>
      {!w.config.allocationReviewed&&<p className="balance-callout warning">Uw 100/0-verdeling is een voorlopig uitgangspunt. De afspraak is nog niet als rechtsgeldig en fiscaal beoordeeld vastgelegd.</p>}
      {w.issues.length>0&&<details className="income-checks" open><summary>Wat vraagt nog aandacht?</summary><ul>{w.issues.map((issue,i)=><li key={i}>{issue}</li>)}</ul></details>}
      <p className="field-hint">Dit overzicht bereidt het ondernemingsdeel van uw aangifte voor. Ondernemersaftrek, mkb-winstvrijstelling, investeringsaftrek, buitenvennootschappelijk vermogen en uw overige persoonlijke situatie zijn niet automatisch berekend. Er wordt geen verschuldigde inkomstenbelasting berekend.</p>
    </div></section>
    <section className="card" id="jaarcijfers"><div className="card-header"><h2 className="card-title">Winst-en-verliesrekening</h2></div><div className="card-body table-wrap"><table className="data-table"><thead><tr><th>Rubriek</th><th className="numeric">Bedrag</th></tr></thead><tbody>{totals.filter(t=>['revenue','other_income','cost_of_sales','staff','depreciation','other_costs'].includes(t.key)).map(t=><tr key={t.key}><td>{t.label}</td><td className="numeric">{formatMoney(t.value)}</td></tr>)}</tbody><tfoot><tr><td>Boekhoudkundige winst</td><td className="numeric">{formatMoney(w.profit)}</td></tr></tfoot></table><p className="field-hint">Privéonttrekkingen en privéstortingen zijn uitgesloten van de winst. Facturen worden niet nogmaals bij de grootboekomzet opgeteld.</p></div></section>
    <section className="card"><div className="card-header"><h2 className="card-title">Begin- en eindbalans</h2></div><div className="card-body table-wrap"><table className="data-table"><thead><tr><th>Rekening</th><th>Rubriek</th><th className="numeric">1 januari</th><th className="numeric">31 december</th></tr></thead><tbody>{balance.map(a=><tr key={a.id}><td><Link href={`/accounts/${a.id}`}>{a.name}</Link></td><td>{categories[a.category]}</td><td className="numeric">{formatMoney(a.category==='debts'?-a.opening:a.opening)}</td><td className="numeric">{formatMoney(a.category==='debts'?-a.closing:a.closing)}</td></tr>)}</tbody><tfoot><tr><td colSpan={2}>Eigen vermogen: activa minus schulden</td><td className="numeric">{formatMoney(w.openingNetAssets)}</td><td className="numeric">{formatMoney(w.closingNetAssets)}</td></tr></tfoot></table><p className="field-hint">Gebaseerd op alle grootboekmutaties tot de balansdatum. Voor een lopend jaar is de eindstand tussentijds. Ontbrekende beginsaldi en jaarafsluitingsboekingen moeten eerst worden aangevuld.</p></div></section>
    <section className="card" id="vennoten"><div className="card-header"><h2 className="card-title">Kapitaal en winst per vennoot</h2></div><div className="card-body table-wrap"><table className="data-table"><thead><tr><th>Vennoot</th><th className="numeric">Beginkapitaal</th><th className="numeric">Stortingen</th><th className="numeric">Onttrekkingen</th><th className="numeric">Winstaandeel</th><th className="numeric">Eindkapitaal</th></tr></thead><tbody>{w.partners.map(p=><tr key={p.key}><td>{p.name}<div className="secondary">{p.shareBps/100}% resterende winst</div></td><td className="numeric">{formatMoney(p.openingCapital)}</td><td className="numeric">{formatMoney(p.deposits)}</td><td className="numeric">{formatMoney(p.withdrawals)}</td><td className="numeric">{formatMoney(p.profitShare)}</td><td className="numeric">{formatMoney(p.closingCapital)}</td></tr>)}</tbody></table><p className={w.openingDifference||w.closingDifference?'balance-callout warning':'field-hint'}>Verschil met balans — begin: {formatMoney(w.openingDifference)}; einde: {formatMoney(w.closingDifference)}. Beide moeten € 0,00 zijn.</p></div></section>
    <section className="card"><div className="card-header"><h2 className="card-title">Persoonlijk aangifteoverzicht</h2></div><div className="card-body">
      <p className="field-hint">Gebruik de gezamenlijke jaarcijfers met uw persoonlijke kapitaal- en winstaandeel. Bedragen zijn exact in euro’s en centen; dit is geen volledig ingevulde aangifte. Fiscale correcties hieronder zijn aanvullingen op de boekhoudkundige winst, geen mutaties in het kapitaal.</p>
      {w.partners.map(p=><div key={p.key} className="income-partner"><h3>{p.name}</h3><div className="table-wrap"><table className="data-table"><tbody>{[
        ['Ondernemingsvermogen aan het begin',p.openingCapital],['Privéstortingen',p.deposits],['Privéonttrekkingen',p.withdrawals],['Ondernemingsvermogen aan het einde',p.closingCapital],['Boekhoudkundig winstaandeel',p.profitShare],['Aanvullende fiscale correcties',p.adjustment],['Winst na opgegeven correcties, vóór ondernemersaftrek en mkb-winstvrijstelling',p.fiscalProfit],
      ].map(([label,amount])=><tr key={label}><td>{label}</td><td className="numeric">{formatMoney(Number(amount))}</td><td><CopyAmount cents={Number(amount)}/></td></tr>)}</tbody></table></div></div>)}
      {w.config.adjustments.length>0&&<><h3>Onderbouwing fiscale correcties</h3><ul>{w.config.adjustments.map((a,i)=><li key={i}>{a.label}: {formatMoney(a.amount)} · {w.partners.find(p=>p.key===a.partnerKey)?.name??'Volgens winstpercentages'}</li>)}</ul></>}
      <p><strong>Afspraak winstverdeling:</strong> {w.config.allocationNote}</p>
    </div></section>
    <section className="card no-print"><div className="card-body"><details><summary>Onderliggende boekingen en factuurcontrole</summary>
      {w.unbalanced.length>0&&<><h3>Niet-sluitende boekingen</h3><ul>{w.unbalanced.map(t=><li key={t.id}><Link href={`/transactions/${t.id}`}>#{t.id} · {formatDate(t.date)} · {t.description}</Link> · verschil {formatMoney(t.balance)}</li>)}</ul></>}
      {w.empty.length>0&&<><h3>Boekingen zonder regels</h3><ul>{w.empty.map(t=><li key={t.id}><Link href={`/transactions/${t.id}`}>Boeking #{t.id} aanvullen</Link></li>)}</ul></>}
      {w.pending.length>0&&<p><Link href="/bank?view=pending">{w.pending.length} bankmutaties verwerken</Link></p>}
      <h3>Grootboekmutaties {year}</h3>{used.map(a=><details key={a.id} className="income-source"><summary>{a.name} · {categories[a.category]} · {a.count} regels</summary><ul>{w.sourceLines.filter(l=>l.accountId===a.id&&l.date>=w.start&&l.date<=w.end).map(l=><li key={l.id}><Link href={`/transactions/${l.transactionId}`}>{formatDate(l.date)} · #{l.transactionId} · {l.description}</Link> · debet {formatMoney(l.debit)} / credit {formatMoney(l.credit)}</li>)}</ul></details>)}
      <h3>Facturen ter controle</h3><p className="field-hint">Controleer of deze facturen en eventuele openstaande posten in het grootboek zijn verwerkt. Ook oudere facturen die mogelijk nog openstaan worden getoond. De factuurstatus is geen bewijs van een grootboekboeking.</p>
      {w.invoices.length?<div className="table-wrap"><table className="data-table"><thead><tr><th>Factuur</th><th>Datum</th><th className="numeric">Exclusief btw</th><th>Betaaldatum</th></tr></thead><tbody>{w.invoices.map(i=><tr key={i.id}><td><Link href={`/invoices/${i.id}`}>#{i.number} · {i.description}</Link></td><td>{formatDate(i.date)}</td><td className="numeric">{formatMoney(i.net)}</td><td>{i.paidDate?formatDate(i.paidDate):'Niet vastgelegd'}</td></tr>)}</tbody></table></div>:<p>Geen facturen voor deze controle gevonden.</p>}
    </details></div></section>
    {!snapshot&&<YearConfigForm key={`${w.configId}-${w.sourceHash}`} workspace={w}/>}
    <section className="card no-print"><div className="card-header"><h2 className="card-title">Versies bewaren</h2></div><div className="card-body">
      {!snapshot&&<SnapshotForm workspace={w}/>}
      {snapshots.length>0?<ul>{snapshots.map(s=><li key={s.id}><Link href={`/reports/income-tax/${year}?snapshot=${s.id}`}>{s.status==='draft'?'Concept':'Gecontroleerd'} #{s.id} · {formatDate(new Date(s.created_at).toISOString().slice(0,10))}</Link> · {s.fingerprint===current.fingerprint?'Sluit aan op actuele gegevens':'Actuele gegevens of controlestatus gewijzigd'}</li>)}</ul>:<p className="field-hint">Nog geen vaste versies bewaard.</p>}
    </div></section>
  </div>;
}
