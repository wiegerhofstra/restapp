import { hashPassword } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

// Public sign-up stays disabled. Only this one-time bootstrap can create users.
export async function createAdministrator(pool: Pool, name: string, email: string, password: string) {
  name = name.trim();
  email = email.trim().toLowerCase();
  if (!name) throw new Error("Your name is required");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address");
  if (password.length < 8 || password.length > 128) throw new Error("Password must be between 8 and 128 characters");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize competing setup requests, including across app instances.
    await client.query("LOCK TABLE auth_user IN EXCLUSIVE MODE");
    if ((await client.query("SELECT 1 FROM auth_user LIMIT 1")).rowCount) {
      throw new Error("Setup is already complete");
    }
    const id = randomUUID();
    const passwordHash = await hashPassword(password);
    await client.query(`INSERT INTO auth_user (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, false, NOW(), NOW())`, [id, name, email]);
    await client.query(`INSERT INTO auth_account (id, "userId", "accountId", "providerId", password, "createdAt", "updatedAt")
      VALUES ($1, $2, $2, 'credential', $3, NOW(), NOW())`, [randomUUID(), id, passwordHash]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
