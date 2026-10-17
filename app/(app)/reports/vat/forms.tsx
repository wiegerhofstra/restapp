'use client';
import { useActionState, useState } from 'react';
import { reviewAction, snapshotAction } from './actions';
import { rubrics, type VatLine } from '@/lib/vat/calculation';
import type { Entry } from '@/lib/vat/service';

export function CopyValue({value}:{value:number}) {
  const [message,setMessage]=useState('');
  return <><button type="button" className="vat-copy" aria-label={`Copy ${value}`} onClick={async()=>{
    try {await navigator.clipboard.writeText(String(value));setMessage('Copied');} catch {setMessage('Select the number to copy');}
  }}>{value.toLocaleString('nl-NL')}</button><span className="vat-copy-feedback" aria-live="polite">{message}</span></>;
}

type EditableLine={date:string;code:VatLine['code'];base:string;tax:string;deductible:string};
function cents(value:string) {const n=value.trim().replace(',','.');return /^-?\d+(\.\d{1,2})?$/.test(n)?Math.round(Number(n)*100):null;}
export function ReviewForm({entry,year,quarter}:{entry:Entry;year:number;quarter:number}) {
  const [state,action,pending]=useActionState(reviewAction,{});
  const [lines,setLines]=useState<EditableLine[]>(entry.lines.map(l=>({date:l.date,code:l.code,base:(l.base/100).toFixed(2),tax:(l.tax/100).toFixed(2),deductible:String(l.deductibleBps/100)})));
  const update=(index:number,key:keyof EditableLine,value:string)=>setLines(current=>current.map((l,i)=>i===index?{...l,[key]:value,...(key==='code'?{deductible:['2a','4a','4b','5b'].includes(value)?'100':'0',...(['1e','3a','3b','3c'].includes(value)?{tax:'0'}:{})}:{})}:l));
  return <form action={action} className="vat-review-form">
    <input type="hidden" name="kind" value={entry.source.kind}/><input type="hidden" name="id" value={entry.source.id}/><input type="hidden" name="hash" value={entry.source.hash}/><input type="hidden" name="reviewId" value={entry.review?.id??0}/>
    <input type="hidden" name="year" value={year}/><input type="hidden" name="quarter" value={quarter}/>
    <input type="hidden" name="lines" value={JSON.stringify(lines.map(l=>({date:l.date,code:l.code,base:cents(l.base),tax:cents(l.tax),deductibleBps:cents(l.deductible)})))}/>
    {state.error&&<p role="alert" className="bank-message error">{state.error}</p>}
    <fieldset disabled={pending} className="bank-fieldset">
      {lines.map((line,i)=><fieldset className="vat-line-editor" key={i}><legend>VAT line {i+1}</legend>
        <label>VAT date<input aria-label={`VAT date ${i+1}`} type="date" required value={line.date} onChange={e=>update(i,'date',e.target.value)}/></label>
        <label className="vat-rubric-select">Rubriek<select aria-label={`Rubric ${i+1}`} value={line.code} onChange={e=>update(i,'code',e.target.value)}>{rubrics.filter(r=>r.code!=='5a').map(r=><option key={r.code} value={r.code}>{r.code} · {r.label}</option>)}</select></label>
        <label>Taxable base (€)<input aria-label={`Taxable base ${i+1}`} inputMode="decimal" required value={line.base} onChange={e=>update(i,'base',e.target.value)}/></label>
        <label>VAT (€)<input aria-label={`VAT amount ${i+1}`} inputMode="decimal" required value={line.tax} onChange={e=>update(i,'tax',e.target.value)}/></label>
        <label>Deductible (%)<input aria-label={`Deductible percentage ${i+1}`} inputMode="decimal" required value={line.deductible} onChange={e=>update(i,'deductible',e.target.value)}/></label>
        <button type="button" className="button" onClick={()=>setLines(lines.filter((_,j)=>j!==i))}>Remove line {i+1}</button>
      </fieldset>)}
      {!lines.length&&<p className="bank-message warning">Excluded from VAT. Explain why below (for example: bank fee, transfer, VAT settlement, or payment for an invoice already included).</p>}
      <button type="button" className="button" onClick={()=>setLines([...lines,{date:entry.source.date,code:'5b',base:'0.00',tax:'0.00',deductible:'100'}])}>Add VAT line</button>
      <p className="bank-help">Use invoice/supply dates appropriate to the transaction. Input VAT requires receipt of the invoice. Use negative base and VAT for credit notes. Reverse-charge VAT is included in both tax due and deductible VAT according to the percentage.</p>
      <label className="vat-note">Document reference / reason<textarea name="note" required maxLength={2000} defaultValue={entry.review?.note??entry.source.reference??''} placeholder="Invoice number and date; explain changes or exclusions. Reference the invoice counted elsewhere for a payment."/></label>
      <label className="bank-check"><input type="checkbox" name="confirmed" required/>I checked the document, VAT date, country/treatment and deductible percentage. This supply is counted only once.</label>
      <button className="button primary" disabled={pending}>{pending?'Saving…':'Save VAT review'}</button>
    </fieldset>
  </form>;
}
export function SnapshotForm({year,quarter,fingerprint,canSubmit,blocked}:{year:number;quarter:number;fingerprint:string;canSubmit:boolean;blocked:boolean}) {
  const [state,action,pending]=useActionState(snapshotAction,{});
  return <form action={action} className="vat-snapshot-form">
    <input type="hidden" name="year" value={year}/><input type="hidden" name="quarter" value={quarter}/><input type="hidden" name="fingerprint" value={fingerprint}/>
    {state.error&&<p role="alert" className="bank-message error">{state.error}</p>}
    <fieldset disabled={pending||blocked} className="bank-fieldset">
      <label className="bank-check"><input type="checkbox" name="complete" required/>I checked completeness (including unpaid purchases), invoice/payment duplicates, foreign supplies and any private-use or year-end corrections. Any ICP/OSS obligations are handled separately.</label>
      {canSubmit&&<label className="vat-note">Submission receipt/reference<input name="receipt" maxLength={500} placeholder="Reference from Mijn Belastingdienst Zakelijk"/></label>}
      <div className="header-actions"><button className="button" name="status" value="reviewed">{pending?'Saving…':'Save reviewed copy'}</button>
      {canSubmit&&<button className="button primary" name="status" value="submitted">Record completed submission</button>}</div>
    </fieldset>
    <p className="bank-help">Recording submission stores a frozen copy. Submit the declaration yourself in Mijn Belastingdienst Zakelijk; this action does not send it.</p>
  </form>;
}
