import { setupAction } from "@/app/auth-actions";
import { CircleDollarSign } from "lucide-react";
import { hasUsers } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if ((await hasUsers())) redirect("/login");
  const { error } = await searchParams;
  return <form action={setupAction} className="auth-form"><div className="brand"><span className="brand-mark"><CircleDollarSign size={21} /></span>stapp</div><div className="eyebrow">First-run setup</div><h1>Create your workspace</h1><p>Create the administrator account for this workspace.</p>{error && <div className="error-message">{error}</div>}<div className="grid"><div className="field"><label htmlFor="name">Your name</label><input id="name" name="name" autoComplete="name" required autoFocus /></div><div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" required /></div><div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" minLength={8} maxLength={128} autoComplete="new-password" required /><span className="field-hint">At least 8 characters.</span></div><button className="button primary auth-submit">Create workspace</button></div></form>;
}
