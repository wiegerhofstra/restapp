import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { applySupplierRule, classifySupplier, ruleAccounts, supplierMatches } from '../../lib/vat/supplier-rules.ts';
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
const roundedRule=clone(standard);roundedRule.config.invoiceRoundingCents=1;
for(const difference of [-1,1]) {
  const c=clone(stdContext);c.postings[1].debit=2141;c.postings[2].debit=450+difference;c.postings[0].credit=2141+c.postings[2].debit;
  assert.match(applySupplierRule(source,c,standard).reason,/Geboekte btw/);
  const accepted=applySupplierRule(source,c,roundedRule);
  assert.equal(accepted.lines[0].tax,450+difference);assert.match(accepted.notice,/Factuurafronding/);
  c.postings[0].credit++;assert.match(applySupplierRule(source,c,roundedRule).reason,/Betalingsbedrag/);
}
for(const difference of [-2,2]) {
  const c=clone(stdContext);c.postings[2].debit+=difference;c.postings[0].credit+=difference;
  assert.equal(applySupplierRule(source,c,roundedRule).lines,undefined);
}
const reverseRounding=clone(context);reverseRounding.postings[2].debit--;reverseRounding.postings[3].credit--;
assert.equal(applySupplierRule(source,reverseRounding,{...rule,config:{...rule.config,invoiceRoundingCents:1}}).lines,undefined);
const zeroTax=clone(stdContext);zeroTax.postings[1].debit=5;zeroTax.postings[2].debit=0;zeroTax.postings[0].credit=5;
assert.equal(applySupplierRule(source,zeroTax,roundedRule).lines,undefined);
const exemptContext={batch:false,postings:context.postings.slice(0,2)};
const exemptRule={...clone(rule),config:{...clone(rule.config),code:'exempt_purchase',rateBps:0,deductibleBps:0,accounts:ruleAccounts(exemptContext.postings,'exempt_purchase')}};
assert.deepEqual(applySupplierRule(source,exemptContext,exemptRule).lines,[]);
for(const mutate of [c=>c.batch=true,c=>c.postings[0].credit++,c=>c.postings[1].accountId=99,c=>c.postings.push(context.postings[2]),c=>c.postings.push({...c.postings[1]}),c=>c.postings.forEach(p=>{[p.debit,p.credit]=[p.credit,p.debit]}),c=>c.postings[1].kind='income',c=>c.postings[0].kind='liability']) {
  const c=clone(exemptContext);mutate(c);assert.equal(applySupplierRule(source,c,exemptRule).lines,undefined);
}
for(const config of [{rateBps:2100},{deductibleBps:10000},{accounts:{...exemptRule.config.accounts,input:5}}]) assert.equal(applySupplierRule(source,exemptContext,{...exemptRule,config:{...exemptRule.config,...config}}).lines,undefined);
assert.equal(applySupplierRule({...source,date:'2026-06-30'},exemptContext,exemptRule).lines,undefined);
assert.equal(applySupplierRule({...source,deleted:true},exemptContext,exemptRule).lines,undefined);
assert.equal(applySupplierRule(source,exemptContext,{...exemptRule,supplier:{...supplier,active:false}}).lines,undefined);
const settlementSource={...source,description:'Belastingdienst TERUGGAAF OB kwartaal 2'};
const settlementContext={batch:false,bankAccountIds:[3],postings:[{accountId:3,name:'Bank',kind:'asset',debit:5800,credit:0},{accountId:7,name:'Te ontvangen btw',kind:'asset',debit:0,credit:5800}]};
const settlementRule={...clone(rule),config:{...clone(rule.config),pattern:'Belastingdienst',code:'vat_settlement',rateBps:0,deductibleBps:0,accounts:ruleAccounts(settlementContext.postings,'vat_settlement',3),settlement:{direction:'refund',balanceKind:'asset'}}};
assert.deepEqual(applySupplierRule(settlementSource,settlementContext,settlementRule).lines,[]);
const paymentContext=clone(settlementContext);paymentContext.postings.forEach(p=>{[p.debit,p.credit]=[p.credit,p.debit]});
assert.equal(applySupplierRule(settlementSource,paymentContext,settlementRule).lines,undefined);
for(const direction of ['payment','both']) assert.deepEqual(applySupplierRule(settlementSource,paymentContext,{...settlementRule,config:{...settlementRule.config,settlement:{direction,balanceKind:'asset'}}}).lines,[]);
const liabilityContext=clone(paymentContext);liabilityContext.postings[1].kind='liability';
assert.deepEqual(applySupplierRule(settlementSource,liabilityContext,{...settlementRule,config:{...settlementRule.config,settlement:{direction:'payment',balanceKind:'liability'}}}).lines,[]);
for(const mutate of [c=>c.batch=true,c=>c.postings[0].debit++,c=>c.postings[1].accountId=99,c=>c.postings[1].kind='expense',c=>c.postings[1].kind='income',c=>c.postings.push(context.postings[2]),c=>c.bankAccountIds.push(7),c=>c.postings[0].debit=0,c=>c.postings[0].credit=-1]) {
  const c=clone(settlementContext);mutate(c);assert.equal(applySupplierRule(settlementSource,c,settlementRule).lines,undefined);
}
assert.equal(applySupplierRule({...settlementSource,description:'Andere belasting'},settlementContext,settlementRule).lines,undefined);
assert.equal(applySupplierRule({...settlementSource,date:'2026-06-30'},settlementContext,settlementRule).lines,undefined);
assert.equal(applySupplierRule({...settlementSource,deleted:true},settlementContext,settlementRule).lines,undefined);
assert.throws(()=>ruleAccounts(settlementContext.postings,'vat_settlement',999),/Kies de bankrekening/);
const creditContext={batch:false,bankAccountIds:[3],postings:[{accountId:3,name:'Bank',kind:'asset',debit:0,credit:17900},{accountId:10,name:'Supplier credit',kind:'asset',debit:17900,credit:0}]};
const creditRule={...clone(rule),config:{...clone(rule.config),code:'supplier_credit',rateBps:0,deductibleBps:0,accounts:ruleAccounts(creditContext.postings,'supplier_credit',3)}};
assert.deepEqual(applySupplierRule(source,creditContext,creditRule).lines,[]);
for(const mutate of [c=>c.batch=true,c=>c.postings[0].credit++,c=>c.postings[1].kind='expense',c=>c.bankAccountIds.push(10),c=>c.postings.push(context.postings[2]),c=>c.postings.forEach(p=>{[p.debit,p.credit]=[p.credit,p.debit]})]) {
  const c=clone(creditContext);mutate(c);assert.equal(applySupplierRule(source,c,creditRule).lines,undefined);
}
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
  const {vatCsv,vatPdf}=await import('../../lib/vat/export.ts');
  const e=await getReviewEntry('transaction',1);
  const input={sampleId:1,sampleHash:e.source.hash,supplierId:null,newSupplier:{name:'Google',country:'IE',tax_number:'',active:true},pattern:'Google Apps',code:'4b',rateBps:2100,deductibleBps:10000,validFrom:'2026-07-01',note:'Invoice inv-1 checked; same supply and invoice date as booking date.'};
  let preview=await previewSupplierRule(input);assert.equal(preview.count,2);
  assert.equal((await row('SELECT count(*) n FROM suppliers')).n,0);
  assert.equal((await getWorkspace(2026,3)).current.blockers.length,2);
  await assert.rejects(saveSupplierRule({...input,rateBps:900},preview.token,'test'),/Geboekte btw/);
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

  // Exempt purchases are completed reviews with no declaration lines, never zero-rate turnover.
  await admin.query("INSERT INTO accounts VALUES(7,'Bankkosten','expense')");
  await admin.query("INSERT INTO transactions VALUES(10,'2026-10-01','Kosten Zakelijk Betalingsverkeer 123','bank-overzicht'),(11,'2026-11-01','Kosten Zakelijk Betalingsverkeer 456','bank-overzicht')");
  await admin.query('INSERT INTO transaction_lines(transaction_id,account_id,debit_cents,credit_cents) VALUES(10,3,0,1095),(10,7,1095,0),(11,3,0,1195),(11,7,1195,0)');
  const bankEntry=await getReviewEntry('transaction',10);
  const bankInput={...input,sampleId:10,sampleHash:bankEntry.source.hash,newSupplier:{name:'ING',country:'NL',tax_number:'',active:true},pattern:'Kosten Zakelijk Betalingsverkeer',code:'exempt_purchase',rateBps:0,deductibleBps:0,validFrom:'2026-10-01',note:'Vrijgesteld betalingsverkeer; bankkostenoverzicht gecontroleerd.'};
  for(const patch of [{rateBps:2100},{deductibleBps:10000}]) await assert.rejects(previewSupplierRule({...bankInput,...patch}),/geen btw en voorbelasting/);
  await assert.rejects(previewSupplierRule({...input,code:'exempt_purchase',rateBps:0,deductibleBps:0}),/grootboekrekeningen/);
  const bankPreview=await previewSupplierRule(bankInput);assert.equal(bankPreview.count,2);assert.match(bankPreview.examples[0].reason,/btw-aangifte/);
  assert.equal((await getReviewEntry('transaction',10)).state,'needs_review');
  const bankSupplier=await saveSupplierRule(bankInput,bankPreview.token,'test');
  const bankWorkspace=(await getWorkspace(2026,4)).current;
  assert.equal(bankWorkspace.blockers.length,0);assert.equal(bankWorkspace.balanceCents,0);
  assert.ok(bankWorkspace.totals.every(t=>(t.base??0)===0&&(t.tax??0)===0));
  assert.ok(bankWorkspace.entries.every(e=>e.state==='rule_applied'&&e.lines.length===0&&e.supplierRule.supplier_id===bankSupplier));
  assert.match(vatCsv(bankWorkspace,'CONCEPT'),/Vrijgestelde inkoop — niet opnemen in de btw-aangifte/);
  assert.doesNotMatch(vatCsv(bankWorkspace,'CONCEPT'),/Btw-behandeling nog te controleren/);
  assert.ok((await vatPdf(bankWorkspace,'CONCEPT')).length>1000);
  const bankSnapshot=await saveSnapshot(2026,4,bankWorkspace.fingerprint,'reviewed','','test');
  const frozenBank=(await row('SELECT payload FROM vat_snapshots WHERE id=?',bankSnapshot)).payload;
  assert.equal(frozenBank.entries[0].supplierRule.config.code,'exempt_purchase');
  await admin.query("INSERT INTO transactions VALUES(12,'2026-12-01','Kosten Zakelijk Betalingsverkeer 789','bank-overzicht')");
  await admin.query('INSERT INTO transaction_lines(transaction_id,account_id,debit_cents,credit_cents) SELECT 12,account_id,debit_cents,credit_cents FROM transaction_lines WHERE transaction_id=10');
  assert.equal((await getReviewEntry('transaction',12)).state,'rule_applied');
  // A VAT line or another expense account must never be silently excluded.
  await admin.query('INSERT INTO transaction_lines(transaction_id,account_id,debit_cents,credit_cents) VALUES(12,5,230,0)');
  await admin.query('UPDATE transaction_lines SET credit_cents=1325 WHERE transaction_id=12 AND account_id=3');
  assert.equal((await getReviewEntry('transaction',12)).state,'needs_review');
  await admin.query('UPDATE transaction_lines SET account_id=4 WHERE transaction_id=11 AND account_id=7');
  assert.equal((await getReviewEntry('transaction',11)).state,'needs_review');
  await saveReview('transaction',10,bankEntry.source.hash,0,[],'Handmatig gecontroleerde bankkosten','test');
  assert.equal((await getReviewEntry('transaction',10)).state,'reviewed');
  const bankRule=(await supplierRules()).find(r=>r.supplier_id===bankSupplier);
  await disableSupplierRule(bankSupplier,bankRule.id,'test');
  assert.equal((await getReviewEntry('transaction',10)).state,'reviewed');
  assert.deepEqual((await row('SELECT payload FROM vat_snapshots WHERE id=?',bankSnapshot)).payload,frozenBank);
  console.log('PASS: exempt purchases, no VAT totals, future payments, VAT/account deviations, manual overrides, exports and frozen exemption evidence');

  await admin.query("INSERT INTO transactions VALUES(20,'2027-01-01','HappyClean schoonmaakmateriaal','factuur-20')");
  await admin.query('INSERT INTO transaction_lines(transaction_id,account_id,debit_cents,credit_cents) VALUES(20,3,0,2590),(20,4,2141,0),(20,5,449,0)');
  const roundingSource=(await getReviewEntry('transaction',20)).source;
  const roundingInput={...input,sampleId:20,sampleHash:roundingSource.hash,newSupplier:{name:'HappyClean',country:'NL',tax_number:'',active:true},pattern:'HappyClean',code:'5b',validFrom:'2027-01-01',note:'Factuur-20 gecontroleerd; factuurafronding per artikel.'};
  await assert.rejects(previewSupplierRule(roundingInput),/€ 4,49.*€ 4,50.*€ 0,01/);
  for(const invoiceRoundingCents of [-1,2,0.5]) await assert.rejects(previewSupplierRule({...roundingInput,invoiceRoundingCents}),/één cent/);
  await assert.rejects(previewSupplierRule({...input,invoiceRoundingCents:1}),/Nederlandse inkoopfacturen/);
  const allowedRounding={...roundingInput,invoiceRoundingCents:1};
  const roundingPreview=await previewSupplierRule(allowedRounding);
  assert.equal(roundingPreview.count,1);assert.match(roundingPreview.examples[0].reason,/€ 4,49 behouden; berekend € 4,50/);
  await saveSupplierRule(allowedRounding,roundingPreview.token,'test');
  const rounded=(await getWorkspace(2027,1)).current;
  assert.equal(rounded.blockers.length,0);assert.equal(rounded.totals.find(t=>t.code==='5b').tax,449);
  assert.equal(rounded.entries[0].lines[0].tax,449);assert.match(rounded.entries[0].roundingNote,/Factuurafronding/);
  assert.match(vatCsv(rounded,'CONCEPT'),/€ 4,49 behouden; berekend € 4,50/);
  assert.ok((await vatPdf(rounded,'CONCEPT')).length>1000);
  const roundingSnapshot=await saveSnapshot(2027,1,rounded.fingerprint,'reviewed','','test');
  const roundingEvidence=(await row('SELECT payload FROM vat_snapshots WHERE id=?',roundingSnapshot)).payload;
  assert.equal(roundingEvidence.entries[0].supplierRule.config.invoiceRoundingCents,1);
  assert.equal(roundingEvidence.entries[0].lines[0].tax,449);
  assert.deepEqual((await getReviewEntry('transaction',20)).source,roundingSource);
  console.log('PASS: explicit invoice rounding, both cent directions, strict legacy/reverse rules, larger/payment differences rejected, booked VAT preserved in totals/exports/snapshots');

  // A receipt is a balance-sheet settlement, not exempt expense or turnover.
  await admin.query("INSERT INTO accounts VALUES(8,'Te ontvangen btw','asset'),(9,'Inkomstenbelasting','asset')");
  await admin.query("INSERT INTO transactions VALUES(30,'2027-04-01','Belastingdienst TERUGGAAF OB kwartaal 1','refund-30'),(31,'2027-05-01','Belastingdienst TERUGGAAF OB correctie','refund-31')");
  await admin.query('INSERT INTO transaction_lines(transaction_id,account_id,debit_cents,credit_cents) VALUES(30,3,5800,0),(30,8,0,5800),(31,3,6000,0),(31,9,0,6000)');
  const settlementSample=(await getReviewEntry('transaction',30)).source;
  const settlementInput={...input,sampleId:30,sampleHash:settlementSample.hash,newSupplier:{name:'Belastingdienst',country:'NL',tax_number:'',active:true},pattern:'TERUGGAAF OB',code:'vat_settlement',rateBps:0,deductibleBps:0,settlementBankAccountId:3,settlementDirection:'refund',validFrom:'2027-04-01',note:'Ontvangen btw-teruggaaf eerdere aangifte; beschikking gecontroleerd.'};
  await assert.rejects(previewSupplierRule({...settlementInput,settlementDirection:'payment'}),/betalingsrichting/);
  await assert.rejects(previewSupplierRule({...settlementInput,settlementDirection:'invalid'}),/betalingsrichting/);
  await assert.rejects(previewSupplierRule({...settlementInput,rateBps:2100}),/geen btw/);
  await assert.rejects(previewSupplierRule({...settlementInput,settlementBankAccountId:999}),/bankrekening/);
  const settlementPreview=await previewSupplierRule(settlementInput);
  assert.equal(settlementPreview.count,1);assert.equal(settlementPreview.total,2);
  const settlementSupplier=await saveSupplierRule(settlementInput,settlementPreview.token,'test');
  assert.equal((await getReviewEntry('transaction',30)).state,'rule_applied');
  assert.deepEqual((await getReviewEntry('transaction',30)).source,settlementSample);
  assert.equal((await getReviewEntry('transaction',31)).state,'needs_review');
  const settlementWorkspace=(await getWorkspace(2027,2)).current;
  assert.equal(settlementWorkspace.balanceCents,0);assert.ok(settlementWorkspace.totals.every(t=>(t.base??0)===0&&(t.tax??0)===0));
  assert.equal(settlementWorkspace.entries.find(e=>e.source.id===30).lines.length,0);
  assert.match(vatCsv(settlementWorkspace,'CONCEPT'),/Btw-betaling of -teruggaaf — buiten de aangifte/);
  assert.ok((await vatPdf(settlementWorkspace,'CONCEPT')).length>1000);
  const otherTax=await getReviewEntry('transaction',31);await saveReview('transaction',31,otherTax.source.hash,0,[],'Andere belasting: afzonderlijk beoordeeld','test');
  const complete=(await getWorkspace(2027,2)).current;
  const settlementSnapshot=await saveSnapshot(2027,2,complete.fingerprint,'reviewed','','test');
  const settlementEvidence=(await row('SELECT payload FROM vat_snapshots WHERE id=?',settlementSnapshot)).payload;
  assert.equal(settlementEvidence.entries[0].supplierRule.config.settlement.direction,'refund');
  await admin.query("INSERT INTO transactions VALUES(32,'2027-06-01','Belastingdienst TERUGGAAF OB kwartaal','refund-32')");
  await admin.query('INSERT INTO transaction_lines(transaction_id,account_id,debit_cents,credit_cents) SELECT 32,account_id,debit_cents,credit_cents FROM transaction_lines WHERE transaction_id=30');
  assert.equal((await getReviewEntry('transaction',32)).state,'rule_applied');
  const settlementActive=(await supplierRules()).find(r=>r.supplier_id===settlementSupplier);
  await disableSupplierRule(settlementSupplier,settlementActive.id,'test');
  assert.equal((await getReviewEntry('transaction',30)).state,'needs_review');
  assert.equal((await getReviewEntry('transaction',31)).state,'reviewed');
  assert.deepEqual((await row('SELECT payload FROM vat_snapshots WHERE id=?',settlementSnapshot)).payload,settlementEvidence);
  console.log('PASS: VAT settlement receipts/payments, direction and account constraints, other taxes blocked, empty declaration totals, exports, future receipts and immutable evidence');

  await admin.query("INSERT INTO accounts VALUES(10,'Openprovider tegoed','asset')");
  await admin.query("INSERT INTO transactions VALUES(40,'2027-07-07','Openprovider opwaarderen',''),(41,'2027-07-31','Openprovider OP1800658','')");
  await admin.query('INSERT INTO transaction_lines(transaction_id,account_id,debit_cents,credit_cents) VALUES(40,3,0,17900),(40,10,17900,0),(41,10,0,5065),(41,4,4186,0),(41,5,879,0)');
  const topupSource=(await getReviewEntry('transaction',40)).source,purchaseSource=(await getReviewEntry('transaction',41)).source;
  const topupInput={...input,ruleKey:'new',ruleName:'Tegoed opwaarderen',sampleId:40,sampleHash:topupSource.hash,newSupplier:{name:'Openprovider',country:'NL',tax_number:'',active:true},pattern:'Openprovider',code:'supplier_credit',rateBps:0,deductibleBps:0,settlementBankAccountId:3,validFrom:'2027-07-01',note:'Alleen aankopen leveren een btw-factuur op; opwaarderen is een balansoverboeking.'};
  const topupPreview=await previewSupplierRule(topupInput);assert.equal(topupPreview.count,1);
  const walletSupplier=await saveSupplierRule(topupInput,topupPreview.token,'test');
  const purchaseInput={...topupInput,supplierId:walletSupplier,ruleName:'Aankopen uit tegoed',sampleId:41,sampleHash:purchaseSource.hash,code:'5b',rateBps:2100,deductibleBps:10000,note:'Inkoopfactuur OP1800658; factuurdatum is boekdatum, btw eenmaal verwerkt.'};
  const purchasePreview=await previewSupplierRule(purchaseInput);assert.equal(purchasePreview.count,1);
  await saveSupplierRule(purchaseInput,purchasePreview.token,'test');
  let walletRules=(await supplierRules()).filter(r=>r.supplier_id===walletSupplier);assert.equal(walletRules.length,2);assert.ok(walletRules.every(r=>r.active));
  assert.equal((await getReviewEntry('transaction',40)).state,'rule_applied');assert.equal((await getReviewEntry('transaction',40)).lines.length,0);
  assert.equal((await getReviewEntry('transaction',41)).state,'rule_applied');assert.equal((await getReviewEntry('transaction',41)).lines[0].tax,879);
  assert.deepEqual((await getReviewEntry('transaction',40)).source,topupSource);assert.deepEqual((await getReviewEntry('transaction',41)).source,purchaseSource);
  const walletWorkspace=(await getWorkspace(2027,3)).current;
  assert.equal(walletWorkspace.blockers.length,0);assert.equal(walletWorkspace.totals.find(t=>t.code==='5b').tax,879);
  assert.match(vatCsv(walletWorkspace,'CONCEPT'),/Leverancierstegoed opwaarderen/);
  const walletSnapshot=await saveSnapshot(2027,3,walletWorkspace.fingerprint,'reviewed','','test');
  const walletEvidence=(await row('SELECT payload FROM vat_snapshots WHERE id=?',walletSnapshot)).payload;
  // Identical usable rules cannot double-count the purchase or silently win.
  const duplicate=await previewSupplierRule(purchaseInput);assert.match(duplicate.blockedReason,/Meerdere leveranciersregels/);
  await assert.rejects(saveSupplierRule(purchaseInput,duplicate.token,'test'),/Meerdere leveranciersregels/);
  // Pausing one rule preserves the other rule and all immutable evidence.
  const topupRule=walletRules.find(r=>r.config.code==='supplier_credit'),purchaseRule=walletRules.find(r=>r.config.code==='5b');
  await disableSupplierRule(walletSupplier,topupRule.id,'test');
  assert.equal((await getReviewEntry('transaction',40)).state,'needs_review');assert.equal((await getReviewEntry('transaction',41)).state,'rule_applied');
  const resumed={...topupInput,supplierId:walletSupplier,ruleKey:topupRule.rule_key};
  const resumedPreview=await previewSupplierRule(resumed);await saveSupplierRule(resumed,resumedPreview.token,'test');
  walletRules=(await supplierRules()).filter(r=>r.supplier_id===walletSupplier);assert.equal(walletRules.length,2);
  assert.equal(walletRules.find(r=>r.config.code==='5b').id,purchaseRule.id);
  await assert.rejects(disableSupplierRule(walletSupplier,topupRule.id,'test'),/gewijzigd/);
  await admin.query("INSERT INTO transactions VALUES(42,'2027-08-07','Openprovider opwaarderen',''),(43,'2027-08-31','Openprovider volgende factuur','')");
  await admin.query('INSERT INTO transaction_lines(transaction_id,account_id,debit_cents,credit_cents) SELECT 42,account_id,debit_cents,credit_cents FROM transaction_lines WHERE transaction_id=40');
  await admin.query('INSERT INTO transaction_lines(transaction_id,account_id,debit_cents,credit_cents) SELECT 43,account_id,debit_cents,credit_cents FROM transaction_lines WHERE transaction_id=41');
  assert.equal((await getReviewEntry('transaction',42)).state,'rule_applied');assert.equal((await getReviewEntry('transaction',43)).state,'rule_applied');
  assert.deepEqual((await row('SELECT payload FROM vat_snapshots WHERE id=?',walletSnapshot)).payload,walletEvidence);
  await migrateVat(admin);assert.equal((await supplierRules()).filter(r=>r.supplier_id===walletSupplier).length,2);
  console.log('PASS: multiple rules per supplier, credit funding vs purchases, no duplicate VAT, overlap rejection, independent pause/edit, future transactions and repeatable migration');
} finally {if(pool)await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
