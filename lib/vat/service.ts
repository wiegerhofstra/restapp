import { createHash } from 'node:crypto';
import { db, row, rows } from '../db.ts';
import { calculateVat, period, validateLines, type VatLine } from './calculation.ts';

export type Source = {kind:'transaction'|'invoice'; id:number; date:string; description:string; reference:string; lines:Record<string,unknown>[]; hash:string; balance:number; status?:string; deleted?:boolean};
export type Review = {id:number; source_kind:Source['kind']; source_id:number; source_hash:string; source_snapshot:Source; lines:VatLine[]; note:string; actor:string; created_at:string};
export type Entry = {source:Source; review?:Review; lines:VatLine[]; state:'needs_review'|'reviewed'|'changed'|'deleted'; hint:string};
export type Snapshot = {id:number; year:number; quarter:number; status:'reviewed'|'submitted'; fingerprint:string; payload:Workspace; receipt:string; actor:string; created_at:string};
export function hash(value:unknown) {
  // JSONB reorders object keys. Fingerprints must survive a database round trip.
  const canonical=JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)
    ?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
  return createHash('sha256').update(canonical).digest('hex');
}
const inPeriod=(date:string,p:ReturnType<typeof period>)=>date>=p.start&&date<=p.end;

async function sources():Promise<Source[]> {
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

export function suggest(source:Source):{lines:VatLine[];hint:string} {
  const line=(code:VatLine['code'],base:number,tax:number,deductibleBps=0):VatLine=>({date:source.date,code,base,tax,deductibleBps});
  if(source.kind==='invoice') {
    if(source.status==='draft'||source.status==='cancelled') return {lines:[],hint:'Draft/cancelled invoice: confirm whether it was issued before excluding it.'};
    return {lines:source.lines.map(l=>{
      const base=Math.round(Number(l.quantity)*Number(l.price)/1000), rate=Number(l.rate);
      return line(rate===2100?'1a':rate===900||rate===600?'1b':rate===0?'1e':'1c',base,Math.round(base*rate/10000));
    }),hint:'Check invoice date and customer country. Count this invoice once; exclude a matching payment from VAT with the invoice reference.'};
  }
  const net=(l:Record<string,unknown>)=>Number(l.debit)-Number(l.credit);
  const sum=(name:string)=>source.lines.filter(l=>l.account===name).reduce((n,l)=>n+net(l),0);
  const reverse=-sum('BTW 21% verlegd'), input=sum('BTW advanced 21%'), output=-sum('BTW 21%');
  const expense=source.lines.filter(l=>l.kind==='expense').reduce((n,l)=>n+net(l),0);
  const income=-source.lines.filter(l=>l.kind==='income').reduce((n,l)=>n+net(l),0);
  if(reverse&&!input&&!output&&expense) return {lines:[line('4b',expense,reverse,10000)],hint:'Suggested EU reverse charge from ledger accounts. Verify supply date, tax base and deduction from the invoice. Check which reverse-charge rules apply (2a, 4a or 4b); supplier country alone is not enough.'};
  if(input&&!reverse&&!output) return {lines:[line('5b',expense,input,10000)],hint:'Suggested input VAT from the ledger. Check invoice receipt, tax date, taxable base and business-use deduction.'};
  if(output&&!reverse&&!input&&income) return {lines:[line('1a',income,output)],hint:'Suggested domestic 21% sale. Check the invoice and VAT date; exclude this payment if the invoice is counted separately.'};
  return {lines:[],hint:'No reliable automatic classification. Exclude non-VAT movements with a reason, or add the VAT lines from the invoice. Prepayments, refunds and mixed rates need particular care.'};
}

async function allEntries():Promise<Entry[]> {
  const all=await sources();
  const reviews=await rows<Review>('SELECT DISTINCT ON (source_kind,source_id) * FROM vat_reviews ORDER BY source_kind,source_id,id DESC');
  const bySource=new Map(reviews.map(r=>[`${r.source_kind}:${r.source_id}`,r]));
  const entries:Entry[]=all.map(source=>{
    const review=bySource.get(`${source.kind}:${source.id}`);
    let suggestion=suggest(source);
    try {validateLines(suggestion.lines);} catch {suggestion={lines:[],hint:'The source cannot be classified reliably from its postings. Review the document and enter the VAT lines manually.'};}
    bySource.delete(`${source.kind}:${source.id}`);
    return {source,review,lines:review?.lines??suggestion.lines,state:review?(review.source_hash===source.hash?'reviewed':'changed'):'needs_review',hint:suggestion.hint};
  });
  for(const review of bySource.values()) {
    const evidence={...review.source_snapshot,hash:'',deleted:true};
    const source={...evidence,hash:hash(evidence)};
    entries.push({source,review,lines:review.lines,state:review.source_hash===source.hash&&!review.lines.length?'reviewed':'deleted',hint:'This source was deleted. Remove its VAT lines and explain the deletion to acknowledge its exclusion. The earlier review and any submitted copies remain in the history.'});
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
  const blockers=entries.filter(e=>e.state!=='reviewed'||(!e.source.deleted&&e.source.balance!==0)).map(e=>`${e.source.kind} #${e.source.id}: ${!e.source.deleted&&e.source.balance!==0?'unbalanced ledger':e.state.replaceAll('_',' ')}`);
  for(const b of pending) blockers.push(`Bank entry #${b.id} is not processed.`);
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
async function lockSources() {
  await db.prepare('SELECT pg_advisory_xact_lock(713055)').all();
  await db.prepare('LOCK TABLE transactions,transaction_lines,accounts,invoices,invoice_lines,bank_entries IN SHARE MODE').run();
}
export async function saveReview(kind:string,id:number,expectedHash:string,expectedReview:number,input:unknown,note:string,actor:string) {
  const lines=validateLines(input);
  if(!note.trim()||note.length>2000) throw new Error('Add an invoice/document reference or explain the exclusion (maximum 2,000 characters).');
  return db.transaction(async()=>{
    await lockSources();
    const entry=(await allEntries()).find(e=>e.source.kind===kind&&e.source.id===id);
    if(!entry) throw new Error('The source no longer exists.');
    if(entry.source.deleted&&lines.length) throw new Error('Exclude the deleted source by removing its VAT lines.');
    if(entry.source.hash!==expectedHash||(entry.review?.id??0)!==expectedReview) throw new Error('This source or its review changed. Reload before reviewing.');
    if(!entry.source.deleted&&entry.source.balance!==0) throw new Error('Balance the ledger transaction before reviewing its VAT.');
    await db.prepare('INSERT INTO vat_reviews(source_kind,source_id,source_hash,source_snapshot,lines,note,actor) VALUES(?,?,?,?,?,?,?)')
      .run(kind,id,expectedHash,JSON.stringify(entry.source),JSON.stringify(lines),note.trim(),actor);
  })();
}
export async function saveSnapshot(year:number,quarter:number,fingerprint:string,status:'reviewed'|'submitted',receipt:string,actor:string) {
  return db.transaction(async()=>{
    await lockSources();
    const current=await workspace(year,quarter);
    if(current.fingerprint!==fingerprint) throw new Error('The return changed. Reload and review the current figures.');
    if(current.blockers.length) throw new Error('Resolve all review items and pending bank entries first.');
    const previous=await row<Snapshot>('SELECT * FROM vat_snapshots WHERE year=? AND quarter=? ORDER BY id DESC LIMIT 1',year,quarter);
    if(status==='submitted'&&(!previous||previous.status!=='reviewed'||previous.fingerprint!==fingerprint)) throw new Error('Save a reviewed copy of the current return before recording submission.');
    if(status==='submitted'&&(!receipt.trim()||receipt.length>500)) throw new Error('Enter the submission receipt/reference (maximum 500 characters).');
    return (await db.prepare('INSERT INTO vat_snapshots(year,quarter,status,fingerprint,payload,receipt,previous_id,actor) VALUES(?,?,?,?,?,?,?,?)')
      .run(year,quarter,status,fingerprint,JSON.stringify(current),receipt.trim(),previous?.id??null,actor)).lastInsertRowid;
  })();
}
