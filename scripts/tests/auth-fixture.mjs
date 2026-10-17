import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';

// A temporary account for route/browser tests; never changes a real password.
export async function authFixture(pool) {
  const id = randomUUID();
  const email = `auth-test-${id}@example.test`;
  const password = randomUUID();
  await pool.query(`INSERT INTO auth_user (id, name, email, "emailVerified", "createdAt", "updatedAt")
    VALUES ($1, 'Auth Test', $2, false, NOW(), NOW())`, [id, email]);
  try {
    await pool.query(`INSERT INTO auth_account (id, "userId", "accountId", "providerId", password, "createdAt", "updatedAt")
      VALUES ($1, $1, $1, 'credential', $2, NOW(), NOW())`, [id, await hashPassword(password)]);
  } catch (error) {
    await pool.query('DELETE FROM auth_user WHERE id=$1', [id]);
    throw error;
  }
  return { email, password, cleanup: () => pool.query('DELETE FROM auth_user WHERE id=$1', [id]) };
}
