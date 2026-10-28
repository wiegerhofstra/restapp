"use client";

import { authClient } from "@/lib/auth-client";
import { Scale } from "lucide-react";
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
          ? "Te veel inlogpogingen. Wacht een minuut en probeer het opnieuw."
          : "E-mailadres of wachtwoord is onjuist";
      }
      router.replace("/");
      router.refresh();
      return "";
    } catch {
      return "Inloggen is niet gelukt. Probeer het opnieuw.";
    }
  }, "");

  return <form action={submit} className="auth-form">
    <Link href="/" className="brand"><span className="brand-mark"><Scale size={17} strokeWidth={2.25} /></span>stapp</Link>
    <h1>Inloggen bij Stapp</h1>
    <p>Gebruik het beheerdersaccount dat bij de inrichting is aangemaakt.</p>
    {error && <div className="error-message" role="alert">{error}</div>}
    <div className="grid">
      <div className="field"><label htmlFor="email">E-mailadres</label><input id="email" name="email" type="email" autoComplete="email" required autoFocus /></div>
      <div className="field"><label htmlFor="password">Wachtwoord</label><input id="password" name="password" type="password" autoComplete="current-password" required /></div>
      <button className="button primary auth-submit" disabled={pending}>{pending ? "Inloggen…" : "Inloggen"}</button>
    </div>
  </form>;
}
