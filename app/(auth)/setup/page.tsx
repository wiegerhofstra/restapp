import { setupAction } from "@/app/auth-actions";
import { CircleDollarSign } from "lucide-react";
import { hasUsers } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if ((await hasUsers())) redirect("/login");
  const { error } = await searchParams;
  return <form action={setupAction} className="auth-form"><div className="brand"><span className="brand-mark"><CircleDollarSign size={21} /></span>stapp</div><div className="eyebrow">Eerste inrichting</div><h1>Administratie aanmaken</h1><p>Maak het beheerdersaccount voor deze administratie aan.</p>{error && <div className="error-message">{error}</div>}<div className="grid"><div className="field"><label htmlFor="name">Uw naam</label><input id="name" name="name" autoComplete="name" required autoFocus /></div><div className="field"><label htmlFor="email">E-mailadres</label><input id="email" name="email" type="email" autoComplete="email" required /></div><div className="field"><label htmlFor="password">Wachtwoord</label><input id="password" name="password" type="password" minLength={8} maxLength={128} autoComplete="new-password" required /><span className="field-hint">Minimaal 8 tekens.</span></div><button className="button primary auth-submit">Administratie aanmaken</button></div></form>;
}
