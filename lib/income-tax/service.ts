import { createHash } from 'node:crypto';
import { db, row, rows } from '../db.ts';
import { calculateYear, checks, defaultConfig, validYear, validateConfig } from './calculation.ts';
import type { Account, Config, LedgerLine, Mapping } from './calculation.ts';

type Invoice = { id:number; number:number; date:string; status:string; paidDate:string|null; net:number; tax:number; description:string };
type Pending = { id:number; date:string; description:string; amount:number };
type ConfigVersion = { id:number; payload:Config };
export type Snapshot = { id:number; year:number; status:'draft'|'reviewed'; fingerprint:string; payload:Workspace; created_at:string; actor:string };
export type Workspace = ReturnType<typeof calculateYear> & {
  config:Config; configId:number; sourceHash:string; fingerprint:string;
  invoices:Invoice[]; pending:Pending[]; empty:{id:number}[]; sourceLines:LedgerLine[]; issues:string[];
};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function loadYear(year:number):Promise<Workspace> {
  validYear(year);
  const start=`${year}-01-01`,end=`${year}-12-31`;
  const accounts=await rows<Account>('SELECT id,name,kind FROM accounts ORDER BY id');
  const lines=await rows<LedgerLine>(`SELECT l.id,l.transaction_id "transactionId",t.transaction_date date,t.description,l.account_id "accountId",l.debit_cents debit,l.credit_cents credit
    FROM transaction_lines l JOIN transactions t ON t.id=l.transaction_id WHERE t.transaction_date<=? ORDER BY t.transaction_date,t.id,l.id`,end);
  const empty=await rows<{id:number}>(`SELECT t.id FROM transactions t WHERE t.transaction_date<=? AND NOT EXISTS(SELECT 1 FROM transaction_lines l WHERE l.transaction_id=t.id) ORDER BY t.id`,end);
  // Invoices are evidence, never a second revenue stream: payments may already have been posted to revenue.
  const invoices=await rows<Invoice>(`SELECT i.id,i.invoice_number number,i.issue_date date,i.status,i.paid_date "paidDate",i.concern description,
    a.net_cents net, a.tax_cents tax
    FROM invoices i JOIN invoice_amounts a ON a.invoice_id=i.id
    WHERE i.issue_date<=? AND (i.issue_date>=? OR (i.status NOT IN ('draft','cancelled') AND (i.paid_date IS NULL OR i.paid_date='' OR i.paid_date>?)))
    ORDER BY i.issue_date,i.id`,end,start,start);
  const pending=await rows<Pending>(`SELECT id,booking_date date,description,amount_cents amount FROM bank_entries WHERE booking_date BETWEEN ? AND ? AND transaction_id IS NULL ORDER BY booking_date,id`,start,end);
  const version=await row<ConfigVersion>('SELECT id,payload FROM income_tax_configs WHERE year=? ORDER BY id DESC LIMIT 1',year);
  const config=version?.payload??defaultConfig();
  const defaults=await rows<Mapping>('SELECT DISTINCT ON (account_id) account_id "accountId",category,partner_key "partnerKey" FROM income_tax_account_defaults ORDER BY account_id,id DESC');
  config.mappings=[...defaults.filter(d=>!config.mappings.some(m=>m.accountId===d.accountId)),...config.mappings];
  const result=calculateYear(year,accounts,lines,config);
  const sourceHash=digest({accounts,lines,empty,invoices,pending,defaults});
  const issues=[...result.issues];
  if(!config.allocationReviewed) issues.push('De winstverdeling is voorlopig: beoordeel de afspraak en leg de onderbouwing vast.');
  if(config.partners.some(p=>['U','Uw vennoot'].includes(p.name))) issues.push('Vul de namen van beide vennoten in.');
  if(!config.mappingsReviewed) issues.push('Bevestig de indeling van de grootboekrekeningen.');
  for(const [key,label] of Object.entries(checks)) if(!config.checks[key as keyof typeof checks]) issues.push(label);
  if(config.reviewedSourceHash!==sourceHash) issues.push('Controleer de actuele brongegevens en sla de jaarinstellingen op; eerdere controles gelden niet voor gewijzigde gegevens.');
  if(empty.length) issues.push(`${empty.length} boeking(en) hebben geen grootboekregels.`);
  if(pending.length) issues.push(`${pending.length} bankmutatie(s) in dit jaar zijn nog niet verwerkt.`);
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam'}).format(new Date());
  if(today<=end) issues.push('Het boekjaar is nog niet afgelopen. Dit overzicht is een tussentijds concept.');
  const body={...result,config,configId:version?.id??0,sourceHash,invoices,pending,empty,sourceLines:lines,issues};
  return {...body,fingerprint:digest({version:1,...body})};
}
export async function getIncomeTaxWorkspace(year:number) {
  return db.transaction(async()=>{
    await db.prepare('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ').run();
    const current=await loadYear(year);
    const snapshots=await rows<Snapshot>('SELECT * FROM income_tax_snapshots WHERE year=? ORDER BY id DESC',year);
    return {current,snapshots};
  })();
}
async function lockSources() {
  await db.prepare('SELECT pg_advisory_xact_lock(713056)').get();
  await db.prepare('LOCK TABLE accounts,transactions,transaction_lines,invoices,invoice_lines,bank_entries IN SHARE MODE').run();
}
export async function saveIncomeTaxConfig(year:number,expectedId:number,sourceHash:string,input:Config,actor:string) {
  validYear(year);const config=validateConfig(input);
  return db.transaction(async()=>{
    await lockSources();const current=await loadYear(year);
    if(current.configId!==expectedId || current.sourceHash!==sourceHash) throw new Error('De jaargegevens zijn gewijzigd. Vernieuw de pagina en controleer de actuele gegevens.');
    const accounts=new Set(current.accountRows.map(a=>a.id));
    if(config.mappings.some(m=>!accounts.has(m.accountId))) throw new Error('Een grootboekrekening bestaat niet meer.');
    config.reviewedSourceHash=current.sourceHash;
    return (await db.prepare('INSERT INTO income_tax_configs(year,payload,actor) VALUES(?,?,?)').run(year,JSON.stringify(config),actor)).lastInsertRowid;
  })();
}
export async function saveIncomeTaxSnapshot(year:number,fingerprint:string,status:'draft'|'reviewed',actor:string) {
  validYear(year);if(!['draft','reviewed'].includes(status)) throw new Error('Ongeldige status.');
  return db.transaction(async()=>{
    await lockSources();const current=await loadYear(year);
    if(current.fingerprint!==fingerprint) throw new Error('De jaargegevens zijn gewijzigd. Vernieuw de pagina voordat u een versie bewaart.');
    if(status==='reviewed'&&current.issues.length) throw new Error('Werk eerst de openstaande controles af. U kunt wel een conceptversie bewaren.');
    return (await db.prepare('INSERT INTO income_tax_snapshots(year,status,fingerprint,payload,actor) VALUES(?,?,?,?,?)')
      .run(year,status,fingerprint,JSON.stringify(current),actor)).lastInsertRowid;
  })();
}
