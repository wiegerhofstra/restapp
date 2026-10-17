export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="auth-page"><div className="auth-form-wrap">{children}</div><div className="auth-visual"><h2>Uw onderneming,<br />helder in balans.</h2><p>Facturen, uren, klanten en boekhouding in één overzichtelijke administratie.</p></div></div>;
}
