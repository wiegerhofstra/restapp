import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import type { PoolClient } from "pg";

// PostgreSQL returns aggregates as strings. Keep the application's numeric API,
// but refuse integer values that JavaScript cannot represent without data loss.
pg.types.setTypeParser(20, (value: string) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error("Database integer exceeds JavaScript's safe range");
  return number;
});
pg.types.setTypeParser(1700, Number);

const globalForDatabase = globalThis as unknown as { restappPool?: pg.Pool };
export function getPool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  return globalForDatabase.restappPool ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
}
const transactionClient = new AsyncLocalStorage<PoolClient>();

// Retain the existing parameterized query interface, including literal strings.
function parameters(sql: string) {
  let index = 0;
  return sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?/g, (token) =>
    token === "?" ? `$${++index}` : token,
  );
}

async function query(sql: string, params: unknown[]) {
  return (transactionClient.getStore() ?? getPool()).query(parameters(sql), params);
}

export const db = {
  prepare(sql: string) {
    return {
      async all(...params: unknown[]) { return (await query(sql, params)).rows; },
      async get(...params: unknown[]) { return (await query(sql, params)).rows[0]; },
      async run(...params: unknown[]) {
        const insert = /^\s*INSERT\s+INTO\s+/i.test(sql);
        const result = await query(insert ? `${sql} RETURNING id` : sql, params);
        return { changes: result.rowCount ?? 0, lastInsertRowid: result.rows[0]?.id as number | undefined };
      },
    };
  },
  transaction<T>(work: () => Promise<T>) {
    return async () => {
      if (transactionClient.getStore()) throw new Error("Nested transactions are not supported");
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        const result = await transactionClient.run(client, work);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    };
  },
};

export async function rows<T>(sql: string, ...params: unknown[]) {
  return (await query(sql, params)).rows as T[];
}

export async function row<T>(sql: string, ...params: unknown[]) {
  return (await query(sql, params)).rows[0] as T | undefined;
}

export function moneyFromInput(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "0").trim().replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

export function required(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`${key.replaceAll("_", " ")} is required`);
  return value;
}

export function optional(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}
