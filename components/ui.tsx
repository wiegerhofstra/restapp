import { labelNl } from '@/lib/dutch';
import { Inbox } from "lucide-react";
import Link from "next/link";

export function PageHeader({ context, title, subtitle, children }: { context?: string; title: string; subtitle?: string; children?: React.ReactNode }) {
  return <div className="page-header"><div>{context && <div className="page-context">{context}</div>}<h1 className="page-title">{title}</h1>{subtitle && <p className="page-subtitle">{subtitle}</p>}</div>{children && <div className="header-actions">{children}</div>}</div>;
}

export function EmptyState({ title, copy, href, action }: { title: string; copy: string; href?: string; action?: string }) {
  return <div className="empty"><div><div className="empty-icon"><Inbox size={20} /></div><h3>{title}</h3><p>{copy}</p>{href && <Link href={href} className="button primary">{action ?? "Aan de slag"}</Link>}</div></div>;
}

export function Badge({ value }: { value: string }) { return <span className={`badge ${value}`}>{labelNl(value)}</span>; }

export function Field({ label, name, children, full, hint }: { label: string; name: string; children: React.ReactNode; full?: boolean; hint?: string }) {
  return <div className={`field ${full ? "full" : ""}`}><label htmlFor={name}>{label}</label>{children}{hint && <span className="field-hint">{hint}</span>}</div>;
}
