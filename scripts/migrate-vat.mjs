import pg from 'pg';
import { migrateVat } from './lib/migrate-vat.mjs';
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(713055)');
  await migrateVat(client);
  await client.query('COMMIT');
  console.log('VAT review and snapshot tables ready. Ledger entries unchanged.');
} catch (error) { await client.query('ROLLBACK'); throw error; }
finally { await client.end(); }
