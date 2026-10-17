export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="auth-page"><div className="auth-form-wrap">{children}</div><div className="auth-visual"><h2>Your business,<br />beautifully balanced.</h2><p>Invoices, time, customers and bookkeeping in one focused workspace—rebuilt for the way you work now.</p></div></div>;
}
