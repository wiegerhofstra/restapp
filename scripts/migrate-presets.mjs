import pg from 'pg';
import { migratePresets } from './lib/migrate-presets.mjs';
const client = new pg.Client({connectionString:process.env.DATABASE_URL});
await client.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(713054)');
  await migratePresets(client);
  await client.query('COMMIT');
  console.log('Posting presets ready. Existing presets and ledger entries preserved.');
} catch(error) { await client.query('ROLLBACK'); throw error; }
finally { await client.end(); }
