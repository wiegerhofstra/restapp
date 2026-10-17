"use client";

import { authClient } from "@/lib/auth-client";
import { CircleDollarSign } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [error, submit, pending] = useActionState(async (_previous: string, formData: FormData) => {
    try {
      const { error } = await authClient.signIn.email({
        email: String(formData.get("email") ?? "").trim().toLowerCase(),
        password: String(formData.get("password") ?? ""),
      });
      if (error) {
        return error.status === 429
          ? "Too many sign-in attempts. Please wait a minute and try again."
          : "Email or password is incorrect";
      }
      router.replace("/");
      router.refresh();
      return "";
    } catch {
      return "Unable to sign in. Please try again.";
    }
  }, "");

  return <form action={submit} className="auth-form">
    <Link href="/" className="brand"><span className="brand-mark"><CircleDollarSign size={21} /></span>stapp</Link>
    <div className="eyebrow">Welcome back</div><h1>Sign in to Stapp</h1>
    <p>Use the administrator account created during setup.</p>
    {error && <div className="error-message" role="alert">{error}</div>}
    <div className="grid">
      <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" required autoFocus /></div>
      <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required /></div>
      <button className="button primary auth-submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </div>
  </form>;
}
