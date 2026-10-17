'use client';
import { useActionState, useState } from 'react';
import { reviewAction, snapshotAction } from './actions';
import { rubrics, type VatLine } from '@/lib/vat/calculation';
import type { Entry } from '@/lib/vat/service';

export function CopyValue({value}:{value:number}) {
  const [message,setMessage]=useState('');
  return <><button type="button" className="vat-copy" aria-label={`Kopieer ${value}`} onClick={async()=>{
    try {await navigator.clipboard.writeText(String(value));setMessage("Gekopieerd");} catch {setMessage("Selecteer het bedrag om te kopiëren");}
  }}>{value.toLocaleString('nl-NL')}</button><span className="vat-copy-feedback" aria-live="polite">{message}</span></>;
}

type EditableLine={date:string;code:VatLine['code'];base:string;tax:string;deductible:string};
function cents(value:string) {const n=value.trim().replace(',','.');return /^-?\d+(\.\d{1,2})?$/.test(n)?Math.round(Number(n)*100):null;}
export function ReviewForm({entry,year,quarter}:{entry:Entry;year:number;quarter:number}) {
  const [state,action,pending]=useActionState(reviewAction,{});
  const [lines,setLines]=useState<EditableLine[]>(entry.lines.map(l=>({date:l.date,code:l.code,base:(l.base/100).toFixed(2).replace('.',','),tax:(l.tax/100).toFixed(2).replace('.',','),deductible:String(l.deductibleBps/100).replace('.',',')})));
  const update=(index:number,key:keyof EditableLine,value:string)=>setLines(current=>current.map((l,i)=>i===index?{...l,[key]:value,...(key==='code'?{deductible:['2a','4a','4b','5b'].includes(value)?'100':'0',...(['1e','3a','3b','3c'].includes(value)?{tax:'0'}:{})}:{})}:l));
  return <form action={action} className="vat-review-form">
    <input type="hidden" name="kind" value={entry.source.kind}/><input type="hidden" name="id" value={entry.source.id}/><input type="hidden" name="hash" value={entry.source.hash}/><input type="hidden" name="reviewId" value={entry.review?.id??0}/>
    <input type="hidden" name="year" value={year}/><input type="hidden" name="quarter" value={quarter}/>
    <input type="hidden" name="lines" value={JSON.stringify(lines.map(l=>({date:l.date,code:l.code,base:cents(l.base),tax:cents(l.tax),deductibleBps:cents(l.deductible)})))}/>
    {state.error&&<p role="alert" className="bank-message error">{state.error}</p>}
    <fieldset disabled={pending} className="bank-fieldset">
      {lines.map((line,i)=><fieldset className="vat-line-editor" key={i}><legend>Btw-regel {i+1}</legend>
        <label>Btw-datum<input aria-label={`Btw-datum ${i+1}`} type="date" required value={line.date} onChange={e=>update(i,'date',e.target.value)}/></label>
        <label className="vat-rubric-select">Rubriek<select aria-label={`Rubriek ${i+1}`} value={line.code} onChange={e=>update(i,'code',e.target.value)}>{rubrics.filter(r=>r.code!=='5a').map(r=><option key={r.code} value={r.code}>{r.code} · {r.label}</option>)}</select></label>
        <label>Maatstaf van heffing (€)<input aria-label={`Maatstaf van heffing ${i+1}`} inputMode="decimal" required value={line.base} onChange={e=>update(i,'base',e.target.value)}/></label>
        <label>Btw (€)<input aria-label={`Btw-bedrag ${i+1}`} inputMode="decimal" required value={line.tax} onChange={e=>update(i,'tax',e.target.value)}/></label>
        <label>Aftrekbaar (%)<input aria-label={`Aftrekpercentage ${i+1}`} inputMode="decimal" required value={line.deductible} onChange={e=>update(i,'deductible',e.target.value)}/></label>
        <button type="button" className="button" onClick={()=>setLines(lines.filter((_,j)=>j!==i))}>Regel verwijderen {i+1}</button>
      </fieldset>)}
      {!lines.length&&<p className="bank-message warning">Niet opgenomen in de btw-aangifte. Licht hieronder toe waarom, bijvoorbeeld bankkosten, overboeking, btw-betaling of betaling van een al opgenomen factuur.</p>}
      <button type="button" className="button" onClick={()=>setLines([...lines,{date:entry.source.date,code:'5b',base:'0,00',tax:'0,00',deductible:'100'}])}>Btw-regel toevoegen</button>
      <p className="bank-help">Gebruik de toepasselijke factuur- of prestatiedatum. Voor aftrek van voorbelasting moet de factuur zijn ontvangen. Gebruik een negatieve grondslag en negatief btw-bedrag voor creditnota’s. Verlegde btw telt mee als verschuldigde btw en, volgens het aftrekpercentage, als voorbelasting.</p>
      <label className="vat-note">Factuur- of documentkenmerk / toelichting<textarea name="note" required maxLength={2000} defaultValue={entry.review?.note??entry.source.reference??''} placeholder="Vermeld factuurnummer en datum. Licht wijzigingen of uitsluitingen toe. Verwijs bij een betaling naar de factuur die al is opgenomen."/></label>
      <label className="bank-check"><input type="checkbox" name="confirmed" required/>Ik heb het bewijsstuk, de btw-datum, het land, de fiscale behandeling en het aftrekpercentage gecontroleerd. Deze prestatie wordt slechts eenmaal opgenomen.</label>
      <button className="button primary" disabled={pending}>{pending?"Opslaan…":"Btw-controle opslaan"}</button>
    </fieldset>
  </form>;
}
export function SnapshotForm({year,quarter,fingerprint,canSubmit,blocked}:{year:number;quarter:number;fingerprint:string;canSubmit:boolean;blocked:boolean}) {
  const [state,action,pending]=useActionState(snapshotAction,{});
  return <form action={action} className="vat-snapshot-form">
    <input type="hidden" name="year" value={year}/><input type="hidden" name="quarter" value={quarter}/><input type="hidden" name="fingerprint" value={fingerprint}/>
    {state.error&&<p role="alert" className="bank-message error">{state.error}</p>}
    <fieldset disabled={pending||blocked} className="bank-fieldset">
      <label className="bank-check"><input type="checkbox" name="complete" required/>Ik heb de volledigheid en de automatisch toegepaste leveranciersregels gecontroleerd, inclusief onbetaalde inkoopfacturen, dubbel getelde facturen en betalingen, buitenlandse prestaties en correcties voor privégebruik of het jaareinde. Eventuele ICP- en OSS-verplichtingen worden afzonderlijk afgehandeld.</label>
      {canSubmit&&<label className="vat-note">Kenmerk ontvangstbevestiging<input name="receipt" maxLength={500} placeholder="Kenmerk uit Mijn Belastingdienst Zakelijk"/></label>}
      <div className="header-actions"><button className="button" name="status" value="reviewed">{pending?"Opslaan…":"Gecontroleerde versie opslaan"}</button>
      {canSubmit&&<button className="button primary" name="status" value="submitted">Indiening vastleggen</button>}</div>
    </fieldset>
    <p className="bank-help">Bij het vastleggen van de indiening wordt een onveranderlijke versie opgeslagen. Dien de aangifte zelf in via Mijn Belastingdienst Zakelijk. Deze knop verstuurt de aangifte niet.</p>
  </form>;
}
