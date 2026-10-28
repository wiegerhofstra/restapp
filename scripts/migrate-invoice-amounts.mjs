import pg from 'pg';
import { migrateInvoiceAmounts } from './lib/migrate-invoice-amounts.mjs';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN');
  await migrateInvoiceAmounts(client);
  await client.query('COMMIT');
  console.log('Invoice amount views ready. Invoice records and saved tax snapshots are unchanged.');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
