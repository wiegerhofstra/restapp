import pg from 'pg';
import { migrateBank } from './lib/migrate-bank.mjs';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(713053)');
  await migrateBank(client);
  await client.query('COMMIT');
  console.log('Bank import schema ready. Existing accounting entries were not changed.');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally { await client.end(); }
