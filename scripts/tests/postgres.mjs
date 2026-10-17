import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { db, row, getPool } from '../../lib/db.ts';
import { authFixture } from './auth-fixture.mjs';

const marker = 'migration-check-' + randomBytes(8).toString('hex');
const id = -Math.floor(Math.random()*1_000_000+1);
try {
  const identity = await row('SELECT current_database() database, current_user username');
  assert.equal(identity.database, 'restapp');
  assert.equal(identity.username, 'restapp');
  const privileges = await row('SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname=current_user');
  assert(Object.values(privileges).every(value=>value===false));
  assert.equal((await row("SELECT '?' literal, ?::text parameter", marker)).parameter, marker);
  await db.transaction(async()=>{
    const inserted=await db.prepare('INSERT INTO customers (id,name,reference) VALUES (?,?,?)').run(id,marker,marker);
    assert.equal(inserted.lastInsertRowid,id);
    await db.prepare('UPDATE customers SET name=?, updated_at=CURRENT_TIMESTAMP::text WHERE id=?').run(marker+' updated',id);
    assert.equal((await row('SELECT name FROM customers WHERE id=?',id)).name,marker+' updated');
  })();
  assert.equal((await row('SELECT count(*) count FROM customers WHERE id=?',id)).count,1);
  await assert.rejects(db.transaction(async()=>{
    await db.prepare('UPDATE customers SET name=? WHERE id=?').run('should roll back',id);
    throw new Error('test rollback');
  })(),/test rollback/);
  assert.equal((await row('SELECT name FROM customers WHERE id=?',id)).name,marker+' updated');
  await assert.rejects(db.transaction(async()=>{
    await db.prepare('INSERT INTO projects (id,customer_id,name) VALUES (?,?,?)').run(id,id-1,marker);
  })(),/foreign key constraint/);
  await db.prepare('DELETE FROM customers WHERE id=?').run(id);
  console.log('PASS: project login/privileges, parameter binding, insert/update/delete, transaction commit/rollback, foreign-key enforcement');

  if(process.env.STAPP_TEST_BASE_URL) {
    const fixture = await authFixture(getPool());
    try {
      const login = await fetch(process.env.STAPP_TEST_BASE_URL + '/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: process.env.STAPP_TEST_BASE_URL },
        body: JSON.stringify({ email: fixture.email, password: fixture.password }),
      });
      assert.equal(login.status, 200, 'Better Auth login failed');
      const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
      const paths=['/','/customers','/customers/new','/projects','/projects/new','/accounts','/accounts/new','/transactions','/transactions?page=2','/transactions?q=tax','/transactions/new','/invoices','/invoices?view=all','/invoices?view=paid','/invoices/new','/time','/time/new','/reports','/reports/new','/settings'];
      for(const table of ['customers','projects','accounts','transactions','invoices','time_entries','reports']) {
        const record=await row(`SELECT id FROM ${table} ORDER BY id LIMIT 1`);
        if(record)paths.push(`/${table==='time_entries'?'time':table}/${record.id}`);
        if(table==='invoices'&&record)paths.push(`/invoices/${record.id}/preview`);
      }
      paths.push('/settings/presets', '/bank', '/bank?view=review', '/bank?view=new', '/bank?view=processed');
      if((await row("SELECT to_regclass('bank_entries') IS NOT NULL ready")).ready) {
        const entry=await row('SELECT id FROM bank_entries ORDER BY id LIMIT 1');
        if(entry) paths.push(`/bank/${entry.id}`);
        const linked=await row('SELECT transaction_id FROM bank_entries WHERE transaction_id IS NOT NULL LIMIT 1');
        if(linked) paths.push(`/transactions/${linked.transaction_id}`);
      }
      for(const path of paths) {
        const response=await fetch(process.env.STAPP_TEST_BASE_URL+path,{headers:{Cookie:cookie},redirect:'manual'});
        const body=await response.text();
        assert.equal(response.status,200,`${path} returned ${response.status}`);
        assert(!body.includes('"digest":"')&&!body.includes('NEXT_HTTP_ERROR_FALLBACK;500')&&!body.includes('Application error:'),`${path} contains a runtime error`);
        console.log('PASS route:',path);
      }
    } finally {await fixture.cleanup();}
  }
} finally {
  await db.prepare('DELETE FROM customers WHERE id=? AND reference=?').run(id,marker);
  await globalThis.restappPool?.end();
}
