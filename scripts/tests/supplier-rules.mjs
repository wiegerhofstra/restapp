import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { applySupplierRule, classifySupplier, supplierMatches } from '../../lib/vat/supplier-rules.ts';
import { migrateVat } from '../lib/migrate-vat.mjs';
const supplier={id:1,name:'Google',country:'IE',tax_number:'',active:true,version:1};
const source={id:1,kind:'transaction',date:'2026-07-07',description:'Google Apps example.nl',reference:'',lines:[],hash:'sample',balance:0};
const context={batch:false,postings:[
  {accountId:3,name:'Bank',kind:'asset',debit:0,credit:1360},
  {accountId:4,name:'Google',kind:'expense',debit:1360,credit:0},
  {accountId:5,name:'Voorbelasting',kind:'asset',debit:286,credit:0},
  {accountId:6,name:'Verschuldigde btw',kind:'liability',debit:0,credit:286},
]};
const rule={id:1,supplier_id:1,supplier,active:true,actor:'test',created_at:'',config:{pattern:'Google Apps',code:'4b',rateBps:2100,deductibleBps:10000,validFrom:'2026-07-01',datePolicy:'booking_date',supplierVersion:1,accounts:{base:4,input:5,output:6,payment:3},sampleId:1,sampleHash:'sample',note:'Invoice checked'}};
const clone=v=>structuredClone(v);
assert.equal(supplierMatches('Google Apps','GOOGLE   APPS example.nl'),true);
assert.equal(supplierMatches('Google Apps','NotGoogle Apps example.nl'),false);
assert.equal(supplierMatches('Google (Apps)','Google (Apps) example.nl'),true);
assert.equal(supplierMatches('Google.*','Google Apps example.nl'),false);
assert.equal(applySupplierRule(source,context,rule).lines[0].tax,286);
const partial=clone(rule);partial.config.deductibleBps=5000;assert.equal(applySupplierRule(source,context,partial).lines[0].deductibleBps,5000);
for(const mutate of [c=>c.batch=true,c=>c.postings[0].credit++,c=>c.postings[1].accountId=99,c=>c.postings[2].debit++,c=>c.postings.push({...c.postings[1]}),c=>c.postings.forEach(p=>{[p.debit,p.credit]=[p.credit,p.debit]}),c=>c.postings[1].kind='income']) {
  const c=clone(context);mutate(c);assert.equal(applySupplierRule(source,c,rule).lines,undefined);
}
assert.equal(applySupplierRule({...source,date:'2026-06-30'},context,rule).lines,undefined);
assert.equal(applySupplierRule({...source,balance:1},context,rule).lines,undefined);
assert.equal(applySupplierRule(source,context,{...rule,supplier:{...supplier,version:2}}).lines,undefined);
assert.match(classifySupplier(source,context,[rule,{...rule,id:2}]).reason,/Meerdere/);
assert.deepEqual(classifySupplier(source,context,[{...rule,active:false}]),{});
const standard=clone(rule),stdContext=clone(context);standard.config.code='5b';standard.config.accounts.output=null;stdContext.postings.pop();stdContext.postings[0].credit=1646;
assert.equal(applySupplierRule(source,stdContext,standard).lines[0].tax,286);
console.log('PASS: exact supplier text, literal patterns, account roles, rates, partial deduction, refunds, batches, ambiguity and date boundaries');

const schema='supplier_test_'+randomBytes(8).toString('hex');
const admin=new pg.Client({connectionString:process.env.DATABASE_URL});await admin.connect();let pool;
try {
  await admin.query(`CREATE SCHEMA ${schema}`);await admin.query(`SET search_path TO ${schema}`);
  await admin.query(`
    CREATE TABLE accounts(id bigint PRIMARY KEY,name text,kind text);
    CREATE TABLE transactions(id bigint PRIMARY KEY,transaction_date text,description text,reference text DEFAULT '');
    CREATE TABLE transaction_lines(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,transaction_id bigint,account_id bigint,memo text DEFAULT '',debit_cents bigint DEFAULT 0,credit_cents bigint DEFAULT 0);
    CREATE TABLE invoices(id bigint PRIMARY KEY,issue_date text,concern text,invoice_number bigint,status text);
    CREATE TABLE invoice_lines(id bigint PRIMARY KEY,invoice_id bigint,description text,quantity_milli bigint,unit_price_cents bigint,tax_rate_basis_points bigint);
    CREATE TABLE bank_entries(id bigint PRIMARY KEY,transaction_id bigint,booking_date text,description text,counterparty text DEFAULT '',counterparty_iban text DEFAULT '',warning text DEFAULT '',details jsonb DEFAULT '[]');
    INSERT INTO accounts VALUES(3,'Bank','asset'),(4,'Google','expense'),(5,'BTW advanced 21% verlegd','asset'),(6,'BTW 21% verlegd','liability');
    INSERT INTO transactions VALUES(1,'2026-07-07','Google Apps example.nl','inv-1'),(2,'2026-08-07','Google Apps example.nl','inv-2');
    INSERT INTO transaction_lines(transaction_id,account_id,debit_cents,credit_cents) VALUES(1,3,0,1360),(1,4,1360,0),(1,5,286,0),(1,6,0,286),(2,3,0,1360),(2,4,1360,0),(2,5,286,0),(2,6,0,286);
  `);
  await migrateVat(admin);await migrateVat(admin);
  const url=new URL(process.env.DATABASE_URL);url.searchParams.set('options',`-c search_path=${schema}`);process.env.DATABASE_URL=url.toString();
  const {getPool,db,row}=await import('../../lib/db.ts');pool=getPool();
  const {getReviewEntry,getWorkspace,saveReview,saveSnapshot,supplierRules}=await import('../../lib/vat/service.ts');
  const {previewSupplierRule,saveSupplierRule,disableSupplierRule,saveSupplier}=await import('../../lib/suppliers/service.ts');
  const {vatCsv}=await import('../../lib/vat/export.ts');
  const e=await getReviewEntry('transaction',1);
  const input={sampleId:1,sampleHash:e.source.hash,supplierId:null,newSupplier:{name:'Google',country:'IE',tax_number:'',active:true},pattern:'Google Apps',code:'4b',rateBps:2100,deductibleBps:10000,validFrom:'2026-07-01',note:'Invoice inv-1 checked; same supply and invoice date as booking date.'};
  let preview=await previewSupplierRule(input);assert.equal(preview.count,2);
  assert.equal((await row('SELECT count(*) n FROM suppliers')).n,0);
  assert.equal((await getWorkspace(2026,3)).current.blockers.length,2);
  await assert.rejects(saveSupplierRule({...input,rateBps:900},preview.token,'test'),/afwijkt|wijkt af/);
  const attempts=await Promise.allSettled([1,2].map(()=>saveSupplierRule(input,preview.token,'test')));
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
  const supplierId=attempts.find(r=>r.status==='fulfilled').value;
  assert.equal((await row('SELECT count(*) n FROM suppliers')).n,1);
  let {current}=await getWorkspace(2026,3);assert.equal(current.blockers.length,0);assert.ok(current.entries.every(e=>e.state==='rule_applied'));
  assert.equal((await row('SELECT count(*) n FROM vat_reviews')).n,0);
  assert.match(vatCsv(current,'CONCEPT'),/Volgens leveranciersregel/);
  const savedId=await saveSnapshot(2026,3,current.fingerprint,'reviewed','','test');
  const frozen=(await row('SELECT payload FROM vat_snapshots WHERE id=?',savedId)).payload;
  assert.equal(frozen.entries[0].supplierRule.supplier.name,'Google');
  assert.deepEqual(frozen.entries[0].supplierRule.config.sampleSource,e.source);
  // New matching bookings are automatic without writing a fictitious human review.
  await admin.query("INSERT INTO transactions VALUES(3,'2026-09-07','Google Apps example.nl','inv-3')");
  await admin.query('INSERT INTO transaction_lines(transaction_id,account_id,debit_cents,credit_cents) SELECT 3,account_id,debit_cents,credit_cents FROM transaction_lines WHERE transaction_id=1');
  assert.equal((await getReviewEntry('transaction',3)).state,'rule_applied');
  await assert.rejects(saveSnapshot(2026,3,current.fingerprint,'submitted','receipt','test'),/gewijzigd/);
  await admin.query("INSERT INTO bank_entries(id,transaction_id,booking_date,description,warning) VALUES(1,3,'2026-09-07','Batch','Missing details')");
  assert.equal((await getReviewEntry('transaction',3)).state,'needs_review');
  await admin.query('DELETE FROM bank_entries');
  // Explicit decisions, even exclusion, take precedence. Later changes remain blocked.
  let manual=await getReviewEntry('transaction',2);
  await saveReview('transaction',2,manual.source.hash,0,[],'Invoice already recorded elsewhere','test');
  assert.equal((await getReviewEntry('transaction',2)).state,'reviewed');
  await admin.query("UPDATE transactions SET reference='changed' WHERE id=2");
  assert.equal((await getReviewEntry('transaction',2)).state,'changed');
  const active=(await supplierRules())[0];
  await assert.rejects(db.prepare("UPDATE vat_supplier_rules SET active=false").run(),/append-only/);
  await disableSupplierRule(supplierId,active.id,'test');
  assert.equal((await getReviewEntry('transaction',1)).state,'needs_review');
  assert.deepEqual((await row('SELECT payload FROM vat_snapshots WHERE id=?',savedId)).payload,frozen);
  preview=await previewSupplierRule({...input,supplierId});
  assert.equal(preview.count,2); // Manual review on #2 is preserved.
  await admin.query("UPDATE transactions SET reference='new reference' WHERE id=3");
  await assert.rejects(saveSupplierRule({...input,supplierId},preview.token,'test'),/gewijzigd/);
  preview=await previewSupplierRule({...input,supplierId});
  await saveSupplierRule({...input,supplierId},preview.token,'test');
  assert.equal((await getReviewEntry('transaction',1)).state,'rule_applied');
  await saveSupplier(supplierId,1,{name:'Google',country:'IE',tax_number:'',active:true});
  assert.equal((await getReviewEntry('transaction',1)).state,'rule_applied');
  await saveSupplier(supplierId,1,{name:'Google Ireland',country:'IE',tax_number:'',active:true});
  assert.equal((await getReviewEntry('transaction',1)).state,'needs_review');
  assert.match((await getReviewEntry('transaction',1)).hint,/Leveranciersgegevens/);
  assert.deepEqual((await row('SELECT payload FROM vat_snapshots WHERE id=?',savedId)).payload,frozen);
  console.log('PASS: preview without writes, atomic activation, stale/concurrent previews, future imports, manual override, changed sources, pause, supplier changes and immutable rule/snapshot evidence');
} finally {if(pool)await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
