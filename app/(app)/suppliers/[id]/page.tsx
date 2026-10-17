import { getBankSupplierRules, getBankSupplierLinks } from '@/lib/suppliers/bank';
import { BankRuleForm, DisableBankRuleForm } from '../bank-forms';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { row, rows } from '@/lib/db';
import { supplierRules, getWorkspace } from '@/lib/vat/service';
import { rubricLabel } from '@/lib/vat/calculation';
import type { Supplier, SupplierRule } from '@/lib/vat/supplier-rules';
import { formatDate, formatDateTime } from '@/lib/format';
import { SupplierForm, DisableRuleForm } from '../forms';
export default async function SupplierPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{activated?:string}>}) {
  const id=Number((await params).id),search=await searchParams;
  const supplier=await row<Supplier>('SELECT * FROM suppliers WHERE id=?',id);if(!supplier)notFound();
  const bankRules=await getBankSupplierRules(id),bankLinks=[...(await getBankSupplierLinks()).values()].filter(l=>l.supplier_id===id);
  const rule=(await supplierRules()).find(r=>r.supplier_id===id);
  const history=await rows<SupplierRule>('SELECT * FROM vat_supplier_rules WHERE supplier_id=? ORDER BY id DESC',id);
  const date=rule?.config.validFrom,year=date?Number(date.slice(0,4)):new Date().getFullYear(),quarter=date?Math.ceil(Number(date.slice(5,7))/3):Math.ceil((new Date().getMonth()+1)/3);
  const current=rule?(await getWorkspace(year,quarter)).current:undefined;
  const entries=current?.entries.filter(e=>e.supplierRule?.supplier_id===id)??[];
  return <><PageHeader title={supplier.name} eyebrow="Leverancier" subtitle="Leveranciersgegevens en vaste btw-behandeling."><Link className="button" href="/suppliers">Alle leveranciers</Link><Link className="button" href={`/reports/vat/${year}/${quarter}`}>Btw-aangifte openen</Link></PageHeader>
    {search.activated&&<p role="status" className="bank-message">De leveranciersregel is actief. Passende boekingen vanaf de ingangsdatum gaan automatisch mee in de btw-aangifte.</p>}
    <div className="grid two"><section className="card"><div className="card-header"><h2 className="card-title">Leveranciersgegevens</h2></div><div className="card-body"><SupplierForm supplier={supplier}/></div></section>
    <section className="card"><div className="card-header"><h2 className="card-title">Automatische btw-verwerking</h2></div><div className="card-body">{rule?<>
      <p><span className={`badge ${rule.active&&supplier.active&&rule.config.supplierVersion===supplier.version?'paid':'draft'}`}>{!rule.active?'Gepauzeerd':!supplier.active||rule.config.supplierVersion!==supplier.version?'Opnieuw vaststellen':'Actief'}</span></p>
      <p>Omschrijving bevat <strong>{rule.config.pattern}</strong></p><p>{rule.config.code} · {rubricLabel(rule.config.code)}<br/>{(rule.config.rateBps/100).toLocaleString('nl-NL')}% btw · {(rule.config.deductibleBps/100).toLocaleString('nl-NL')}% aftrekbaar</p>
      <p>Vanaf {formatDate(rule.config.validFrom)} · btw-datum: boekdatum</p><p>{rule.config.note}</p>
      <div className="header-actions"><Link className="button" href={`/reports/vat/review/transaction/${rule.config.sampleId}?year=${year}&quarter=${quarter}&supplier=${id}`}>Regel opnieuw instellen via voorbeeldboeking</Link>{rule.active&&<DisableRuleForm supplierId={id} ruleId={rule.id}/>}</div>
    </>:<p>Open een terugkerende leveranciersbetaling in de <Link className="row-link" href="/reports/vat">btw-aangifte</Link> en kies ‘Deze leverancier voortaan automatisch verwerken’. Selecteer daar deze leverancier.</p>}</div></section></div>
    <section className="card" style={{marginTop:24}}><div className="card-header"><div><h2 className="card-title">Bankmutaties automatisch herkennen</h2><p className="card-description">Een gelijke leveranciersnaam wordt vanzelf herkend. Voeg zo nodig een afwijkende banknaam, IBAN of vaste omschrijving toe.</p></div><Link className="button" href={`/bank?view=all&supplier=${id}`}>{bankLinks.length} gekoppelde bankmutaties</Link></div><div className="card-body">
      {bankRules.length>0&&<ul className="bank-help">{bankRules.map(r=><li key={r.id}><div className="bank-toolbar"><span>{r.field==='iban'?'IBAN':r.field==='name'?'Naam tegenpartij':'Omschrijving'}: <strong>{r.pattern}</strong> · {r.active?'Actief':'Gepauzeerd'}</span>{r.active&&<DisableBankRuleForm id={r.id}/>}</div></li>)}</ul>}
      <BankRuleForm supplierId={id}/>
    </div></section>
    {rule&&<section className="card" style={{marginTop:24}}><div className="card-header"><h2 className="card-title">Volgens deze regel verwerkt · {year} kwartaal {quarter}</h2></div><div className="card-body">{entries.length?<ul>{entries.map(e=><li key={e.source.id}><Link className="row-link" href={`/transactions/${e.source.id}`}>{formatDate(e.source.date)} · {e.source.description}</Link></li>)}</ul>:<p>In dit kwartaal zijn nog geen boekingen automatisch verwerkt volgens deze regel.</p>}</div></section>}
    {history.length>0&&<details className="bank-history"><summary>Regelhistorie ({history.length})</summary><ul>{history.map(r=><li key={r.id}>Versie #{r.id} · {r.active?'Vastgesteld':'Gepauzeerd'} · {formatDateTime(new Date(r.created_at).toISOString())} · {r.config.code} · {r.config.pattern}<div className="secondary">{r.config.note}</div></li>)}</ul></details>}
  </>;
}
