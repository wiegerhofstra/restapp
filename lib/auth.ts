import "server-only";

import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { authOptions } from "./auth-options";
import { createAdministrator } from "./auth-setup";
import { getPool, row } from "./db";

export const auth = betterAuth({
  ...authOptions(getPool()),
  plugins: [nextCookies()],
});

export async function hasUsers() {
  return Boolean(await row("SELECT 1 FROM auth_user LIMIT 1"));
}

export async function createFirstUser(name: string, email: string, password: string) {
  await createAdministrator(getPool(), name, email, password);
  await auth.api.signInEmail({
    body: { email: email.trim().toLowerCase(), password },
    headers: await headers(),
  });
}

export async function currentUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

// Layouts and pages render independently, including during RSC navigation.
// Every private page must await this before querying or rendering business data.
// React cache deduplicates checks within a render, never across requests/users.
export const requireUser = cache(async () => {
  const user = await currentUser();
  if (!user) redirect(await hasUsers() ? "/login" : "/setup");
  return user;
});

export async function signOut() {
  await auth.api.signOut({ headers: await headers() });
}
