import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { PDFDocument } from 'pdf-lib';
import { calculateVat, period, validateLines, validDate, roundingDescription } from '../../lib/vat/calculation.ts';
import { vatCsv, vatPdf, csvCell } from '../../lib/vat/export.ts';
import { migrateVat } from '../lib/migrate-vat.mjs';

const line=(code,base,tax,deductibleBps=0,date='2026-07-08')=>({code,base,tax,deductibleBps,date});
const q3=calculateVat([line('4b',20420,4290,10000),line('5b',40204,8443,10000)]);
assert.equal(q3.balanceCents,-8443);assert.equal(q3.balanceEuros,-86);
assert.equal(q3.totals.find(r=>r.code==='4b').taxEuros,42);
assert.equal(q3.totals.find(r=>r.code==='5a').taxEuros,42);
assert.equal(q3.totals.find(r=>r.code==='5b').taxEuros,128);
assert.equal(q3.totals.find(r=>r.code==='5b').tax,12733);
assert.equal(calculateVat([line('4b',10000,2100,5000)]).balanceCents,1050);
assert.equal(calculateVat([line('4b',-10000,-2100,5000)]).balanceCents,-1050);
assert.equal(calculateVat([line('1a',10000,2150)]).balanceEuros,21);
assert.equal(calculateVat([line('1a',-10000,-2150)]).balanceEuros,-22);
assert.equal(calculateVat([line('1a',10000,2149),line('1b',10000,949)]).balanceEuros,30);
assert.equal(calculateVat([line('3b',25000,0)]).totals.find(r=>r.code==='3b').baseEuros,250);
assert.equal(calculateVat(Array.from({length:150},()=>line('1a',100,21))).balanceCents,3150);
// Whole-euro rounding happens once per aggregated field, not per source line.
assert.equal(calculateVat([line('1a',500,99),line('1a',500,99)]).balanceEuros,1);
assert.equal(calculateVat([line('5b',500,1,10000),line('5b',500,1,10000)]).balanceEuros,-1);
assert.equal(calculateVat([line('1a',1000,199),line('1a',-1000,-199)]).balanceEuros,0);
assert.equal(calculateVat([line('1a',1000,199),line('1b',1000,199)]).balanceEuros,2);
for(const cents of [-4299,-4250,-4201,-4200,-99,-50,-1,0,1,50,99,4200,4201,4250,4299]) {
  const output=calculateVat([line('1a',cents*5,cents)]);
  const input=calculateVat([line('5b',cents*5,cents,10000)]);
  const out=output.totals.find(r=>r.code==='1a').taxEuros;
  const deduction=input.totals.find(r=>r.code==='5b').taxEuros;
  assert.ok(out*100<=cents&&cents<(out+1)*100);
  assert.ok((deduction-1)*100<cents&&cents<=deduction*100);
  assert.equal(Object.is(deduction,-0),false);
  assert.equal(output.balanceCents,cents);assert.equal(input.balanceCents,-cents||0);
}
assert.equal(calculateVat([line('4b',1990,418,10000)]).balanceEuros,-1);
assert.equal(calculateVat([line('4b',-1990,-418,10000)]).balanceEuros,-1);
assert.equal(calculateVat([line('4b',1990,418,5000)]).balanceEuros,1);
assert.equal(calculateVat([line('4b',-1990,-418,5000)]).balanceEuros,-3);
assert.equal(calculateVat([line('3b',25099,0)]).totals.find(r=>r.code==='3b').baseEuros,250);
assert.equal(calculateVat([line('3b',-25099,0)]).totals.find(r=>r.code==='3b').baseEuros,-251);
assert.match(roundingDescription(q3.rounding),/uw voordeel/);
assert.match(roundingDescription(),/dichtstbijzijnde/);
for(const invalid of [line('5a',1,1),line('4b',1,-1),line('3b',100,1),line('1a',100,21,10000),line('5b',100,21,10001),line('5b',100.1,21,10000)]) assert.throws(()=>validateLines([invalid]));
assert.equal(validDate('2026-02-30'),false);assert.equal(validDate('2024-02-29'),true);
assert.equal(validDate('2026-99-99'),false);
assert.equal(period(2026,1).end,'2026-03-31');assert.throws(()=>period(2026,5));
assert.equal(csvCell('=HYPERLINK("evil")'),'"\'=HYPERLINK(""evil"")"');assert.equal(csvCell(-84),'"-84"');
assert.equal(csvCell(127.33),'"127,33"');
assert.equal(csvCell(-84.43),'"-84,43"');
console.log('PASS: VAT rubrics, reverse charge, partial deductions, credit notes, signed rounding, quarter dates and CSV escaping');

const schema='vat_test_'+randomBytes(8).toString('hex');
const admin=new pg.Client({connectionString:process.env.DATABASE_URL});await admin.connect();let pool;
try {
  await admin.query(`CREATE SCHEMA ${schema}`);await admin.query(`SET search_path TO ${schema}`);
  await admin.query(`
    CREATE TABLE accounts(id bigint PRIMARY KEY,name text,kind text);
    CREATE TABLE transactions(id bigint PRIMARY KEY,transaction_date text,description text,reference text DEFAULT '');
    CREATE TABLE transaction_lines(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,transaction_id bigint,account_id bigint,memo text DEFAULT '',debit_cents bigint DEFAULT 0,credit_cents bigint DEFAULT 0);
    CREATE TABLE invoices(id bigint PRIMARY KEY,issue_date text,concern text,invoice_number bigint,status text);
    CREATE TABLE invoice_lines(id bigint PRIMARY KEY,invoice_id bigint,description text,quantity_milli bigint,unit_price_cents bigint,tax_rate_basis_points bigint);
    CREATE TABLE bank_entries(id bigint PRIMARY KEY,transaction_id bigint,booking_date text,description text);
    INSERT INTO accounts VALUES(3,'Bank','asset'),(36,'Netcup','expense'),(30,'BTW advanced 21% verlegd','asset'),(31,'BTW 21% verlegd','liability');
    INSERT INTO transactions VALUES(1,'2026-07-08','Netcup','nc-123');
    INSERT INTO transaction_lines(transaction_id,account_id,debit_cents,credit_cents) VALUES(1,3,0,1990),(1,36,1990,0),(1,30,418,0),(1,31,0,418);
  `);
  await migrateVat(admin);await migrateVat(admin);
  const url=new URL(process.env.DATABASE_URL);url.searchParams.set('options',`-c search_path=${schema}`);process.env.DATABASE_URL=url.toString();
  const {getPool,db,row}=await import('../../lib/db.ts');pool=getPool();
  const {getWorkspace,getReviewEntry,saveReview,saveSnapshot,hash}=await import('../../lib/vat/service.ts');
  let {current}=await getWorkspace(2026,3);assert.equal(current.blockers.length,1);
  await assert.rejects(saveSnapshot(2026,3,current.fingerprint,'reviewed','','test'),/Werk eerst/);
  let e=await getReviewEntry('transaction',1);assert.deepEqual(e.lines,[line('4b',1990,418,10000)]);
  await assert.rejects(saveReview('transaction',1,'stale',0,e.lines,'invoice','test'),/gewijzigd/);
  await assert.rejects(saveReview('transaction',1,e.source.hash,0,e.lines,'','test'),/kenmerk/);
  const attempts=await Promise.allSettled([1,2].map(()=>saveReview('transaction',1,e.source.hash,0,e.lines,'Invoice nc-123, checked EU supply date','test')));
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
  ({current}=await getWorkspace(2026,3));assert.equal(current.blockers.length,0);
  await assert.rejects(saveSnapshot(2026,3,current.fingerprint,'submitted','receipt','test'),/gecontroleerde versie/);
  // A pre-change reviewed copy must keep its figures and require a fresh review.
  const legacy=JSON.parse(JSON.stringify(current));delete legacy.rounding;
  const nearest=n=>Math.sign(n)*Math.round(Math.abs(n)/100);
  for(const r of legacy.totals){r.baseEuros=r.base===null?null:nearest(r.base);r.taxEuros=r.tax===null?null:nearest(r.tax);}
  legacy.totals.find(r=>r.code==='5a').taxEuros=legacy.totals.filter(r=>!['5a','5b'].includes(r.code)).reduce((n,r)=>n+(r.taxEuros??0),0);
  legacy.balanceEuros=legacy.totals.find(r=>r.code==='5a').taxEuros-legacy.totals.find(r=>r.code==='5b').taxEuros;
  const {year,quarter,start,end,entries,pending,totals,balanceCents,balanceEuros}=legacy;
  legacy.fingerprint=hash({version:1,p:{year,quarter,start,end},entries,pending,result:{totals,balanceCents,balanceEuros}});
  const oldId=(await db.prepare("INSERT INTO vat_snapshots(year,quarter,status,fingerprint,payload,actor) VALUES(2026,3,'reviewed',?,?,'test')").run(legacy.fingerprint,JSON.stringify(legacy))).lastInsertRowid;
  assert.notEqual(current.fingerprint,legacy.fingerprint);
  await assert.rejects(saveSnapshot(2026,3,current.fingerprint,'submitted','receipt','test'),/gecontroleerde versie/);
  assert.match(vatCsv(legacy,'REVIEWED'),/dichtstbijzijnde hele euro/);
  assert.equal(legacy.balanceEuros,0);assert.equal(current.balanceEuros,-1);
  const reviewedId=await saveSnapshot(2026,3,current.fingerprint,'reviewed','','test');
  await assert.rejects(saveSnapshot(2026,3,current.fingerprint,'submitted','','test'),/ontvangstbevestiging/);
  const submittedId=await saveSnapshot(2026,3,current.fingerprint,'submitted','receipt-123','test');
  const frozen=(await row('SELECT payload FROM vat_snapshots WHERE id=?',submittedId)).payload;
  assert.deepEqual(frozen.entries[0].lines,e.lines);
  assert.equal(frozen.rounding,'favourable-v1');
  assert.deepEqual((await row('SELECT payload FROM vat_snapshots WHERE id=?',oldId)).payload,legacy);
  assert.match(vatCsv(frozen,'SUBMITTED'),/Afronding in uw voordeel/);
  assert.equal((await row('SELECT previous_id FROM vat_snapshots WHERE id=?',submittedId)).previous_id,reviewedId);
  await assert.rejects(db.prepare("UPDATE vat_reviews SET note='tampered'").run(),/append-only/);
  await assert.rejects(db.prepare('DELETE FROM vat_snapshots').run(),/append-only/);
  const originalFingerprint=current.fingerprint;
  await db.prepare("UPDATE transactions SET description='Changed description' WHERE id=1").run();
  ({current}=await getWorkspace(2026,3));assert.notEqual(current.fingerprint,originalFingerprint);assert.equal(current.entries[0].state,'changed');
  assert.deepEqual((await row('SELECT payload FROM vat_snapshots WHERE id=?',submittedId)).payload,frozen);
  await assert.rejects(saveSnapshot(2026,3,originalFingerprint,'reviewed','','test'),/gewijzigd/);
  e=await getReviewEntry('transaction',1);
  await saveReview('transaction',1,e.source.hash,e.review.id,[line('4b',1990,418,10000,'2026-06-30')],'Supply date June 30','test');
  assert.equal((await getWorkspace(2026,3)).current.balanceCents,0);
  assert.equal((await getWorkspace(2026,2)).current.totals.find(r=>r.code==='4b').tax,418);
  await db.prepare("INSERT INTO bank_entries VALUES(1,NULL,'2026-07-10','pending')").all();
  assert.equal((await getWorkspace(2026,3)).current.blockers.length,1);
  await db.prepare('DELETE FROM bank_entries').run();
  await db.prepare("INSERT INTO invoices VALUES(1,'2026-07-11','Unpaid sale',1001,'sent')").all();
  await db.prepare("INSERT INTO invoice_lines VALUES(1,1,'Service',1000,10000,2100)").all();
  ({current}=await getWorkspace(2026,3));assert.equal(current.entries.find(e=>e.source.kind==='invoice').lines[0].tax,2100);
  assert.equal(current.blockers.length,1);
  await db.prepare("UPDATE transactions SET transaction_date='2026-10-01' WHERE id=1").run();
  assert.equal((await getWorkspace(2026,2)).current.entries[0].state,'changed');
  await db.prepare('DELETE FROM transactions WHERE id=1').run();
  assert.equal((await getWorkspace(2026,2)).current.entries[0].state,'deleted');
  e=await getReviewEntry('transaction',1);
  await assert.rejects(saveReview('transaction',1,e.source.hash,e.review.id,e.lines,'deleted','test'),/verwijderen/);
  await saveReview('transaction',1,e.source.hash,e.review.id,[],'Original duplicate source was deleted','test');
  assert.equal((await getReviewEntry('transaction',1)).state,'reviewed');
  assert.equal((await getWorkspace(2026,2)).current.entries.length,0);
  const csv=vatCsv(frozen,'SUBMITTED');assert.match(csv,/4,18/);assert.match(csv,/"Rubriek";"Omschrijving"/);assert.ok(csv.startsWith('\uFEFF'));assert.match(csv,/"Boeking"/);assert.match(csv,/Invoice nc-123/);
  const pdf=await PDFDocument.load(await vatPdf(frozen,'SUBMITTED'));
  assert.ok(pdf.getPageCount()>0);assert.match(pdf.getTitle(),/2026 kwartaal 3/);
  console.log('PASS: repeatable migration, review gating, concurrent/stale reviews, immutable submission evidence, quarter moves, unpaid invoices, pending bank entries, deleted sources, CSV and real PDF output');
} finally {if(pool)await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}

if(process.env.STAPP_TEST_BASE_URL) {
  for(const format of ['pdf','csv']){
    const response=await fetch(`${process.env.STAPP_TEST_BASE_URL}/reports/vat/2026/3/export?format=${format}`,{redirect:'manual'});
    assert.equal(response.status,401);
  }
  console.log('PASS: anonymous exports denied');
}
