import assert from 'node:assert/strict';
import { standardAccount, standardLegacyLine, standardReportSide } from '../../lib/legacy-ledger.ts';
import { reportValue } from '../../lib/report-values.ts';

export const MIGRATION = '2026-10-standard-legacy-ledger-v1';
export const backupTables = ['accounts','transactions','transaction_lines','reports','report_rows','bank_accounts','bank_entries','bank_review_events'];
export async function captureLedger(client) {
  const data = {};
  for (const table of backupTables) {
    const exists = (await client.query('SELECT to_regclass($1) present',[table])).rows[0].present;
    data[table] = exists ? (await client.query(`SELECT * FROM ${table} ORDER BY id`)).rows : [];
  }
  return data;
}
function sameSourceRows(source, current, table) {
  const currentById = new Map(current[table].map(row=>[Number(row.id),row]));
  for (const original of source[table]) {
    const actual = currentById.get(original.id);
    assert(actual, `Missing original ${table} row ${original.id}`);
    for (const key of Object.keys(original)) {
      assert.equal(actual[key], original[key], `${table} ${original.id} was edited since the source snapshot (${key}); review before migration`);
    }
  }
}
function transactionBalances(data) {
  const values = new Map(data.transactions.map(t=>[t.id,{id:t.id,description:t.description,difference:0}]));
  for(const line of data.transaction_lines) values.get(line.transaction_id).difference += line.debit_cents - line.credit_cents;
  return [...values.values()];
}
export function reportResults(data) {
  const transactions = new Map(data.transactions.map(t=>[t.id,t]));
  const reports = new Map(data.reports.map(r=>[r.id,r]));
  return data.report_rows.map(r=>{
    const report=reports.get(r.report_id);
    const sums={debit:0,credit:0,legacy_in:0,legacy_out:0};
    for(const l of data.transaction_lines) {
      const t=transactions.get(l.transaction_id);
      if(l.account_id!==r.account_id || t.transaction_date<report.start_date || t.transaction_date>report.end_date) continue;
      sums.debit+=l.debit_cents;sums.credit+=l.credit_cents;
      sums.legacy_in+=l.source_in_cents??0;sums.legacy_out+=l.source_out_cents??0;
    }
    return {id:r.id,report_id:r.report_id,report_name:report.name,value:reportValue({...r,...sums}),total_effect:r.total_effect};
  });
}
export function planStandardLedger(source, before) {
  // Exact source membership, never an id cutoff or non-null source-column test:
  // current bank imports also populate those columns.
  for(const table of ['accounts','transactions','transaction_lines']) sameSourceRows(source,before,table);
  const originalAccounts=new Map(source.accounts.map(a=>[a.id,a]));
  const originalLines=new Map(source.transaction_lines.map(l=>[l.id,l]));
  const after=structuredClone(before);
  after.accounts=after.accounts.map(a=>{
    if(!originalAccounts.has(a.id)) return a;
    const converted=standardAccount(originalAccounts.get(a.id));
    return {...a,kind:converted.kind,parent_id:converted.parent_id,inverted:converted.inverted};
  });
  after.transaction_lines=after.transaction_lines.map(l=>originalLines.has(l.id)
    ? {...l,...standardLegacyLine(originalLines.get(l.id),originalAccounts.get(l.account_id))}:l);
  after.report_rows=after.report_rows.map(r=>{
    if(!r.legacy_column) return r;
    const a=originalAccounts.get(r.account_id);
    assert(a,`Report ${r.id} uses an unknown legacy account`);
    const separate=before.report_rows.some(other=>other.report_id===r.report_id && other.account_id===r.account_id && other.legacy_column && other.legacy_column!==r.legacy_column);
    return {...r,side:standardReportSide(a,r.legacy_column,separate),legacy_column:null};
  });
  const oldBalances=transactionBalances(before),newBalances=transactionBalances(after);
  const oldById=new Map(oldBalances.map(t=>[t.id,t]));
  const newlyUnbalanced=newBalances.filter(t=>t.difference!==0 && oldById.get(t.id).difference===0);
  assert.equal(newlyUnbalanced.length,0,`Conversion would unbalance previously balanced transactions: ${newlyUnbalanced.map(t=>t.id)}`);
  const accountDiff=after.accounts.filter((a,i)=>JSON.stringify(a)!==JSON.stringify(before.accounts[i]));
  const lineDiff=after.transaction_lines.filter((l,i)=>JSON.stringify(l)!==JSON.stringify(before.transaction_lines[i]));
  const reportDiff=after.report_rows.filter((r,i)=>JSON.stringify(r)!==JSON.stringify(before.report_rows[i]));
  const previousReports=new Map(reportResults(before).map(r=>[r.id,r]));
  const nextReports=reportResults(after);
  const reportChanges=nextReports.filter(r=>r.value!==previousReports.get(r.id).value).map(r=>({...r,before:previousReports.get(r.id).value,after:r.value}));
  const totals=new Map();
  for(const r of nextReports) {
    const t=totals.get(r.report_id)??{id:r.report_id,name:r.report_name,before:0,after:0};
    t.before+=previousReports.get(r.id).value*r.total_effect;t.after+=r.value*r.total_effect;totals.set(r.report_id,t);
  }
  // Every linked bank amount must now be explained by actual debit/credit lines.
  for(const e of after.bank_entries.filter(e=>e.transaction_id)) {
    const bank=after.bank_accounts.find(a=>a.id===e.bank_account_id);
    const amount=after.transaction_lines.filter(l=>l.transaction_id===e.transaction_id&&l.account_id===bank.account_id).reduce((n,l)=>n+l.debit_cents-l.credit_cents,0);
    assert.equal(amount,e.amount_cents,`Bank link ${e.id} would disagree with the corrected ledger`);
  }
  return {after,accountDiff,lineDiff,reportDiff,summary:{migration:MIGRATION,
    sourceLines:source.transaction_lines.length,changedLines:lineDiff.length,changedAccounts:accountDiff.length,convertedReportRows:reportDiff.length,
    preservedModernLines:before.transaction_lines.length-source.transaction_lines.length,
    linkedEntriesVerified:after.bank_entries.filter(e=>e.transaction_id).length,
    previouslyUnbalanced:oldBalances.filter(t=>t.difference).length,remainingUnbalanced:newBalances.filter(t=>t.difference),
    reportRowChanges:reportChanges,reportTotalChanges:[...totals.values()].filter(t=>t.before!==t.after),
    refundCorrections:[{transaction:1017,line:2968,reason:'Incoming bank refund of 482 cents requires an expense credit.'},{transaction:1135,line:3333,reason:'Incoming bank refund of 14300 cents requires an expense credit.'}]}};
}

export async function applyStandardLedger(client, plan) {
  await client.query(`CREATE TABLE IF NOT EXISTS ledger_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(), summary jsonb NOT NULL)`);
  if((await client.query('SELECT 1 FROM ledger_migrations WHERE name=$1',[MIGRATION])).rowCount) throw new Error('Already applied');
  const trigger=(await client.query("SELECT 1 FROM pg_trigger WHERE tgrelid='transaction_lines'::regclass AND tgname='protect_bank_lines' AND tgenabled='O'")).rowCount;
  // The caller holds the bank advisory lock and write locks. This is a
  // transaction-local maintenance window, not an application bypass flag.
  if(trigger) await client.query('ALTER TABLE transaction_lines DISABLE TRIGGER protect_bank_lines');
  for(const a of plan.accountDiff) await client.query('UPDATE accounts SET kind=$1,parent_id=$2,inverted=$3 WHERE id=$4',[a.kind,a.parent_id,a.inverted,a.id]);
  for(const l of plan.lineDiff) await client.query('UPDATE transaction_lines SET debit_cents=$1,credit_cents=$2 WHERE id=$3',[l.debit_cents,l.credit_cents,l.id]);
  if(trigger) await client.query('ALTER TABLE transaction_lines ENABLE TRIGGER protect_bank_lines');
  await client.query(`ALTER TABLE report_rows DROP CONSTRAINT IF EXISTS report_rows_side_check;
    ALTER TABLE report_rows ADD CONSTRAINT report_rows_side_check CHECK(side IN ('debit','credit','net','net_debit','net_credit'))`);
  for(const r of plan.reportDiff) await client.query('UPDATE report_rows SET side=$1,legacy_column=NULL WHERE id=$2',[r.side,r.id]);
  const actual=await captureLedger(client);
  assert.deepEqual(actual,plan.after,'Post-migration data differs from the reviewed plan');
  await client.query('INSERT INTO ledger_migrations (name,summary) VALUES ($1,$2::jsonb)',[MIGRATION,JSON.stringify(plan.summary)]);
  return actual;
}
