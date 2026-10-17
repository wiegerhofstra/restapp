import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { calendarDate, calendarDateTypes, addCalendarDays } from '../lib/calendar-dates.mjs';
import { DATE_MIGRATION, captureDates, planCalendarDates, applyCalendarDates } from '../lib/migrate-calendar-dates.mjs';
import { migrateBank } from '../lib/migrate-bank.mjs';
import '../../lib/db.ts';

const originalTimezone=process.env.TZ;
const dates=['2026-01-01','2026-03-29','2026-03-30','2026-07-07','2026-10-25','2026-10-26','2024-02-29'];
for(const zone of ['Europe/Amsterdam','UTC','America/Los_Angeles','Asia/Tokyo']) {
  process.env.TZ=zone;
  for(const date of dates) assert.equal(calendarDateTypes.getTypeParser(1082,'text')(date),date);
  assert.equal(addCalendarDays('2024-02-28',1),'2024-02-29');
  assert.equal(addCalendarDays('2025-12-31',1),'2026-01-01');
  assert.equal(addCalendarDays('2026-03-28',2),'2026-03-30');
}
assert.equal(calendarDate(null),null);assert.equal(addCalendarDays(null,1),null);
for(const value of ['2026-02-30','2026-13-01','2026-07-07T00:00:00Z',new Date()]) assert.throws(()=>calendarDate(value));
process.env.TZ='Europe/Amsterdam';
assert.equal(pg.types.getTypeParser(1082)('2026-07-07').toISOString().slice(0,10),'2026-07-06');
if(originalTimezone===undefined)delete process.env.TZ;else process.env.TZ=originalTimezone;
console.log('PASS: calendar dates across four timezones, DST, leap day, year boundaries, nullable dates and reproduction of old importer bug');
const client=new pg.Client({connectionString:process.env.DATABASE_URL,types:calendarDateTypes});await client.connect();
const schema='date_test_'+randomBytes(8).toString('hex');
try {
  for(const zone of ['Europe/Amsterdam','UTC','America/Los_Angeles']) {
    await client.query("SELECT set_config('TimeZone',$1,false)",[zone]);
    const result=await client.query("SELECT DATE '2026-07-07' AS calendar_day,DATE '2026-03-29' dst,NULL::date empty,42::integer amount,TIMESTAMPTZ '2026-07-07T00:00:00Z' instant");
    assert.equal(result.rows[0].calendar_day,'2026-07-07');assert.equal(result.rows[0].dst,'2026-03-29');assert.equal(result.rows[0].empty,null);assert.equal(result.rows[0].amount,42);assert(result.rows[0].instant instanceof Date);
  }
  await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET search_path TO ${schema}`);
  await client.query(`
    CREATE TABLE accounts(id bigint PRIMARY KEY);
    CREATE TABLE transactions(id bigint PRIMARY KEY,transaction_date text,description text,created_at text);
    CREATE TABLE invoices(id bigint PRIMARY KEY,issue_date text,due_date text,paid_date text,created_at text);
    CREATE TABLE reports(id bigint PRIMARY KEY,name text,start_date text,end_date text,created_at text);
    CREATE TABLE report_rows(id bigint PRIMARY KEY,report_id bigint,account_id bigint,side text,legacy_column text,total_effect integer);
    CREATE TABLE transaction_lines(id bigint PRIMARY KEY,transaction_id bigint REFERENCES transactions,account_id bigint REFERENCES accounts,debit_cents bigint,credit_cents bigint,source_in_cents bigint,source_out_cents bigint);
    INSERT INTO accounts VALUES(3),(36);
    INSERT INTO transactions VALUES(1,'2026-03-28','Legacy DST start','original'),(2,'2026-10-24','Legacy DST end','original'),(3,'2026-08-10','Manually edited','original'),(4,'2026-07-07','New CAMT posting','new');
    INSERT INTO invoices VALUES(1,'2025-12-31','2026-01-30',NULL,'original'),(2,'2026-06-30','2026-07-30','2026-07-04','original');
    INSERT INTO reports VALUES(1,'Q2','2026-03-31','2026-06-29','original');
    INSERT INTO report_rows VALUES(1,1,36,'net_debit',NULL,1);
    INSERT INTO transaction_lines VALUES(1,1,3,0,100,NULL,NULL),(2,1,36,100,0,NULL,NULL),(3,4,3,0,200,NULL,NULL),(4,4,36,200,0,NULL,NULL);
  `);
  await migrateBank(client);
  await client.query(`INSERT INTO bank_accounts(iban,account_id) VALUES('NL91ABNA0417164300',3);
    INSERT INTO bank_entries(bank_account_id,entry_key,bank_reference,service_reference,booking_date,value_date,amount_cents,counterparty,counterparty_iban,reference,description,details,transaction_id,resolution)
    VALUES(1,'entry','entry','','2026-03-29','2026-03-29',-100,'Example','','','','[]',1,'linked');`);
  const before=await captureDates(client);
  const source=structuredClone({transactions:before.transactions.filter(t=>t.id!==4),invoices:before.invoices,reports:before.reports});
  source.transactions.find(t=>t.id===3).transaction_date='2026-08-07';
  const plan=planCalendarDates(source,before);
  assert.equal(plan.after.transactions.find(t=>t.id===1).transaction_date,'2026-03-29');
  assert.equal(plan.after.transactions.find(t=>t.id===2).transaction_date,'2026-10-25');
  assert.equal(plan.after.transactions.find(t=>t.id===3).transaction_date,'2026-08-10');
  assert.equal(plan.after.transactions.find(t=>t.id===4).transaction_date,'2026-07-07');
  assert.equal(plan.after.invoices[0].issue_date,'2026-01-01');assert.equal(plan.after.invoices[0].due_date,'2026-01-31');assert.equal(plan.after.invoices[0].paid_date,null);
  assert.equal(plan.after.invoices[1].paid_date,'2026-07-05');
  assert.equal(plan.after.reports[0].start_date,'2026-04-01');assert.equal(plan.after.reports[0].end_date,'2026-06-30');
  assert.equal(plan.summary.skipped.length,1);
  const swapped=structuredClone(before);swapped.transactions[0].created_at='replaced identity';assert.throws(()=>planCalendarDates(source,swapped),/identity/);
  await client.query('BEGIN');await applyCalendarDates(client,plan);await client.query('ROLLBACK');
  assert.deepEqual(await captureDates(client),before);
  await assert.rejects(client.query("UPDATE transactions SET transaction_date='2026-03-29' WHERE id=1"),/Unlink/);
  await client.query('BEGIN');await applyCalendarDates(client,plan);await client.query('COMMIT');
  assert.deepEqual(await captureDates(client),plan.after);
  assert.equal((await client.query('SELECT count(*)::integer n FROM ledger_migrations WHERE name=$1',[DATE_MIGRATION])).rows[0].n,1);
  await assert.rejects(applyCalendarDates(client,plan),/Already applied/);
  await assert.rejects(client.query("UPDATE transactions SET transaction_date='2026-03-30' WHERE id=1"),/Unlink/);
  assert.deepEqual((await captureDates(client)).transaction_lines,before.transaction_lines);
  assert.deepEqual((await captureDates(client)).bank_entries,before.bank_entries);
  console.log('PASS: real PostgreSQL DATE decoding, targeted correction, edited/new records preserved, report periods, invoice dates, rollback, repeat protection, bank links and ledger protection');
} finally {await client.query('ROLLBACK').catch(()=>{});await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await client.end();}
