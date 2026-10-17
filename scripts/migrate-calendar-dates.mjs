import pg from 'pg';
import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import '../lib/db.ts'; // Safe PostgreSQL bigint decoding, shared with the application.
import { DATE_MIGRATION as MIGRATION, captureDates as captureLedger, planCalendarDates as planStandardLedger, applyCalendarDates as applyStandardLedger, dateBackupTables as backupTables } from './lib/migrate-calendar-dates.mjs';

const apply=process.argv.includes('--apply');
const sourceFlag=process.argv.indexOf('--source');
if(sourceFlag<0 || !process.argv[sourceFlag+1]) throw new Error('Supply --source <original pre-PostgreSQL SQLite snapshot>. Default is a dry run; --apply writes the verified plan.');
const sourcePath=resolve(process.argv[sourceFlag+1]);
const sourceDb=new Database(sourcePath,{readonly:true,fileMustExist:true});
const source=Object.fromEntries(['transactions','invoices','reports'].map(t=>[t,sourceDb.prepare(`SELECT * FROM ${t} ORDER BY id`).all()]));
sourceDb.close();
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
const stamp=new Date().toISOString().replaceAll(':','-');
const directory=resolve('data/backups',`calendar-dates-${stamp}`);
mkdirSync(directory,{recursive:true,mode:0o700});
const save=(name,data)=>writeFileSync(join(directory,name),JSON.stringify(data,null,2)+'\n',{mode:0o600});
try {
  await client.connect();
  await client.query(apply?'BEGIN':'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL lock_timeout='10s'");
  if(apply) {
    await client.query('SELECT pg_advisory_xact_lock(713053)');
    for(const table of backupTables) {
      if((await client.query('SELECT to_regclass($1) present',[table])).rows[0].present) await client.query(`LOCK TABLE ${table} IN SHARE ROW EXCLUSIVE MODE`);
    }
  }
  if((await client.query("SELECT to_regclass('ledger_migrations') present")).rows[0].present &&
    (await client.query('SELECT 1 FROM ledger_migrations WHERE name=$1',[MIGRATION])).rowCount) {
    await client.query('ROLLBACK');console.log('Calendar date migration already applied; no changes made.');
  } else {
    const before=await captureLedger(client);
    const plan=planStandardLedger(source,before);
    save('reconciliation.json',{...plan.summary,sourcePath,sourceSha256:createHash('sha256').update(readFileSync(sourcePath)).digest('hex'),mode:apply?'apply':'dry-run'});
    if(apply) {
      save('before.json',before);
      const snapshot=(await client.query('SELECT pg_export_snapshot() snapshot')).rows[0].snapshot;
      const dumpPath=join(directory,'before.dump');
      // Credentials remain in the environment, never in command arguments/logs.
      const connection=client.connectionParameters;
      const dumpEnv={...process.env,PGHOST:connection.host,PGPORT:String(connection.port),PGDATABASE:connection.database,PGUSER:connection.user,PGPASSWORD:connection.password};
      const sslmode=new URL(process.env.DATABASE_URL).searchParams.get('sslmode');
      if(sslmode) dumpEnv.PGSSLMODE=sslmode;
      else if(!connection.ssl) dumpEnv.PGSSLMODE='disable';
      const dump=spawnSync('pg_dump',['--format=custom','--no-owner',`--snapshot=${snapshot}`,`--file=${dumpPath}`],{env:dumpEnv,encoding:'utf8',timeout:60000});
      if(dump.error || dump.status!==0) throw new Error(`Database backup failed: ${dump.error?.message??dump.stderr}`);
      chmodSync(dumpPath,0o600);
      const after=await applyStandardLedger(client,plan);
      save('after.json',after);
      await client.query('COMMIT');
      save('committed.json',{migration:MIGRATION,committedAt:new Date().toISOString(),dumpSha256:createHash('sha256').update(readFileSync(dumpPath)).digest('hex')});
    } else await client.query('ROLLBACK');
    console.log(JSON.stringify({mode:apply?'applied':'dry-run',changedRows:plan.summary.changedRows,changedFields:plan.summary.changedFields,preservedNewRows:plan.summary.preservedNewRows,skipped:plan.summary.skipped,linkedTransactionsPreserved:plan.summary.linkedDateChanges.length,reportTotalChanges:plan.summary.reportTotalChanges,artifacts:directory},null,2));
  }
} catch(error) { await client.query('ROLLBACK').catch(()=>{});throw error; }
finally { await client.end(); }
