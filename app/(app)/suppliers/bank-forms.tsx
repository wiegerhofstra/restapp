'use client';
import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Field } from '@/components/ui';
import type { Supplier } from '@/lib/vat/supplier-rules';
import type { SupplierLink } from '@/lib/suppliers/bank';
import type { BankSupplierSource } from '@/lib/suppliers/bank-matching';
import { bankSupplierAction, bankRuleAction, disableBankRuleAction, recognizeBankAction } from './actions';
export function RecognizeBankForm(){
  const [state,action,pending]=useActionState(recognizeBankAction,{});
  return <form action={action}><button className="button" disabled={pending}>{pending?'Herkennen…':'Leveranciers opnieuw herkennen'}</button>{state.message&&<p role="status" className="bank-help">{state.message}</p>}{state.error&&<p role="alert" className="bank-warning">{state.error}</p>}</form>;
}
export function BankRuleForm({supplierId}:{supplierId:number}) {
  const [state,action,pending]=useActionState(bankRuleAction.bind(null,supplierId),{});
  return <form action={action} onReset={e=>e.preventDefault()}>
    <div className="form-grid"><Field label="Herkennen op" name="bank-rule-field"><select id="bank-rule-field" name="field"><option value="iban">IBAN tegenpartij is gelijk aan</option><option value="name">Naam tegenpartij is gelijk aan</option><option value="description">Omschrijving bevat</option></select></Field><Field label="Herkenningswaarde" name="bank-rule-pattern"><input id="bank-rule-pattern" name="pattern" required maxLength={200}/></Field></div>
    <p className="bank-help">Bij een gedeelde betaalrekening gebruikt u een specifieke naam of omschrijving. Nieuwe regels gelden direct voor bestaande en toekomstige imports. Bij meerdere passende leveranciers blijft de keuze open.</p>
    {state.error&&<p role="alert" className="bank-message error">{state.error}</p>}{state.message&&<p role="status" className="bank-message">{state.message}</p>}
    <button className="button" disabled={pending}>Herkenningsregel toevoegen</button>
  </form>;
}
export function DisableBankRuleForm({id}:{id:number}) {
  const [state,action,pending]=useActionState(disableBankRuleAction.bind(null,id),{});
  return <form action={action}><button className="button small" disabled={pending}>Pauzeren</button>{state.error&&<p role="alert" className="bank-warning">{state.error}</p>}</form>;
}
export function BankSupplierForm({entry,suppliers,link}:{entry:BankSupplierSource;suppliers:Supplier[];link?:SupplierLink}) {
  const [state,action,pending]=useActionState(bankSupplierAction.bind(null,entry.id),{});
  const [selected,setSelected]=useState(link?.supplier_id?String(link.supplier_id):'');
  const [remember,setRemember]=useState(false);
  const [field,setField]=useState(entry.counterparty_iban?'iban':entry.counterparty?'name':'description');
  const [pattern,setPattern]=useState(entry.counterparty_iban||entry.counterparty||entry.description);
  const batch=Boolean(entry.warning||entry.details.length>1);
  return <section className="card"><div className="card-header"><div><h2 className="card-title">Leverancier</h2><p className="card-description">{link?.supplier_id?<><Link className="row-link" href={`/suppliers/${link.supplier_id}`}>{link.supplier_name}</Link> · {link.mode==='manual'?'handmatig gekoppeld':'automatisch herkend'}{link.supplier_active===false?' · inactief':''}</>:link?.status==='ambiguous'?'Meerdere leveranciers komen overeen. Kies de juiste leverancier.':link?.status==='excluded'?'Voor deze bankmutatie is bewust geen leverancier gekozen.':batch?'Controleer de afzonderlijke betalingen voordat u een leverancier kiest.':'Nog geen leverancier herkend.'}</p></div></div><div className="card-body">
    {link?.evidence.candidates.length? <ul className="bank-help">{link.evidence.candidates.map(c=><li key={c.id}>{c.name}: {c.reasons.join(' · ')}</li>)}</ul>:null}
    <form action={action} onReset={e=>e.preventDefault()}><input type="hidden" name="version" value={link?.version??0}/>
      {state.error&&<p role="alert" className="bank-message error">{state.error}</p>}{state.message&&<p role="status" className="bank-message">{state.message}</p>}
      <fieldset className="bank-fieldset" disabled={pending}><div className="form-grid">
        <Field label="Leverancier koppelen" name="bank-supplier" full><select id="bank-supplier" name="supplier_id" value={selected} onChange={e=>{setSelected(e.target.value);setRemember(false);}}><option value="">Geen leverancier</option>{suppliers.filter(s=>s.active||s.id===link?.supplier_id).map(s=><option key={s.id} value={s.id} disabled={!s.active}>{s.name}{!s.active?' · inactief':''}</option>)}<option value="new">Nieuwe leverancier toevoegen…</option></select></Field>
        {selected==='new'&&<Field label="Naam nieuwe leverancier" name="bank-supplier-name" full><input id="bank-supplier-name" name="name" defaultValue={entry.counterparty} required minLength={2} maxLength={100}/></Field>}
      </div>
      {selected&&!batch&&<><label className="bank-check"><input type="checkbox" name="remember" checked={remember} onChange={e=>setRemember(e.target.checked)}/>Onthoud deze herkenning voor bestaande en volgende bankimports</label>
        {remember&&<div className="form-grid"><Field label="Herkennen op" name="bank-supplier-field"><select id="bank-supplier-field" name="field" value={field} onChange={e=>{const next=e.target.value;setField(next);setPattern(next==='iban'?entry.counterparty_iban:next==='name'?entry.counterparty:entry.description);}}><option value="iban" disabled={!entry.counterparty_iban}>IBAN tegenpartij is gelijk aan</option><option value="name" disabled={!entry.counterparty}>Naam tegenpartij is gelijk aan</option><option value="description">Omschrijving bevat</option></select></Field><Field label="Vaste herkenningswaarde" name="bank-supplier-pattern" hint="Laat wisselende factuurnummers weg."><input id="bank-supplier-pattern" name="pattern" value={pattern} onChange={e=>setPattern(e.target.value)} required maxLength={200}/></Field></div>}</>}
      <div className="form-actions"><button className="button primary" name="intent" value="save">{pending?'Opslaan…':'Leverancierskoppeling opslaan'}</button>{link?.mode==='manual'&&<button className="button" name="intent" value="automatic" formNoValidate>Automatische herkenning herstellen</button>}</div>
      <p className="bank-help">De leverancierskoppeling maakt nog geen boeking. Nieuwe bankmutaties verwerkt u na controle. Een ingestelde btw-regel kan daarna automatisch worden toegepast.</p>
      </fieldset>
    </form>
  </div></section>;
}
