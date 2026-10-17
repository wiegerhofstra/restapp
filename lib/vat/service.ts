import { labelNl } from '../dutch.ts';
import { createHash } from 'node:crypto';
import { db, row, rows } from '../db.ts';
import { calculateVat, period, validateLines, type VatLine } from './calculation.ts';
import { classifySupplier, outsideVatReturn, supplierTreatmentLabel, type SupplierRule, type RuleContext, type Posting } from './supplier-rules.ts';

export type Source = {kind:'transaction'|'invoice'; id:number; date:string; description:string; reference:string; lines:Record<string,unknown>[]; hash:string; balance:number; status?:string; deleted?:boolean};
export type Review = {id:number; source_kind:Source['kind']; source_id:number; source_hash:string; source_snapshot:Source; lines:VatLine[]; note:string; actor:string; created_at:string};
export type Entry = {source:Source; review?:Review; lines:VatLine[]; state:'needs_review'|'reviewed'|'changed'|'deleted'|'rule_applied'; hint:string; supplierRule?:SupplierRule;supplierAssignment?:unknown[];roundingNote?:string};
export type Snapshot = {id:number; year:number; quarter:number; status:'reviewed'|'submitted'; fingerprint:string; payload:Workspace; receipt:string; actor:string; created_at:string};
export function hash(value:unknown) {
  // JSONB reorders object keys. Fingerprints must survive a database round trip.
  const canonical=JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)
    ?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
  return createHash('sha256').update(canonical).digest('hex');
}
const inPeriod=(date:string,p:ReturnType<typeof period>)=>date>=p.start&&date<=p.end;

export async function sources():Promise<Source[]> {
  const transactions=await rows<{id:number;date:string;description:string;reference:string;lines:Record<string,unknown>[]}>(`
    SELECT t.id,t.transaction_date date,t.description,t.reference,
      COALESCE(jsonb_agg(jsonb_build_object('id',l.id,'account',a.name,'kind',a.kind,'debit',l.debit_cents,'credit',l.credit_cents,'memo',l.memo) ORDER BY l.id) FILTER(WHERE l.id IS NOT NULL),'[]') lines
    FROM transactions t LEFT JOIN transaction_lines l ON l.transaction_id=t.id LEFT JOIN accounts a ON a.id=l.account_id GROUP BY t.id ORDER BY t.id`);
  const invoices=await rows<{id:number;date:string;description:string;reference:string;status:string;lines:Record<string,unknown>[]}>(`
    SELECT i.id,i.issue_date date,i.concern description,i.invoice_number::text reference,i.status,
      COALESCE(jsonb_agg(jsonb_build_object('id',l.id,'description',l.description,'quantity',l.quantity_milli,'price',l.unit_price_cents,'rate',l.tax_rate_basis_points) ORDER BY l.id) FILTER(WHERE l.id IS NOT NULL),'[]') lines
    FROM invoices i LEFT JOIN invoice_lines l ON l.invoice_id=i.id GROUP BY i.id ORDER BY i.id`);
  return [...transactions.map(t=>({...t,kind:'transaction' as const,balance:t.lines.reduce((n,l)=>n+Number(l.debit)-Number(l.credit),0)})),
    ...invoices.map(i=>({...i,kind:'invoice' as const,balance:0}))].map(s=>({...s,hash:hash(s)}));
}

export async function supplierRules():Promise<SupplierRule[]> {
  if(!(await row<{table:string|null}>("SELECT to_regclass('vat_supplier_rules')::text AS table"))?.table) return [];
  return rows<SupplierRule>(`SELECT r.*,to_jsonb(s) supplier FROM
    (SELECT DISTINCT ON (supplier_id,rule_key) * FROM vat_supplier_rules ORDER BY supplier_id,rule_key,id DESC) r
    JOIN suppliers s ON s.id=r.supplier_id ORDER BY r.supplier_id`);
}
export async function ruleContexts():Promise<Map<number,RuleContext>> {
  const postings=await rows<Posting & {transactionId:number}>(`SELECT l.transaction_id "transactionId",l.account_id "accountId",a.name,a.kind,l.debit_cents debit,l.credit_cents credit
    FROM transaction_lines l JOIN accounts a ON a.id=l.account_id ORDER BY l.id`);
  const contexts=new Map<number,RuleContext>();
  for(const p of postings) {
    const c=contexts.get(p.transactionId)??{postings:[],batch:false};c.postings.push(p);contexts.set(p.transactionId,c);
  }
  if((await row<{ready:boolean}>("SELECT to_regclass('bank_accounts') IS NOT NULL ready"))?.ready) {
    const banks=await rows<{account_id:number}>('SELECT account_id FROM bank_accounts');
    for(const c of contexts.values()) c.bankAccountIds=c.postings.filter(p=>banks.some(b=>b.account_id===p.accountId)).map(p=>p.accountId);
  }
  const batches=await rows<{transaction_id:number}>(`SELECT transaction_id FROM bank_entries WHERE transaction_id IS NOT NULL
    GROUP BY transaction_id HAVING count(*)>1 OR bool_or(warning<>'' OR jsonb_array_length(details)>1)`);
  for(const b of batches){const c=contexts.get(b.transaction_id);if(c)c.batch=true;}
  if((await row<{ready:boolean}>("SELECT to_regclass('bank_supplier_links') IS NOT NULL ready"))?.ready) {
    const links=await rows<{transaction_id:number;entry_id:number;supplier_id:number|null;mode:string;status:string;version:number}>(`SELECT e.transaction_id,l.entry_id,l.supplier_id,l.mode,l.status,l.version
      FROM bank_supplier_links l JOIN bank_entries e ON e.id=l.entry_id WHERE e.transaction_id IS NOT NULL ORDER BY e.id`);
    for(const l of links) {
      const c=contexts.get(l.transaction_id);if(!c)continue;
      (c.supplierEvidence??=[]).push(l);
      if(l.status==='ambiguous'||l.status==='batch'||(l.mode==='manual'&&!l.supplier_id)) c.supplierBlockedReason='Controleer eerst de leverancierskoppeling van de bankmutatie.';
      if(l.supplier_id) {
        if(c.supplierId!==undefined&&c.supplierId!==l.supplier_id) c.supplierBlockedReason='Bankmutaties zijn aan verschillende leveranciers gekoppeld.';
        c.supplierId=l.supplier_id;
      }
    }
  }
  return contexts;
}

export function suggest(source:Source):{lines:VatLine[];hint:string} {
  const line=(code:VatLine['code'],base:number,tax:number,deductibleBps=0):VatLine=>({date:source.date,code,base,tax,deductibleBps});
  if(source.kind==='invoice') {
    if(source.status==='draft'||source.status==='cancelled') return {lines:[],hint:"Conceptfactuur of geannuleerde factuur: controleer of deze is uitgereikt voordat u deze uitsluit."};
    return {lines:source.lines.map(l=>{
      const base=Math.round(Number(l.quantity)*Number(l.price)/1000), rate=Number(l.rate);
      return line(rate===2100?'1a':rate===900||rate===600?'1b':rate===0?'1e':'1c',base,Math.round(base*rate/10000));
    }),hint:"Controleer de factuurdatum en het land van de klant. Neem de factuur één keer op. Sluit de bijbehorende betaling uit van de btw-aangifte en vermeld het factuurkenmerk."};
  }
  const net=(l:Record<string,unknown>)=>Number(l.debit)-Number(l.credit);
  const sum=(name:string)=>source.lines.filter(l=>l.account===name).reduce((n,l)=>n+net(l),0);
  const reverse=-sum('BTW 21% verlegd'), input=sum('BTW advanced 21%'), output=-sum('BTW 21%');
  const expense=source.lines.filter(l=>l.kind==='expense').reduce((n,l)=>n+net(l),0);
  const income=-source.lines.filter(l=>l.kind==='income').reduce((n,l)=>n+net(l),0);
  if(reverse&&!input&&!output&&expense) return {lines:[line('4b',expense,reverse,10000)],hint:"Voorgesteld: verlegde btw uit een EU-land, op basis van de grootboekrekeningen. Controleer prestatiedatum, grondslag en aftrek aan de hand van de factuur. Controleer welke verleggingsregeling geldt (2a, 4a of 4b). Alleen het land van de leverancier is niet voldoende."};
  if(input&&!reverse&&!output) return {lines:[line('5b',expense,input,10000)],hint:"Voorgesteld: voorbelasting op basis van het grootboek. Controleer de ontvangst van de factuur, btw-datum, grondslag en aftrek voor zakelijk gebruik."};
  if(output&&!reverse&&!input&&income) return {lines:[line('1a',income,output)],hint:"Voorgesteld: binnenlandse omzet tegen 21%. Controleer de factuur en btw-datum. Sluit deze betaling uit als de factuur afzonderlijk is opgenomen."};
  return {lines:[],hint:"Geen betrouwbare automatische btw-behandeling gevonden. Sluit niet-btw-posten uit met een toelichting of voeg de btw-regels van de factuur toe. Let extra op vooruitbetalingen, terugbetalingen en verschillende btw-tarieven."};
}

async function allEntries():Promise<Entry[]> {
  const all=await sources();
  const rules=await supplierRules();
  const contexts=rules.some(r=>r.active)?await ruleContexts():new Map<number,RuleContext>();
  const reviews=await rows<Review>('SELECT DISTINCT ON (source_kind,source_id) * FROM vat_reviews ORDER BY source_kind,source_id,id DESC');
  const bySource=new Map(reviews.map(r=>[`${r.source_kind}:${r.source_id}`,r]));
  const entries:Entry[]=all.map(source=>{
    const review=bySource.get(`${source.kind}:${source.id}`);
    let suggestion=suggest(source);
    try {validateLines(suggestion.lines);} catch {suggestion={lines:[],hint:"De btw-behandeling kan niet betrouwbaar worden afgeleid uit de boeking. Controleer het bewijsstuk en voer de btw-regels handmatig in."};}
    bySource.delete(`${source.kind}:${source.id}`);
    // A manual review is authoritative, including stale reviews which must be
    // checked again. Rules never silently overwrite a person's VAT decision.
    if(!review&&source.kind==='transaction') {
      const result=classifySupplier(source,contexts.get(source.id)??{postings:[],batch:false},rules);
      if(result.rule&&result.lines) return {source,lines:result.lines,state:'rule_applied',hint:outsideVatReturn(result.rule.config.code)?`${supplierTreatmentLabel(result.rule.config.code)}, volgens de leveranciersregel van ${result.rule.supplier.name}.`:`Automatisch verwerkt volgens de leveranciersregel van ${result.rule.supplier.name}.${result.notice?' '+result.notice:''}`,supplierRule:result.rule,...(result.notice?{roundingNote:result.notice}:{}),...(contexts.get(source.id)?.supplierEvidence?{supplierAssignment:contexts.get(source.id)!.supplierEvidence}:{})};
      if(result.reason) suggestion.hint=result.reason;
    }
    return {source,review,lines:review?.lines??suggestion.lines,state:review?(review.source_hash===source.hash?'reviewed':'changed'):'needs_review',hint:suggestion.hint};
  });
  for(const review of bySource.values()) {
    const evidence={...review.source_snapshot,hash:'',deleted:true};
    const source={...evidence,hash:hash(evidence)};
    entries.push({source,review,lines:review.lines,state:review.source_hash===source.hash&&!review.lines.length?'reviewed':'deleted',hint:"Deze bron is verwijderd. Verwijder de btw-regels en licht de verwijdering toe om de uitsluiting te bevestigen. Eerdere controles en ingediende versies blijven in de historie bewaard."});
  }
  return entries.sort((a,b)=>a.source.date.localeCompare(b.source.date)||a.source.kind.localeCompare(b.source.kind)||a.source.id-b.source.id);
}
export async function getReviewEntry(kind:string,id:number) {
  return db.transaction(async()=>{await db.prepare('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ').run();return (await allEntries()).find(e=>e.source.kind===kind&&e.source.id===id);})();
}

async function workspace(year:number,quarter:number) {
  const p=period(year,quarter);
  const entries=(await allEntries()).filter(e=>inPeriod(e.source.date,p)||e.lines.some(l=>inPeriod(l.date,p)));
  const pending=await rows<{id:number;booking_date:string;description:string}>('SELECT id,booking_date,description FROM bank_entries WHERE transaction_id IS NULL AND booking_date BETWEEN ? AND ? ORDER BY booking_date,id',p.start,p.end);
  const blockers=entries.filter(e=>!['reviewed','rule_applied'].includes(e.state)||(!e.source.deleted&&e.source.balance!==0)).map(e=>`${labelNl(e.source.kind)} #${e.source.id}: ${!e.source.deleted&&e.source.balance!==0?"boeking niet in evenwicht":labelNl(e.state)}`);
  for(const b of pending) blockers.push(`Bankmutatie #${b.id} is niet verwerkt.`);
  const lines=entries.flatMap(e=>e.lines.filter(l=>inPeriod(l.date,p)));
  const result=calculateVat(lines);
  const fingerprint=hash({version:1,p,entries,pending,result});
  return {...p,...result,entries,pending,blockers,fingerprint};
}
export type Workspace = Awaited<ReturnType<typeof workspace>>;
export async function getWorkspace(year:number,quarter:number) {
  return db.transaction(async()=>{
    await db.prepare('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ').run();
    const current=await workspace(year,quarter);
    const snapshots=await rows<Snapshot>('SELECT * FROM vat_snapshots WHERE year=? AND quarter=? ORDER BY id DESC',year,quarter);
    return {current,snapshots};
  })();
}
// Serialize reviews and snapshots, then hold the source tables stable until commit.
// This also detects edits in other tabs rather than silently approving a stale page.
export async function lockSources() {
  await db.prepare('SELECT pg_advisory_xact_lock(713055)').all();
  await db.prepare('LOCK TABLE transactions,transaction_lines,accounts,invoices,invoice_lines,bank_entries IN SHARE MODE').run();
  if((await row<{table:string|null}>("SELECT to_regclass('vat_supplier_rules')::text AS table"))?.table) await db.prepare('LOCK TABLE suppliers,vat_supplier_rules IN SHARE MODE').run();
}
export async function saveReview(kind:string,id:number,expectedHash:string,expectedReview:number,input:unknown,note:string,actor:string) {
  const lines=validateLines(input);
  if(!note.trim()||note.length>2000) throw new Error("Vermeld een factuur- of documentkenmerk of licht de uitsluiting toe (maximaal 2.000 tekens).");
  return db.transaction(async()=>{
    await lockSources();
    const entry=(await allEntries()).find(e=>e.source.kind===kind&&e.source.id===id);
    if(!entry) throw new Error("De bron bestaat niet meer.");
    if(entry.source.deleted&&lines.length) throw new Error("Sluit de verwijderde bron uit door de btw-regels te verwijderen.");
    if(entry.source.hash!==expectedHash||(entry.review?.id??0)!==expectedReview) throw new Error("Deze bron of de controle ervan is gewijzigd. Vernieuw de pagina voordat u controleert.");
    if(!entry.source.deleted&&entry.source.balance!==0) throw new Error("Maak de boeking sluitend voordat u de btw controleert.");
    await db.prepare('INSERT INTO vat_reviews(source_kind,source_id,source_hash,source_snapshot,lines,note,actor) VALUES(?,?,?,?,?,?,?)')
      .run(kind,id,expectedHash,JSON.stringify(entry.source),JSON.stringify(lines),note.trim(),actor);
  })();
}
export async function saveSnapshot(year:number,quarter:number,fingerprint:string,status:'reviewed'|'submitted',receipt:string,actor:string) {
  return db.transaction(async()=>{
    await lockSources();
    const current=await workspace(year,quarter);
    if(current.fingerprint!==fingerprint) throw new Error("De aangifte is gewijzigd. Vernieuw de pagina en controleer de actuele bedragen.");
    if(current.blockers.length) throw new Error("Werk eerst alle controlepunten en onverwerkte bankmutaties af.");
    const previous=await row<Snapshot>('SELECT * FROM vat_snapshots WHERE year=? AND quarter=? ORDER BY id DESC LIMIT 1',year,quarter);
    if(status==='submitted'&&(!previous||previous.status!=='reviewed'||previous.fingerprint!==fingerprint)) throw new Error("Sla eerst een gecontroleerde versie van de actuele aangifte op voordat u de indiening vastlegt.");
    if(status==='submitted'&&(!receipt.trim()||receipt.length>500)) throw new Error("Vul het kenmerk van de ontvangstbevestiging in (maximaal 500 tekens).");
    return (await db.prepare('INSERT INTO vat_snapshots(year,quarter,status,fingerprint,payload,receipt,previous_id,actor) VALUES(?,?,?,?,?,?,?,?)')
      .run(year,quarter,status,fingerprint,JSON.stringify(current),receipt.trim(),previous?.id??null,actor)).lastInsertRowid;
  })();
}
