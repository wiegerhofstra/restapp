import assert from 'node:assert/strict';
import { addCalendarDays, calendarDate } from './calendar-dates.mjs';
import { reportResults } from './standard-ledger.mjs';
export const DATE_MIGRATION = '2026-10-legacy-calendar-dates-v1';
export const dateFields = { transactions: ['transaction_date'], invoices: ['issue_date','due_date','paid_date'], reports: ['start_date','end_date'] };
export const dateBackupTables = ['transactions','invoices','reports','transaction_lines','report_rows','bank_accounts','bank_entries','bank_review_events','transaction_preset_applications'];
export async function captureDates(client) {
  const result = {};
  for(const table of dateBackupTables) result[table] = (await client.query('SELECT to_regclass($1) present',[table])).rows[0].present ? (await client.query(`SELECT * FROM ${table} ORDER BY id`)).rows : [];
  return result;
}
export function planCalendarDates(source, before) {
  const after=structuredClone(before), changes=[], skipped=[];
  const preservedNewRows={};
  for(const [table,fields] of Object.entries(dateFields)) {
    const originals=new Map(source[table].map(r=>[r.id,r]));
    preservedNewRows[table]=before[table].filter(r=>!originals.has(r.id)).length;
    for(const record of after[table]) {
      const original=originals.get(record.id);
      if(!original) continue;
      assert.equal(record.created_at,original.created_at,`${table} ${record.id}: identity no longer matches snapshot`);
      for(const field of fields) {
        const old=original[field];
        if(record[field]!==old) { skipped.push({table,id:record.id,field,snapshot:old,current:record[field],reason:'Changed since import snapshot; preserved'});continue; }
        if(old===null) continue;
        calendarDate(old);
        const corrected=addCalendarDays(old,1);
        // Independently reproduce the old importer in Amsterdam (including DST).
        // Formatting UTC midnight +1h/+2h avoids changing the process timezone.
        const midnightUtc=new Date(`${corrected}T00:00:00Z`);
        const offset=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Amsterdam',hour:'2-digit',hourCycle:'h23'}).format(midnightUtc));
        assert([1,2].includes(offset),'Unsupported source timezone offset');
        const buggy=new Date(midnightUtc.getTime()-offset*3600000).toISOString().slice(0,10);
        assert.equal(buggy,old,'Correction does not reproduce original timezone bug');
        record[field]=corrected;changes.push({table,id:record.id,field,before:old,after:corrected});
      }
    }
  }
  const summarizeReports=data=>{
    const totals=new Map();
    for(const r of reportResults(data)) totals.set(r.report_id,{id:r.report_id,name:r.report_name,value:(totals.get(r.report_id)?.value??0)+r.value*r.total_effect});
    return totals;
  };
  const oldTotals=summarizeReports(before),newTotals=summarizeReports(after);
  const linkedDateChanges=after.bank_entries.filter(e=>e.transaction_id).map(e=>{
    const old=before.transactions.find(t=>t.id===e.transaction_id),current=after.transactions.find(t=>t.id===e.transaction_id);
    return {bankEntry:e.id,transaction:e.transaction_id,bookingDate:e.booking_date,before:old.transaction_date,after:current.transaction_date};
  }).filter(e=>e.before!==e.after);
  return {after,changes,summary:{migration:DATE_MIGRATION,method:'Inverse of the reproduced PostgreSQL DATE → Amsterdam midnight → UTC date truncation; original imported SQLite snapshot membership and unchanged date fields only. Live Rails source unavailable.',
    changedRows:Object.fromEntries(Object.keys(dateFields).map(table=>[table,new Set(changes.filter(c=>c.table===table).map(c=>c.id)).size])),changedFields:changes.length,preservedNewRows,skipped,linkedDateChanges,
    reportTotalChanges:[...newTotals.values()].filter(r=>r.value!==oldTotals.get(r.id).value).map(r=>({id:r.id,name:r.name,before:oldTotals.get(r.id).value,after:r.value})),changes}};
}
export async function applyCalendarDates(client,plan) {
  await client.query('CREATE TABLE IF NOT EXISTS ledger_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now(),summary jsonb NOT NULL)');
  if((await client.query('SELECT 1 FROM ledger_migrations WHERE name=$1',[DATE_MIGRATION])).rowCount) throw new Error('Already applied');
  const trigger=(await client.query("SELECT 1 FROM pg_trigger WHERE tgrelid='transactions'::regclass AND tgname='protect_bank_transaction' AND tgenabled='O'")).rowCount;
  if(trigger) await client.query('ALTER TABLE transactions DISABLE TRIGGER protect_bank_transaction');
  // The CLI holds bank/reconciliation and table write locks throughout backup,
  // correction and verification. Trigger changes roll back with all other work.
  for(const [table,fields] of Object.entries(dateFields)) {
    const updates=plan.after[table].filter(r=>plan.changes.some(c=>c.table===table&&c.id===r.id)).map(r=>({id:r.id,...Object.fromEntries(fields.map(f=>[f,r[f]]))}));
    if(!updates.length) continue;
    await client.query(`UPDATE ${table} t SET ${fields.map(f=>`${f}=v.${f}`).join(',')} FROM jsonb_to_recordset($1::jsonb) AS v(id bigint,${fields.map(f=>`${f} text`).join(',')}) WHERE t.id=v.id`,[JSON.stringify(updates)]);
  }
  if(trigger) await client.query('ALTER TABLE transactions ENABLE TRIGGER protect_bank_transaction');
  const actual=await captureDates(client);
  assert.deepEqual(actual,plan.after,'Date correction differs from reviewed plan');
  await client.query('INSERT INTO ledger_migrations(name,summary) VALUES($1,$2::jsonb)',[DATE_MIGRATION,JSON.stringify(plan.summary)]);
  return actual;
}
