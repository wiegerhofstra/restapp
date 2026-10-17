import { getMigrations } from 'better-auth/db/migration';
import { authOptions } from '../../lib/auth-options.ts';

export async function migrateAuth(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('stapp-better-auth-migration'))");
    const migration = await getMigrations(authOptions(pool));
    const sql = await migration.compileMigrations();
    if (sql.trim()) await client.query(sql);
    await client.query(`CREATE TABLE IF NOT EXISTS auth_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT NOW()
    )`);
    const applied = await client.query("SELECT 1 FROM auth_migrations WHERE name = 'legacy-users-v1'");
    if (!applied.rowCount) {
      const legacy = await client.query("SELECT to_regclass('users') AS table_name");
      if (legacy.rows[0].table_name) {
        // Copy, never overwrite: a conflicting account aborts the whole transaction.
        await client.query(`INSERT INTO auth_user (id, name, email, "emailVerified", "createdAt", "updatedAt")
          SELECT id::text, name, lower(email), false, created_at::timestamptz, NOW() FROM users`);
        await client.query(`INSERT INTO auth_account (id, "userId", "accountId", "providerId", password, "createdAt", "updatedAt")
          SELECT 'legacy-' || id, id::text, id::text, 'credential', password_hash, created_at::timestamptz, NOW() FROM users`);
        const mismatch = await client.query(`SELECT 1 FROM users u
          LEFT JOIN auth_user a ON a.id = u.id::text
          LEFT JOIN auth_account c ON c."userId" = a.id AND c."providerId" = 'credential'
          WHERE a.id IS NULL OR a.email <> lower(u.email) OR c.password IS DISTINCT FROM u.password_hash LIMIT 1`);
        if (mismatch.rowCount) throw new Error('Legacy account verification failed');
      }
      await client.query("INSERT INTO auth_migrations (name) VALUES ('legacy-users-v1')");
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
