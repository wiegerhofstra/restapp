import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { hash } from 'bcryptjs';
import { betterAuth } from 'better-auth';
import { hashPassword } from 'better-auth/crypto';
import { authOptions } from '../../lib/auth-options.ts';
import { createAdministrator } from '../../lib/auth-setup.ts';
import { migrateAuth } from '../lib/migrate-auth.mjs';

// All data, including legacy migration fixtures, lives in a disposable schema.
const schema = 'auth_test_' + randomUUID().replaceAll('-', '');
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
const password = '  correct horse battery staple  ';
const email = 'auth-check@example.test';
const baseURL = process.env.BETTER_AUTH_URL;
const cookieFrom = response => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
try {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  assert.equal((await pool.query('SELECT current_schema() AS name')).rows[0].name, schema);
  await pool.query('CREATE TABLE users (id bigint PRIMARY KEY, name text, email text, password_hash text, created_at text)');
  const legacyHash = await hash(password, 12);
  await pool.query('INSERT INTO users VALUES (1, $1, $2, $3, $4)', ['Auth Check', email.toUpperCase(), legacyHash, new Date().toISOString()]);
  await migrateAuth(pool);
  await migrateAuth(pool);
  assert.equal((await pool.query('SELECT count(*) FROM auth_user')).rows[0].count, '1');
  assert.equal((await pool.query('SELECT password FROM auth_account')).rows[0].password, legacyHash);
  console.log('PASS: transactional legacy migration, bcrypt preservation, repeat migration');

  const auth = betterAuth(authOptions(pool));
  const request = (path, body, cookie, origin = baseURL) => auth.handler(new Request(baseURL + '/api/auth' + path, {
    method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'Content-Type': 'application/json', Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }));
  let response = await request('/sign-up/email', { name: 'Intruder', email: 'intruder@example.test', password });
  assert.equal(response.status, 400);
  response = await request('/sign-in/email', { email, password: 'incorrect-password' });
  assert.equal(response.status, 401);
  response = await request('/sign-in/email', { email, password }, undefined, 'https://untrusted.example');
  assert.equal(response.status, 403);
  // Reset only this isolated schema's rate limits between scenarios.
  await pool.query('DELETE FROM auth_rate_limit');
  response = await request('/sign-in/email', { email: email.toUpperCase(), password });
  assert.equal(response.status, 200, await response.clone().text());
  assert.match(response.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(response.headers.get('set-cookie'), /SameSite=Lax/i);
  const cookie = cookieFrom(response);
  assert.equal((await (await request('/get-session', undefined, cookie)).json()).user.id, '1');
  assert.equal(await (await request('/get-session', undefined, cookie + 'tampered')).json(), null);
  assert.equal(await (await request('/get-session', undefined, 'stapp_session=legacy-token')).json(), null);
  response = await request('/sign-out', {}, cookie);
  assert.equal(response.status, 200);
  assert.equal(await (await request('/get-session', undefined, cookie)).json(), null);
  console.log('PASS: closed registration, invalid credentials, origin protection, bcrypt login, signed cookies, logout/revocation');

  const newHash = await hashPassword(password);
  await pool.query('UPDATE auth_account SET password = $1', [newHash]);
  await migrateAuth(pool);
  assert.equal((await pool.query('SELECT password FROM auth_account')).rows[0].password, newHash);
  response = await request('/sign-in/email', { email, password });
  assert.equal(response.status, 200);
  const expiredCookie = cookieFrom(response);
  await pool.query('UPDATE auth_session SET "expiresAt" = NOW() - INTERVAL \'1 hour\'');
  assert.equal(await (await request('/get-session', undefined, expiredCookie)).json(), null);
  console.log('PASS: scrypt login, expiry, migration never resets changed passwords');

  await pool.query('DELETE FROM auth_rate_limit');
  const attempts = await Promise.all(Array.from({ length: 5 }, () => request('/sign-in/email', { email, password: 'wrong-password' })));
  assert.equal(attempts.filter(r => r.status === 429).length, 2);
  assert(attempts.find(r => r.status === 429).headers.has('x-retry-after'));
  console.log('PASS: concurrent login throttling backed by PostgreSQL');

  await assert.rejects(createAdministrator(pool, 'Second', 'second@example.test', password), /already complete/);
  await pool.query('DELETE FROM auth_user');
  const setups = await Promise.allSettled([
    createAdministrator(pool, 'First', email, password),
    createAdministrator(pool, 'Second', 'second@example.test', password),
  ]);
  assert.equal(setups.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(setups.filter(r => r.status === 'rejected').length, 1);
  assert.equal((await pool.query('SELECT count(*) FROM auth_user')).rows[0].count, '1');
  assert.equal((await pool.query('SELECT count(*) FROM auth_account')).rows[0].count, '1');
  const created = (await pool.query('SELECT email FROM auth_user')).rows[0];
  await pool.query('DELETE FROM auth_rate_limit');
  assert.equal((await request('/sign-in/email', { email: created.email, password })).status, 200);
  console.log('PASS: setup closes after first account; concurrent setup creates exactly one working administrator');
} finally {
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
}
