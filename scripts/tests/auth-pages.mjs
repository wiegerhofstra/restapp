import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { authFixture } from './auth-fixture.mjs';

// Exercise real Next.js HTML/RSC responses, not just auth API responses or
// redirect status codes. Run `npm run build` first. Only table definitions are
// copied from the configured database; all writes use a disposable schema.
assert(existsSync('.next/BUILD_ID'), 'Run npm run build before test:auth-pages');
const schema = 'auth_pages_test_' + randomUUID().replaceAll('-', '');
const marker = 'PRIVATE_' + randomUUID().replaceAll('-', '');
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
const url = new URL(process.env.DATABASE_URL);
url.searchParams.set('options', `-c search_path=${schema}`);
const pool = new pg.Pool({ connectionString: url.toString() });
let server;
let serverClosed;
let logs = '';

function privatePages(directory = 'app/(app)', segments = []) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory()) return privatePages(`${directory}/${entry.name}`, [...segments, entry.name]);
    if (entry.name !== 'page.tsx') return [];
    return ['/' + segments.map(segment => ({ '[id]': '1', '[year]': '2026', '[quarter]': '3', '[kind]': 'transaction' })[segment] ?? segment).join('/')];
  });
}

try {
  await admin.connect();
  const sourceSchema = (await admin.query('SELECT current_schema() name')).rows[0].name;
  const tables = (await admin.query(`SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename`, [sourceSchema])).rows;
  assert(tables.some(t => t.tablename === 'auth_user') && tables.some(t => t.tablename === 'income_tax_snapshots'),
    'Use a migrated development database as the schema template');
  // Copying serial defaults could advance the source database's sequences.
  const serials = await admin.query(`SELECT 1 FROM information_schema.columns
    WHERE table_schema=$1 AND column_default LIKE '%nextval(%' LIMIT 1`, [sourceSchema]);
  assert.equal(serials.rowCount, 0, 'Schema template must use identity columns, not shared serial defaults');
  await admin.query(`CREATE SCHEMA ${quote(schema)}`);
  for (const { tablename } of tables) {
    await admin.query(`CREATE TABLE ${quote(schema)}.${quote(tablename)} (LIKE ${quote(sourceSchema)}.${quote(tablename)} INCLUDING ALL)`);
  }
  assert.equal((await pool.query('SELECT current_schema() name')).rows[0].name, schema);
  await pool.query(`INSERT INTO customers(id,name,reference) VALUES(1,$1,'TEST')`, [marker]);
  await pool.query(`INSERT INTO projects(id,customer_id,name) VALUES(1,1,$1)`, [marker]);
  await pool.query(`INSERT INTO accounts(id,name,kind) VALUES(1,$1,'asset'),(2,$1,'expense')`, [marker]);
  await pool.query(`INSERT INTO transactions(id,transaction_date,description,project_id) VALUES(1,'2026-07-01',$1,1)`, [marker]);
  await pool.query(`INSERT INTO transaction_lines(transaction_id,account_id,debit_cents,credit_cents)
    VALUES(1,1,0,1210),(1,2,1210,0)`);
  await pool.query(`INSERT INTO invoices(id,invoice_number,reference_number,issue_date,due_date,concern,project_id,status)
    VALUES(1,1,1,'2026-07-01','2026-07-31',$1,1,'sent')`, [marker]);
  await pool.query(`INSERT INTO invoice_lines(invoice_id,description,unit_price_cents) VALUES(1,$1,1000)`, [marker]);
  await pool.query(`INSERT INTO time_entries(id,project_id,name,started_at,ended_at)
    VALUES(1,1,$1,'2026-07-01T09:00:00Z','2026-07-01T10:00:00Z')`, [marker]);
  await pool.query(`INSERT INTO reports(id,name,start_date,end_date) VALUES(1,$1,'2026-07-01','2026-09-30')`, [marker]);
  await pool.query(`INSERT INTO report_rows(report_id,label,account_id) VALUES(1,$1,2)`, [marker]);
  await pool.query(`INSERT INTO settings(key,value,label,group_name) VALUES('company_name',$1,'Company','company'),('currency','EUR','Currency','general')`, [marker]);
  await pool.query(`INSERT INTO suppliers(id,name) OVERRIDING SYSTEM VALUE VALUES(1,$1)`, [marker]);
  await pool.query(`INSERT INTO posting_presets(id,name,expense_account_id,vat_mode,rate_bps) VALUES(1,$1,2,'none',0)`, [marker]);
  await pool.query(`INSERT INTO bank_accounts(id,iban,account_id) VALUES(1,'NL91ABNA0417164300',1)`);
  await pool.query(`INSERT INTO bank_entries(id,bank_account_id,entry_key,bank_reference,service_reference,booking_date,value_date,
    amount_cents,counterparty,counterparty_iban,reference,description,details)
    VALUES(1,1,'test-entry','test-reference','','2026-07-01','2026-07-01',-1210,$1,'','',$1,'[]')`, [marker]);
  const identity = await authFixture(pool);

  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  const baseURL = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: resolve('.'),
    env: { ...process.env, DATABASE_URL: url.toString(), BETTER_AUTH_URL: baseURL, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverClosed = once(server, 'close');
  for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-20000); });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    assert(server.exitCode === null, `Test server exited: ${logs}`);
    try { ready = (await fetch(`${baseURL}/login`, { signal: AbortSignal.timeout(1000) })).status === 200; } catch {}
    if (ready) break;
    await delay(100);
  }
  assert(ready, `Test server did not become ready: ${logs}`);

  // Keep the existing workspace layout in the client router tree. A navigation
  // request must recheck the session even when the layout is not rendered again.
  const routerTree = section => encodeURIComponent(JSON.stringify(['', { children: ['(app)', { children: [section, { children: ['__PAGE__', {}] }] }] }]));
  const modes = [
    { name: 'HTML', headers: {} },
    { name: 'RSC navigation', headers: { RSC: '1' } },
    { name: 'RSC prefetch', headers: { RSC: '1', 'Next-Router-Prefetch': '1' } },
  ];
  async function request(path, mode, cookie) {
    let target = new URL(path, baseURL);
    const headers = { ...mode.headers, ...(cookie ? { Cookie: cookie } : {}) };
    if (headers.RSC) {
      // Model a navigation to a different page, not a no-op on the current URL.
      const from = target.pathname === '/customers' ? 'invoices' : 'customers';
      headers['Next-Router-State-Tree'] = routerTree(from);
      headers['Next-Url'] = `/${from}`;
    }
    // Next may first redirect RSC requests to add its cache-key query parameter.
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await fetch(target, { headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });
      const body = await response.text();
      const location = response.headers.get('location');
      if (location) {
        const next = new URL(location, target);
        if (next.origin === target.origin && next.pathname === target.pathname && next.href !== target.href) {
          assert(!body.includes(marker), `${path}: private data in intermediate redirect`);
          target = next;
          continue;
        }
      }
      return { response, body, location };
    }
    throw new Error(`Too many RSC redirects: ${path}`);
  }
  async function assertPrivate(path, mode, cookie, destination = '/login') {
    const { response, body, location } = await request(path, mode, cookie);
    assert(!body.includes(marker), `${mode.name} ${path}: private data leaked`);
    assert(response.status < 400, `${mode.name} ${path}: server error ${response.status}\n${logs}`);
    // Prefetch may return an empty RSC shell without executing a dynamic page.
    // It must still never serialize business data; navigation must redirect.
    if (mode.name === 'RSC prefetch' && response.status === 200) {
      assert(response.headers.get('content-type')?.includes('text/x-component'));
      return;
    }
    assert(location === destination || body.includes(`NEXT_REDIRECT;replace;${destination};`),
      `${mode.name} ${path}: expected authentication redirect, got ${response.status}`);
  }
  async function login() {
    const response = await fetch(`${baseURL}/api/auth/sign-in/email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: baseURL },
      body: JSON.stringify({ email: identity.email, password: identity.password }),
    });
    assert.equal(response.status, 200, 'Fixture login failed');
    return response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  }
  const paths = [...privatePages(), '/reports/vat/review/invoice/1'];
  // First reproduce the original leak with populated customer data.
  await assertPrivate('/customers', modes[0]);
  for (const path of paths) for (const mode of modes) await assertPrivate(path, mode);
  console.log(`PASS: anonymous HTML, RSC navigation and prefetch contain no private data across ${paths.length} page paths`);

  const cookie = await login();
  for (const path of paths) {
    const { response, body, location } = await request(path, modes[0], cookie);
    if (['/reports/vat', '/reports/income-tax'].includes(path)) {
      assert(location?.startsWith(path + '/'), `Authenticated index redirect failed: ${path}`);
    } else {
      assert.equal(response.status, 200, `Authenticated page failed: ${path}`);
      assert(!body.includes('"digest":"') && !body.includes('Er is iets misgegaan'), `Runtime error: ${path}`);
      if (!path.endsWith('/new')) assert(body.includes(marker), `Fixture data missing: ${path}`);
    }
  }
  const navigation = await request('/invoices/1/preview', modes[1], cookie);
  assert.equal(navigation.response.status, 200);
  assert(navigation.response.headers.get('content-type')?.includes('text/x-component'));
  assert(navigation.body.includes(marker), 'Authenticated RSC navigation must render fixture data');
  console.log('PASS: authenticated pages and RSC navigation still render business data');

  const exports = ['/reports/vat/2026/3/export', '/reports/income-tax/2026/export'];
  for (const path of exports) for (const format of ['csv', 'pdf']) {
    const { response, body } = await request(`${path}?format=${format}`, modes[0]);
    assert.equal(response.status, 401);
    assert(!body.includes(marker));
    const authenticated = await request(`${path}?format=${format}`, modes[0], cookie);
    assert.equal(authenticated.response.status, 200);
    assert.equal(authenticated.response.headers.get('cache-control'), 'private, no-store');
  }

  await pool.query('UPDATE auth_session SET "expiresAt"=NOW()-INTERVAL \'1 hour\'');
  for (const path of paths) for (const mode of modes) await assertPrivate(path, mode, cookie);
  const renewed = await login();
  await pool.query('DELETE FROM auth_session');
  for (const path of paths) for (const mode of modes) await assertPrivate(path, mode, renewed);
  for (const path of exports) for (const invalid of [cookie, renewed]) {
    assert.equal((await request(`${path}?format=csv`, modes[0], invalid)).response.status, 401);
  }
  console.log('PASS: expired/revoked sessions cannot read HTML, RSC or exports after an authenticated visit');

  // First-run setup must still work, even if business tables already have data.
  await pool.query('DELETE FROM auth_account');
  await pool.query('DELETE FROM auth_user');
  for (const path of ['/', '/customers', '/invoices/1/preview']) {
    for (const mode of modes) await assertPrivate(path, mode, undefined, '/setup');
  }
  const setup = await request('/setup', modes[0]);
  assert.equal(setup.response.status, 200);
  assert(setup.body.includes('Administratie aanmaken') && !setup.body.includes(marker));
  console.log('PASS: first-run setup remains accessible without exposing existing business data');
} finally {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    const timeout = setTimeout(() => server.kill('SIGKILL'), 5000);
    try { await serverClosed; } finally { clearTimeout(timeout); }
  }
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`);
  await admin.end();
}
