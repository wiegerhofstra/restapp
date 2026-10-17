'use client';
import { startTransition, useActionState, useState } from 'react';
import { Field } from '@/components/ui';
import { categories, checks } from '@/lib/income-tax/calculation';
import type { Category, Config } from '@/lib/income-tax/calculation';
import type { Workspace } from '@/lib/income-tax/service';
import { configAction, snapshotAction } from './actions';
import type { ActionState } from './actions';

function decimal(data:FormData,key:string) {
  const raw=String(data.get(key)??'').trim().replace(',','.');
  if(!/^-?\d+(\.\d{1,2})?$/.test(raw)) throw new Error('Vul geldbedragen en percentages in met maximaal twee decimalen.');
  return Math.round(Number(raw)*100);
}
const value=(cents:number)=>String(cents/100);
export function YearConfigForm({workspace:w}:{workspace:Workspace}) {
  const c=w.config,stale=c.reviewedSourceHash!==w.sourceHash;
  const [partners,setPartners]=useState(c.partners);
  const [adjustments,setAdjustments]=useState(c.adjustments.map((a,i)=>({...a,key:String(i)})));
  const [state,action,pending]=useActionState(async(_:ActionState,data:FormData)=>{
    try {
      const config:Config={...c,
        partners:partners.map(p=>({key:p.key,name:String(data.get(`name_${p.key}`)??''),shareBps:decimal(data,`share_${p.key}`),labourCents:decimal(data,`labour_${p.key}`),openingCapital:decimal(data,`opening_${p.key}`)})),
        mappings:w.accountRows.map(a=>({accountId:a.id,category:String(data.get(`category_${a.id}`)) as Category,partnerKey:String(data.get(`partner_${a.id}`)??'')})),
        adjustments:adjustments.filter(a=>String(data.get(`adjustment_label_${a.key}`)??'').trim() || String(data.get(`adjustment_amount_${a.key}`)??'0')!=='0').map(a=>({label:String(data.get(`adjustment_label_${a.key}`)??''),amount:decimal(data,`adjustment_amount_${a.key}`),partnerKey:String(data.get(`adjustment_partner_${a.key}`)??'')})),
        allocationNote:String(data.get('allocationNote')??''),allocationReviewed:data.get('allocationReviewed')==='on',mappingsReviewed:data.get('mappingsReviewed')==='on',
        checks:Object.fromEntries(Object.keys(checks).map(k=>[k,data.get(`check_${k}`)==='on'])) as Config['checks'],
      };
      data.set('config',JSON.stringify(config));return await configAction({},data);
    } catch(error) {
      // Next redirects must propagate; only input conversion errors are handled here.
      if(error && typeof error==='object' && 'digest' in error) throw error;
      return {error:error instanceof Error?error.message:'Controleer de invoer.'};
    }
  },{});
  const options=partners.map(p=><option key={p.key} value={p.key}>{p.name}</option>);
  return <form onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);startTransition(()=>action(data));}} className="card income-settings no-print" id="instellingen">
    <div className="card-header"><div><h2 className="card-title">Jaarinstellingen en controles</h2><p className="card-description">Gelden voor {w.year}. De indeling in dit overzicht verandert de oorspronkelijke boekingen niet.</p></div></div>
    <div className="card-body">
      <input type="hidden" name="year" value={w.year}/><input type="hidden" name="configId" value={w.configId}/><input type="hidden" name="sourceHash" value={w.sourceHash}/>
      {state.error&&<p role="alert" className="balance-callout warning">{state.error}</p>}
      <details open><summary>1. Vennoten, kapitaal en winstverdeling</summary>
        <p className="field-hint">De arbeidsvergoeding is een verdeling van winst, geen loonkosten. Eerst worden de vergoedingen toegerekend; de resterende winst of het verlies wordt volgens de percentages verdeeld. Het beginkapitaal volgt uw werkelijke vermogensrechten, niet automatisch het winstpercentage.</p>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Vennoot</th><th>Resterende winst (%)</th><th>Arbeidsvergoeding (€)</th><th>Beginkapitaal (€)</th></tr></thead><tbody>{partners.map(p=><tr key={p.key}>
          <td><input aria-label={`Naam ${p.name}`} name={`name_${p.key}`} defaultValue={p.name} maxLength={100} required onChange={e=>setPartners(old=>old.map(x=>x.key===p.key?{...x,name:e.target.value}:x))}/></td>
          <td><input aria-label={`Winstpercentage ${p.name}`} name={`share_${p.key}`} defaultValue={value(p.shareBps)} inputMode="decimal" required/></td>
          <td><input aria-label={`Arbeidsvergoeding ${p.name}`} name={`labour_${p.key}`} defaultValue={value(p.labourCents)} inputMode="decimal" required/></td>
          <td><input aria-label={`Beginkapitaal ${p.name}`} name={`opening_${p.key}`} defaultValue={value(p.openingCapital)} inputMode="decimal" required/></td>
        </tr>)}</tbody></table></div>
        <button type="button" className="button small" onClick={()=>setPartners(old=>[...old,{key:crypto.randomUUID(),name:'Nieuwe vennoot',shareBps:0,labourCents:0,openingCapital:0}])}>Vennoot toevoegen</button>
        <Field name="allocationNote" label="Afspraak en onderbouwing van de winstverdeling"><textarea name="allocationNote" id="allocationNote" defaultValue={c.allocationNote} maxLength={4000} rows={3}/></Field>
        <label className="bank-check"><input type="checkbox" name="allocationReviewed" defaultChecked={c.allocationReviewed&&!stale}/>De rechtsgeldigheid en fiscale verwerking van deze winstverdeling zijn beoordeeld; de onderbouwing staat hierboven.</label>
        <p className="field-hint">De voorgestelde 100/0-verdeling is voorlopig. Een afspraak die een vennoot structureel van alle winst uitsluit vraagt beoordeling. Opslaan van een concept is geen fiscale goedkeuring.</p>
      </details>
      <details><summary>2. Grootboek indelen en privéopnamen koppelen</summary>
        <p className="field-hint">Kies voor iedere rekening de rubriek. Koppel privé- en kapitaalrekeningen aan de juiste vennoot. Bij een gemengde rekening splitst u eerst de boekingen in het grootboek. Gebruik kapitaalmutaties alleen voor inbreng/opnamen, niet voor een resultaatbestemming.</p>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Grootboekrekening</th><th>Rubriek jaaroverzicht</th><th>Vennoot bij privé/kapitaal</th></tr></thead><tbody>{w.accountRows.map(a=><tr key={a.id}><td><a href={`/accounts/${a.id}`}>{a.name}</a></td><td><select aria-label={`Rubriek ${a.name}`} name={`category_${a.id}`} defaultValue={a.category}>{Object.entries(categories).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></td><td><select aria-label={`Vennoot ${a.name}`} name={`partner_${a.id}`} defaultValue={a.partnerKey}><option value="">Niet van toepassing</option>{options}</select></td></tr>)}</tbody></table></div>
        <label className="bank-check"><input type="checkbox" name="mappingsReviewed" defaultChecked={c.mappingsReviewed&&!stale}/>Ik heb de indeling en de koppeling van privé- en kapitaalrekeningen gecontroleerd.</label>
      </details>
      <details><summary>3. Fiscale correcties</summary>
        <p className="field-hint">Alleen correcties die nog niet in de getoonde winst zijn verwerkt. Positief verhoogt de fiscale winst, negatief verlaagt deze. Een gezamenlijke correctie volgt de winstpercentages. Jaarafgrenzing, ontbrekende facturen en afschrijvingsboekingen verwerkt u eerst in het grootboek. Ondernemersaftrek en mkb-winstvrijstelling horen niet in deze lijst.</p>
        {adjustments.map(a=><div key={a.key} className="income-adjustment"><Field name={`adjustment_label_${a.key}`} label="Toelichting en bewijsstuk"><input id={`adjustment_label_${a.key}`} name={`adjustment_label_${a.key}`} defaultValue={a.label} maxLength={500}/></Field><Field name={`adjustment_amount_${a.key}`} label="Correctie (€)"><input id={`adjustment_amount_${a.key}`} name={`adjustment_amount_${a.key}`} defaultValue={value(a.amount)} inputMode="decimal"/></Field><Field name={`adjustment_partner_${a.key}`} label="Toerekenen aan"><select id={`adjustment_partner_${a.key}`} name={`adjustment_partner_${a.key}`} defaultValue={a.partnerKey}><option value="">Volgens winstpercentages</option>{options}</select></Field><button type="button" className="button small" onClick={()=>setAdjustments(old=>old.filter(x=>x.key!==a.key))}>Verwijderen</button></div>)}
        <button type="button" className="button small" onClick={()=>setAdjustments(old=>[...old,{key:crypto.randomUUID(),label:'',amount:0,partnerKey:''}])}>Fiscale correctie toevoegen</button>
      </details>
      <details><summary>4. Jaarafsluiting controleren</summary>
        {Object.entries(checks).map(([key,label])=><label key={key} className="bank-check"><input type="checkbox" name={`check_${key}`} defaultChecked={c.checks[key as keyof typeof checks]&&!stale}/>{label}</label>)}
        <p className="field-hint">Na wijziging van brongegevens vragen deze controles opnieuw aandacht. Aftrekposten, urencriterium, buitenvennootschappelijk vermogen en overige persoonlijke gegevens beoordeelt u aanvullend bij uw aangifte.</p>
      </details>
      <button className="button primary" disabled={pending}>{pending?'Opslaan…':'Jaarinstellingen opslaan en herberekenen'}</button>
    </div>
  </form>;
}
export function SnapshotForm({workspace:w}:{workspace:Workspace}) {
  const [state,action,pending]=useActionState(snapshotAction,{});
  return <form action={action} className="income-snapshot no-print">
    <input type="hidden" name="year" value={w.year}/><input type="hidden" name="fingerprint" value={w.fingerprint}/>
    {state.error&&<p role="alert" className="balance-callout warning">{state.error}</p>}
    <label className="bank-check"><input type="checkbox" name="confirmed"/>Ik heb de jaarcijfers, fiscale correcties en persoonlijke toerekening gecontroleerd.</label>
    <div className="header-actions"><button name="status" value="draft" className="button" disabled={pending}>Conceptversie bewaren</button><button name="status" value="reviewed" className="button primary" disabled={pending||w.issues.length>0}>Gecontroleerde versie bewaren</button></div>
    <p className="field-hint">Bewaren dient geen aangifte in bij de Belastingdienst. Openstaande controles blijven zichtbaar in iedere conceptversie.</p>
  </form>;
}
export function CopyAmount({cents}:{cents:number}) {
  const [message,setMessage]=useState('Kopiëren');
  return <button type="button" className="button small no-print" aria-label={`Kopieer ${(cents/100).toFixed(2).replace('.',',')}`} onClick={async()=>{try{await navigator.clipboard.writeText((cents/100).toFixed(2).replace('.',','));setMessage('Gekopieerd');}catch{setMessage('Kopiëren mislukt');}}}>{message}</button>;
}
