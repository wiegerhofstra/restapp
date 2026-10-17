import { hashPassword } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

// Public sign-up stays disabled. Only this one-time bootstrap can create users.
export async function createAdministrator(pool: Pool, name: string, email: string, password: string) {
  name = name.trim();
  email = email.trim().toLowerCase();
  if (!name) throw new Error("Vul uw naam in");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Vul een geldig e-mailadres in");
  if (password.length < 8 || password.length > 128) throw new Error("Het wachtwoord moet 8 tot 128 tekens bevatten");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize competing setup requests, including across app instances.
    await client.query("LOCK TABLE auth_user IN EXCLUSIVE MODE");
    if ((await client.query("SELECT 1 FROM auth_user LIMIT 1")).rowCount) {
      throw new Error("De inrichting is al voltooid");
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
