import pg from 'pg';
import { migrateAuth } from './lib/migrate-auth.mjs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await migrateAuth(pool);
  console.log('Better Auth schema ready; legacy accounts preserved. Existing users must sign in again.');
} finally {
  await pool.end();
}
