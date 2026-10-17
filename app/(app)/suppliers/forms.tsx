'use client';
import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Field } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { supplierMatches, type Supplier, type SupplierRule } from '@/lib/vat/supplier-rules';
import type { Entry } from '@/lib/vat/service';
import { supplierAction, ruleAction, disableRuleAction } from './actions';
export function SupplierForm({supplier}:{supplier?:Supplier}) {
  const [state,action,pending]=useActionState(supplierAction.bind(null,supplier?.id??null),{});
  return <form action={action} onReset={event=>event.preventDefault()}>
    {state.error&&<p className="bank-message error" role="alert">{state.error}</p>}
    <input type="hidden" name="version" value={supplier?.version??0}/>
    <div className="form-grid">
      <Field label="Leveranciersnaam" name="name" full><input id="name" name="name" defaultValue={supplier?.name} required minLength={2} maxLength={100}/></Field>
      <Field label="Landcode" name="country" hint="Bijvoorbeeld NL, DE of IE"><input id="country" name="country" defaultValue={supplier?.country} maxLength={2}/></Field>
      <Field label="Btw-identificatienummer" name="tax_number"><input id="tax_number" name="tax_number" defaultValue={supplier?.tax_number} maxLength={50}/></Field>
      <label className="checkbox"><input type="checkbox" name="active" defaultChecked={supplier?.active??true}/>Actieve leverancier</label>
    </div>
    {supplier&&<p className="bank-help">Na een wijziging stelt u de btw-regel opnieuw vast. Zo blijven gewijzigde leveranciersgegevens niet ongemerkt automatisch verwerkt.</p>}
    <div className="form-actions"><Link href="/suppliers" className="button">Terug</Link><button disabled={pending} className="button primary">{pending?'Opslaan…':supplier?'Leverancier opslaan':'Leverancier toevoegen'}</button></div>
  </form>;
}
export function DisableRuleForm({supplierId,ruleId}:{supplierId:number;ruleId:number}) {
  const [state,action,pending]=useActionState(disableRuleAction.bind(null,supplierId,ruleId),{});
  return <form action={action} onReset={event=>event.preventDefault()}>{state.error&&<p role="alert" className="bank-message error">{state.error}</p>}<button className="button" disabled={pending}>Automatische verwerking pauzeren</button></form>;
}
export function SupplierRuleForm({entry,suppliers,start,currentRule}:{entry:Entry;suppliers:Supplier[];start:string;currentRule?:SupplierRule}) {
  const [state,action,pending]=useActionState(ruleAction,{});
  const [supplierId,setSupplierId]=useState(currentRule?String(currentRule.supplier_id):'');
  const [confirmed,setConfirmed]=useState(false);
  const suggestion=entry.lines.length===1?entry.lines[0]:undefined;
  const expenseName=String(entry.source.lines.find(l=>l.kind==='expense')?.account??'');
  const pattern=expenseName.length>=4&&supplierMatches(expenseName,entry.source.description)?expenseName:entry.source.description.slice(0,120);
  // Preserve the editable configuration across the preview action; React resets
  // uncontrolled form fields after a successful action by default.
  return <details className="card supplier-rule-setup"><summary>Deze leverancier voortaan automatisch verwerken</summary><div className="card-body">
    <p className="bank-help">Stel de btw-behandeling één keer vast. Herkenning gebruikt de boekingsomschrijving én dezelfde grootboekrekeningen, boekingsrichting en btw-berekening als dit voorbeeld. Afwijkingen blijven ter controle staan.</p>
    <form action={action} onReset={event=>event.preventDefault()}>
      <input type="hidden" name="sampleId" value={entry.source.id}/><input type="hidden" name="sampleHash" value={entry.source.hash}/><input type="hidden" name="token" value={state.preview?.token??''}/>
      {state.error&&<p className="bank-message error" role="alert">{state.error}</p>}
      <fieldset className="bank-fieldset" disabled={pending}><div className="form-grid">
        <Field label="Leverancier" name="supplierId" full><select id="supplierId" name="supplierId" value={supplierId} onChange={e=>setSupplierId(e.target.value)}><option value="">Nieuwe leverancier toevoegen</option>{suppliers.filter(s=>s.active).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        {!supplierId&&<><Field label="Leveranciersnaam" name="name" full><input id="name" name="name" defaultValue={expenseName} required minLength={2} maxLength={100}/></Field><Field label="Landcode" name="country" hint="Bijvoorbeeld NL, DE of IE"><input id="country" name="country" maxLength={2}/></Field><Field label="Btw-identificatienummer" name="tax_number"><input id="tax_number" name="tax_number" maxLength={50}/></Field></>}
        <Field label="Herkenningstekst in boekingsomschrijving" name="pattern" full hint="Gebruik een vaste, specifieke naam. Laat wisselende factuurnummers weg."><input id="pattern" name="pattern" defaultValue={currentRule?.config.pattern??pattern} required minLength={4} maxLength={120}/></Field>
        <Field label="Btw-behandeling" name="code" full><select id="code" name="code" defaultValue={currentRule?.config.code??(suggestion&&['5b','2a','4a','4b'].includes(suggestion.code)?suggestion.code:'5b')}><option value="5b">5b · Voorbelasting op Nederlandse inkoopfactuur</option><option value="2a">2a · Binnenlandse verlegging</option><option value="4a">4a · Leveringen/diensten uit landen buiten de EU</option><option value="4b">4b · Leveringen/diensten uit landen binnen de EU</option></select></Field>
        <Field label="Btw-tarief (%)" name="rate"><input id="rate" name="rate" inputMode="decimal" defaultValue={String((currentRule?.config.rateBps??2100)/100).replace('.',',')} required/></Field>
        <Field label="Aftrekbaar (%)" name="deductible"><input id="deductible" name="deductible" inputMode="decimal" defaultValue={String((currentRule?.config.deductibleBps??suggestion?.deductibleBps??10000)/100).replace('.',',')} required/></Field>
        <Field label="Toepassen vanaf" name="validFrom" hint="Geldt ook voor bestaande boekingen vanaf deze datum."><input id="validFrom" name="validFrom" type="date" defaultValue={currentRule?.config.validFrom??start} required/></Field>
        <Field label="Vaste btw-datum" name="date-policy" hint="Alleen gebruiken als de boekdatum voor deze reeks ook de juiste btw-datum is."><input id="date-policy" value="Boekdatum" readOnly/></Field>
        <Field label="Onderbouwing van de leveranciersregel" name="rule-note" full hint="Verwijs naar een gecontroleerde factuur en licht de terugkerende fiscale behandeling toe."><textarea id="rule-note" name="note" defaultValue={currentRule?.config.note} required minLength={5} maxLength={2000}/></Field>
      </div>
      <div className="form-actions"><button className="button" name="intent" value="preview" onClick={()=>setConfirmed(false)}>{pending?'Berekenen…':'Bekijk passende boekingen'}</button></div>
      {state.preview&&<section className="supplier-rule-preview" aria-live="polite"><h3>{state.preview.count} {state.preview.count===1?'boeking':'boekingen'} automatisch te verwerken</h3>
        <p className="bank-help">Van {state.preview.total} herkende {state.preview.total===1?'boeking':'boekingen'}. Toekomstige passende boekingen gaan ook automatisch mee. De volgende rekeningen moeten overeenkomen: {state.preview.accounts.map(a=>a.name).join(', ')}.</p>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Boeking</th><th>Datum</th><th>Resultaat</th></tr></thead><tbody>{state.preview.examples.map(e=><tr key={e.id}><td><Link className="row-link" href={`/transactions/${e.id}`} target="_blank">#{e.id} · {e.description}</Link></td><td>{formatDate(e.date)}</td><td><span className={`badge ${e.automatic?'paid':'draft'}`}>{e.automatic?'Automatisch':'Controleren / behouden'}</span><div className="vat-description">{e.reason}</div></td></tr>)}</tbody></table></div>
        {state.preview.total>50&&<p>De eerste 50 boekingen worden getoond. De telling omvat alle passende boekingen.</p>}
        <label className="bank-check"><input type="checkbox" name="confirmed" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Ik heb de factuur en vaste btw-behandeling gecontroleerd. Voor deze reeks is de boekdatum de juiste btw-datum, zijn de bewijsstukken beschikbaar en wordt de btw niet elders dubbel opgenomen. Afwijkingen corrigeer ik vóór de kwartaalaangifte.</label>
        <button className="button primary" name="intent" value="activate" disabled={!confirmed}>Leverancier en btw-regel opslaan</button>
      </section>}
      </fieldset>
    </form>
  </div></details>;
}
