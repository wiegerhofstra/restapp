import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import '../../lib/db.ts';
import { standardAccount, standardLegacyLine, standardReportSide } from '../../lib/legacy-ledger.ts';
import { reportValue } from '../../lib/report-values.ts';
import { migrateBank } from '../lib/migrate-bank.mjs';
import { captureLedger, planStandardLedger, applyStandardLedger, MIGRATION } from '../lib/standard-ledger.mjs';

const accounts=[
  [2,'Assets','asset',null,0],[3,'ING Bank account','asset',2,0],[4,'Expenses','expense',null,0],
  [5,'Bank Service Charge','expense',4,0],[6,'Equipment','expense',4,0],[8,'Sales','income',null,0],
  [9,'Taxes','expense',4,0],[10,'BTW 21%','expense',9,0],[11,'Inc Taxes','income',null,0],
  [12,'BTW advanced 21%','income',11,0],[16,'Tax returns','income',11,0],[24,'Turnover tax','expense',9,0],
  [30,'BTW advanced 21% verlegd','income',11,1],[31,'BTW 21% verlegd','expense',9,0],
  [35,'Openprovider','asset',2,0],[36,'Netcup','expense',4,0],
].map(([id,name,kind,parent_id,inverted])=>({id,name,kind,parent_id,inverted}));
const byAccount=new Map(accounts.map(a=>[a.id,a]));
function legacy(id,transaction_id,account_id,source_in_cents,source_out_cents) {
  const a=byAccount.get(account_id),toggle=a.inverted?-1:1;
  const old=source_in_cents*toggle*(a.kind==='income'?-1:1)-source_out_cents*toggle*(a.kind==='asset'?-1:1);
  return {id,transaction_id,account_id,source_in_cents,source_out_cents,debit_cents:Math.max(old,0),credit_cents:Math.max(-old,0)};
}
const lines=[
  legacy(1,1,3,0,1210),legacy(2,1,5,0,1000),legacy(3,1,12,210,0),
  legacy(4,2,3,2420,0),legacy(5,2,8,2000,0),legacy(6,2,10,0,420),
  legacy(7,3,3,0,1000),legacy(8,3,5,0,1000),legacy(9,3,30,210,0),legacy(10,3,31,0,210),
  legacy(11,4,3,1210,0),legacy(12,4,5,0,-1000),legacy(13,4,12,-210,0),
  legacy(14,5,3,0,500),legacy(15,5,35,500,0),legacy(16,6,3,50,0),
  legacy(2967,1017,3,482,0),legacy(2968,1017,36,-482,0),
  legacy(3332,1135,3,14300,0),legacy(3333,1135,6,0,14300),
  legacy(20,7,3,0,300),legacy(21,7,24,0,300),legacy(22,8,3,400,0),legacy(23,8,16,400,0),
];
assert.equal(standardLegacyLine(lines[0],byAccount.get(3)).credit_cents,1210);
assert.equal(standardLegacyLine(lines[2],byAccount.get(12)).debit_cents,210);
assert.equal(standardLegacyLine(lines[8],byAccount.get(30)).debit_cents,210);
assert.equal(standardLegacyLine(lines[9],byAccount.get(31)).credit_cents,210);
assert.equal(standardAccount(byAccount.get(30)).inverted,0);
assert.equal(standardReportSide(byAccount.get(12),'in',false),'net_debit');
assert.equal(standardReportSide(byAccount.get(12),'out',true),'credit');
assert.equal(standardReportSide(byAccount.get(3),'in',false),'debit');
assert.equal(reportValue({side:'net_credit',debit:10,credit:20}),10);
assert.throws(()=>standardAccount({...byAccount.get(12),name:'Unrelated income'}),/reviewed chart/);
assert.throws(()=>standardLegacyLine({...lines.find(l=>l.id===3333),source_out_cents:1},byAccount.get(6)),/reviewed source/);

const schema='standard_test_'+randomBytes(8).toString('hex');
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
await client.connect();
try {
  await client.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}`);
  await client.query(`
    CREATE TABLE accounts (id bigint PRIMARY KEY,name text,kind text,parent_id bigint,inverted bigint,can_post bigint DEFAULT 1);
    CREATE TABLE transactions (id bigint PRIMARY KEY,transaction_date text,description text);
    CREATE TABLE transaction_lines (id bigint PRIMARY KEY,transaction_id bigint REFERENCES transactions,account_id bigint REFERENCES accounts,debit_cents bigint,credit_cents bigint,source_in_cents bigint,source_out_cents bigint);
    CREATE TABLE reports (id bigint PRIMARY KEY,name text,start_date text,end_date text);
    CREATE TABLE report_rows (id bigint PRIMARY KEY,report_id bigint REFERENCES reports,account_id bigint REFERENCES accounts,side text CHECK(side IN ('debit','credit','net')),legacy_column text,total_effect bigint);
  `);
  const insert=async(table,record)=>{
    const keys=Object.keys(record);
    await client.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_,i)=>`$${i+1}`).join(',')})`,Object.values(record));
  };
  for(const a of accounts) await insert('accounts',a);
  for(const id of new Set(lines.map(l=>l.transaction_id))) await insert('transactions',{id,description:`Legacy ${id}`,transaction_date:'2026-01-01'});
  for(const l of lines) await insert('transaction_lines',l);
  await insert('reports',{id:1,name:'Test',start_date:'2026-01-01',end_date:'2026-12-31'});
  for(const [id,account_id,legacy_column,total_effect] of [[1,10,'out',1],[2,12,'in',-1],[3,5,'out',-1],[4,8,'in',1]]) await insert('report_rows',{id,report_id:1,account_id,legacy_column,total_effect,side:'debit'});
  await migrateBank(client);
  const source=await captureLedger(client);
  await insert('transactions',{id:999,description:'New import',transaction_date:'2026-01-01'});
  await insert('transaction_lines',{id:9001,transaction_id:999,account_id:3,debit_cents:0,credit_cents:500,source_in_cents:0,source_out_cents:500});
  await insert('transaction_lines',{id:9002,transaction_id:999,account_id:5,debit_cents:500,credit_cents:0,source_in_cents:null,source_out_cents:null});
  await insert('bank_accounts',{id:1,iban:'NL91ABNA0417164300',account_id:3});
  for(const [id,transaction_id,amount_cents] of [[1,1,-1210],[2,999,-500]]) await insert('bank_entries',{id,bank_account_id:1,entry_key:`entry-${id}`,bank_reference:`ref-${id}`,service_reference:'',booking_date:'2026-01-01',value_date:'2026-01-01',amount_cents,counterparty:'Example',counterparty_iban:'',reference:'',description:'Example',details:'[]',transaction_id,resolution:transaction_id===999?'created':'linked'});
  const before=await captureLedger(client);
  const plan=planStandardLedger(source,before);
  assert.equal(plan.summary.preservedModernLines,2);
  assert.deepEqual(plan.after.transaction_lines.filter(l=>l.transaction_id===999),before.transaction_lines.filter(l=>l.transaction_id===999));
  assert.deepEqual(plan.summary.remainingUnbalanced.map(t=>t.id),[6]);
  const changed=structuredClone(before);changed.transaction_lines[0].credit_cents=1;
  assert.throws(()=>planStandardLedger(source,changed),/edited since/);
  assert.deepEqual(plan.after.bank_entries,before.bank_entries);
  for(const l of source.transaction_lines) {
    const next=plan.after.transaction_lines.find(n=>n.id===l.id);
    assert.equal(next.source_in_cents,l.source_in_cents);assert.equal(next.source_out_cents,l.source_out_cents);
  }
  await client.query('BEGIN');
  await applyStandardLedger(client,plan);
  await client.query('ROLLBACK');
  assert.deepEqual(await captureLedger(client),before,'Rollback must restore all changes and trigger state');
  await assert.rejects(client.query('UPDATE transaction_lines SET debit_cents=1 WHERE id=1'),/Unlink/);
  await client.query('BEGIN');
  await applyStandardLedger(client,plan);
  await client.query('COMMIT');
  assert.equal((await client.query('SELECT count(*)::int n FROM ledger_migrations WHERE name=$1',[MIGRATION])).rows[0].n,1);
  await client.query('BEGIN');
  await assert.rejects(applyStandardLedger(client,plan),/Already applied/);
  await client.query('ROLLBACK');
  await assert.rejects(client.query('DELETE FROM transaction_lines WHERE id=1'),/Unlink/);
  await assert.rejects(client.query("UPDATE transactions SET description='changed' WHERE id=1"),/Unlink/);
  assert.deepEqual(await captureLedger(client),plan.after);
  console.log('PASS: purchases, sales, credit notes, transfers, VAT payments/refunds, reverse charge and the two source refund exceptions');
  console.log('PASS: report signs/net amounts, immutable source evidence, modern postings preserved, bank links reconciled');
  console.log('PASS: source-edit rejection, atomic rollback, idempotency and restored reconciliation protections');
} finally {
  await client.query('ROLLBACK').catch(()=>{});
  await client.query(`DROP SCHEMA ${schema} CASCADE`);
  await client.end();
}
