import type { BetterAuthOptions } from "better-auth";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { compare } from "bcryptjs";
import type { Pool } from "pg";

// Shared with migrations and integration checks; no Next.js dependencies.
export function authOptions(database: Pool) {
  if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  }
  if (!process.env.BETTER_AUTH_URL) throw new Error("BETTER_AUTH_URL is required");
  return {
    appName: "Stapp",
    database,
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      password: {
        hash: hashPassword,
        async verify({ hash, password }: { hash: string; password: string }) {
          // Keep passwords imported from Rails and the previous login system.
          if (/^\$2[aby]\$/.test(hash)) return compare(password, hash.replace(/^\$2y\$/, "$2b$"));
          return verifyPassword({ hash, password });
        },
      },
    },
    user: { modelName: "auth_user" },
    session: { modelName: "auth_session", expiresIn: 60 * 60 * 24 * 30 },
    account: { modelName: "auth_account" },
    verification: { modelName: "auth_verification" },
    rateLimit: { enabled: true, storage: "database", modelName: "auth_rate_limit" },
  } satisfies BetterAuthOptions;
}
