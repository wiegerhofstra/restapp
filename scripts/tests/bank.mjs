import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';
import { migrateBank } from '../lib/migrate-bank.mjs';
import { parseCamt, cents } from '../../lib/bank/camt.ts';
import { matchEntries } from '../../lib/bank/matching.ts';

const iban = 'NL91ABNA0417164300'; // Public example IBAN; no personal statement is checked in.
const detail = (amount, reference = 'INV000123', direction = 'DBIT') => `<TxDtls><Refs><EndToEndId>${reference}</EndToEndId></Refs><AmtDtls><TxAmt><Amt Ccy="EUR">${amount}</Amt></TxAmt></AmtDtls><RltdPties><${direction === 'DBIT' ? 'Cdtr' : 'Dbtr'}><Nm>Example Hosting</Nm></${direction === 'DBIT' ? 'Cdtr' : 'Dbtr'}></RltdPties><RmtInf><Ustrd>Invoice ${reference}</Ustrd></RmtInf></TxDtls>`;
const entry = (ref, amount = '12.10', direction = 'DBIT', details = detail(amount, 'INV000123', direction)) => `<Ntry><NtryRef>${ref}</NtryRef><Amt Ccy="EUR">${amount}</Amt><CdtDbtInd>${direction}</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-10</Dt></BookgDt><ValDt><Dt>2026-10-10</Dt></ValDt><NtryDtls>${details}</NtryDtls></Ntry>`;
const balance = (code, value) => `<Bal><Tp><CdOrPrtry><Cd>${code}</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">${value}</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-10</Dt></Dt></Bal>`;
const statement = (entries = entry('ref-1'), closing = '87.90') => `<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt><Id>example</Id><Acct><Id><IBAN>${iban}</IBAN></Id><Ccy>EUR</Ccy></Acct>${balance('OPBD', '100.00')}${balance('CLBD', closing)}${entries}</Stmt></BkToCstmrStmt></Document>`;
const xml = statement();
assert.equal(cents('0.01'), 1);
assert.equal(cents('12.1'), 1210);
for (const invalid of ['1e3', '-2', '1.234', 'NaN', '900719925474099.99']) assert.throws(() => cents(invalid));
assert.equal(parseCamt(xml)[0].entries[0].amountCents, -1210);
assert.equal(parseCamt(xml)[0].entries[0].reference, 'INV000123');
assert.equal(parseCamt(statement(entry('credit', '12.10', 'CRDT'), '112.10'))[0].entries[0].amountCents, 1210);
assert.equal(parseCamt(xml.replaceAll('camt.053.001.02', 'camt.053.001.08'))[0].entries.length, 1);
const prefixed = xml.replace(/<(\/?)([A-Za-z][\w]*)(?=[\s>])/g, '<$1c:$2').replace('xmlns=', 'xmlns:c=');
assert.equal(parseCamt(prefixed)[0].entries.length, 1);
const batch = parseCamt(statement(entry('batch', '12.10', 'DBIT', detail('10.00') + detail('2.10', 'INV000124'))))[0];
assert.equal(batch.entries.length, 1);
assert.equal(batch.entries[0].details.length, 2);
assert.match(batch.entries[0].warning, /Batch booking/);
assert.match(parseCamt(statement(entry('batch', '12.10', 'DBIT', detail('9.00') + detail('2.10'))))[0].entries[0].warning, /do not fully/);
assert.match(parseCamt(statement(entry('batch', '12.10', 'DBIT', '<Btch><NbOfTxs>2</NbOfTxs></Btch>')))[0].entries[0].warning, /details are missing/);
assert.throws(() => parseCamt(xml.replace('xmlns="urn:iso:', 'xmlns="wrong:iso:')), /Supported formats/);
for (const invalid of [xml.replace('87.90', '87.91'), xml.replaceAll('EUR','USD'), xml.replace('BOOK','PDNG'), xml.replace('2026-10-10','2026-02-30'), xml.replace('<NtryRef>ref-1</NtryRef>',''), xml.replace('</Document>',''), '<!DOCTYPE Document [<!ENTITY x "hello">]>' + xml, statement(entry('same') + entry('same'), '75.80')]) assert.throws(() => parseCamt(invalid));
const actual = 'import/NL35INGB0006042878_01-01-2026_16-10-2026.xml';
if (existsSync(actual)) {
  const s = parseCamt(readFileSync(actual, 'utf8'))[0];
  assert.equal(s.entries.length, 60);
  assert.equal(s.openingCents + s.entries.reduce((n,e) => n + e.amountCents,0), s.closingCents);
}
console.log('PASS: decimal precision, directions, XML validation, namespace versions, balances, batches, private ING sample');

const e = { id:1,booking_date:'2026-10-10',amount_cents:-1210,counterparty:'Example Hosting',description:'INV000123',reference:'INV000123',warning:'' };
const t = { id:1,transaction_date:'2026-10-09',amount_cents:-1210,description:'Hosting INV000123',reference:'',difference:0 };
assert.equal(matchEntries([e],[t]).get(1).suggestedId,1);
assert.equal(matchEntries([e],[{...t,amount_cents:1210}]).get(1).candidates.length,0);
assert.equal(matchEntries([e],[t,{...t,id:2}]).get(1).suggestedId,null);
assert.equal(matchEntries([e,{...e,id:2}],[t]).get(1).suggestedId,null);
assert.equal(matchEntries([e],[{...t,difference:1}]).get(1).suggestedId,null);
assert.equal(matchEntries([e],[{...t,description:'unrelated'}]).get(1).suggestedId,null);
assert.equal(matchEntries([e],[{...t,transaction_date:'2026-09-30'}]).get(1).candidates.length,0);
console.log('PASS: date tolerance, reference evidence, ambiguity, competing entries, direction and imbalance matching');

// All integration writes live in a disposable schema, never the user's ledger.
const schema = 'bank_test_' + randomBytes(8).toString('hex');
const admin = new pg.Client({connectionString:process.env.DATABASE_URL});
await admin.connect();
let pool;
try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.query(`SET search_path TO ${schema}`);
  await admin.query(`
    CREATE TABLE accounts (id bigint PRIMARY KEY,name text,kind text,can_post bigint DEFAULT 1);
    CREATE TABLE projects (id bigint PRIMARY KEY);
    CREATE TABLE transactions (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,transaction_date text,description text,reference text DEFAULT '',project_id bigint REFERENCES projects);
    CREATE TABLE transaction_lines (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,transaction_id bigint REFERENCES transactions ON DELETE CASCADE,account_id bigint REFERENCES accounts,memo text DEFAULT '',debit_cents bigint DEFAULT 0,credit_cents bigint DEFAULT 0,source_in_cents bigint,source_out_cents bigint);
    INSERT INTO accounts (id,name,kind) VALUES (1,'Bank','asset'),(2,'Expense','expense'),(3,'VAT','asset'),(4,'Other bank','asset');
  `);
  await migrateBank(admin);
  await migrateBank(admin);
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('options', `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  const dbModule = await import('../../lib/db.ts');
  pool = dbModule.getPool();
  const { row, db } = dbModule;
  const { importStatement, getEntries, getEntry, getMatches, confirmSuggested, linkEntry, unlinkEntry, postEntry } = await import('../../lib/bank/service.ts');
  const imported = await importStatement(xml,'statement.xml',1,'test');
  assert.equal(imported.added,1);
  assert.equal((await row('SELECT count(*) count FROM transactions')).count,0);
  assert.equal((await importStatement(xml,'renamed.xml',1,'test')).duplicate,true);
  assert.equal((await importStatement(xml.replace('<Id>example</Id>','<Id>new-export</Id>'),'overlap.xml',1,'test')).added,0);
  await assert.rejects(importStatement(xml,'wrong.xml',4,'test'),/different ledger/);
  await assert.rejects(importStatement(xml.replaceAll('12.10','12.11').replace('87.90','87.89'),'conflict.xml',1,'test'),/different date or amount/);
  assert.equal((await row('SELECT count(*) count FROM bank_imports')).count,2);
  const record = (await getEntries())[0];
  const legacy = (await db.prepare("INSERT INTO transactions (transaction_date,description) VALUES ('2026-10-09','Hosting INV000123')").run()).lastInsertRowid;
  // Source fields are archival only. Matching must use actual debit/credit,
  // even when stale compatibility fields say otherwise.
  await db.prepare('INSERT INTO transaction_lines (transaction_id,account_id,credit_cents,source_in_cents,source_out_cents) VALUES (?,1,1210,1210,0)').run(legacy);
  await db.prepare('INSERT INTO transaction_lines (transaction_id,account_id,debit_cents) VALUES (?,2,1210)').run(legacy);
  assert.equal((await getMatches([record])).get(record.id).suggestedId,legacy);
  await assert.rejects(postEntry(record.id,'Duplicate',null,[{accountId:2,amountCents:1210,memo:''}],'test',false),/Possible existing/);
  await confirmSuggested([record.id],'test');
  assert.equal((await getEntry(record.id)).transaction_id,legacy);
  for(const q of ["UPDATE transactions SET description='changed' WHERE id=?",'DELETE FROM transactions WHERE id=?','UPDATE transaction_lines SET debit_cents=0 WHERE transaction_id=?','DELETE FROM transaction_lines WHERE transaction_id=?','INSERT INTO transaction_lines (transaction_id,account_id) VALUES (?,2)']) await assert.rejects(db.prepare(q).run(legacy),/Unlink/);
  await assert.rejects(confirmSuggested([record.id],'test'),/changed/);
  await unlinkEntry(record.id,'test');
  assert.equal((await row('SELECT count(*) count FROM transactions')).count,1);
  const results = await Promise.allSettled([linkEntry(record.id,legacy,'test',false),linkEntry(record.id,legacy,'test',false)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  await unlinkEntry(record.id,'test');
  await db.prepare('UPDATE transaction_lines SET debit_cents=1200 WHERE transaction_id=? AND account_id=2').run(legacy);
  await assert.rejects(linkEntry(record.id,legacy,'test',false),/unbalanced/);
  await linkEntry(record.id,legacy,'test',true);
  await unlinkEntry(record.id,'test');
  console.log('PASS: import idempotency, overlapping exports, rollback, standard direction, link/unlink audit, protected ledger and concurrent matching');

  await importStatement(statement(entry('new-entry','12.10','CRDT'),'112.10'),'new.xml',1,'test');
  const fresh = (await getEntries()).find(e=>e.bank_reference==='new-entry');
  await assert.rejects(postEntry(fresh.id,'Receipt',null,[{accountId:2,amountCents:1209,memo:''}],'test',false),/add up/);
  await assert.rejects(postEntry(fresh.id,'Receipt',null,[{accountId:1,amountCents:1210,memo:''}],'test',false),/different ledger/);
  await assert.rejects(postEntry(fresh.id,'Receipt',null,[{accountId:999,amountCents:1210,memo:''}],'test',false),/valid posting/);
  const posted = await Promise.allSettled([postEntry(fresh.id,'Receipt',null,[{accountId:2,amountCents:1000,memo:'Net'},{accountId:3,amountCents:210,memo:'VAT'}],'test',false),postEntry(fresh.id,'Receipt',null,[{accountId:2,amountCents:1210,memo:''}],'test',false)]);
  assert.equal(posted.filter(r=>r.status==='fulfilled').length,1);
  const transactionId = posted.find(r=>r.status==='fulfilled').value;
  assert.equal((await row('SELECT SUM(debit_cents-credit_cents) amount FROM transaction_lines WHERE transaction_id=?',transactionId)).amount,0);
  assert.equal((await row('SELECT debit_cents FROM transaction_lines WHERE transaction_id=? AND account_id=1',transactionId)).debit_cents,1210);
  await unlinkEntry(fresh.id,'test');
  await linkEntry(fresh.id,transactionId,'test',false);
  assert.equal((await row('SELECT count(*) count FROM transactions')).count,2);
  assert((await row('SELECT count(*) count FROM bank_review_events')).count >= 8);
  console.log('PASS: posting review, invalid splits, atomic balanced posting, double-submit prevention, re-linking and audit history');
} finally {
  await pool?.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
}
