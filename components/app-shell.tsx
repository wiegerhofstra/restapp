"use client";

import { BarChart3, BriefcaseBusiness, Building2, ChevronRight, CircleDollarSign, Clock3, FileText, LayoutDashboard, LogOut, Menu, Plus, ReceiptText, Settings, WalletCards, Landmark } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { logoutAction } from "@/app/auth-actions";

const navigation = [
  { href: "/", label: "Overzicht", icon: LayoutDashboard },
  { href: "/transactions", label: "Boekingen", icon: ReceiptText },
  { href: "/bank", label: "Bankafschriften", icon: Landmark },
  { href: "/accounts", label: "Grootboekrekeningen", icon: WalletCards },
  { href: "/invoices", label: "Facturen", icon: FileText },
  { href: "/time", label: "Urenregistratie", icon: Clock3 },
  { href: "/projects", label: "Projecten", icon: BriefcaseBusiness },
  { href: "/customers", label: "Klanten", icon: Building2 },
  { href: "/suppliers", label: "Leveranciers", icon: Building2 },
  { href: "/reports", label: "Rapporten", icon: BarChart3 },
  { href: "/settings", label: "Instellingen", icon: Settings },
];

export function AppShell({ user, children }: { user: { name: string; email: string }; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const section = navigation.find((item) => item.href === "/" ? pathname === "/" : pathname.startsWith(item.href));
  return <div className="app-shell">
    {open && <button aria-label="Navigatie sluiten" onClick={() => setOpen(false)} className="nav-scrim" />}
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="brand"><span className="brand-mark"><CircleDollarSign size={21} /></span>stapp</div>
      <div className="nav-label">Administratie</div>
      <nav className="nav-list" aria-label="Hoofdnavigatie">{navigation.slice(0, 6).map((item) => <NavItem key={item.href} item={item} pathname={pathname} close={() => setOpen(false)} />)}</nav>
      <div className="nav-label">Onderneming</div>
      <nav className="nav-list">{navigation.slice(6).map((item) => <NavItem key={item.href} item={item} pathname={pathname} close={() => setOpen(false)} />)}</nav>
      <div className="sidebar-bottom"><div className="profile"><span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span><div className="profile-copy"><div className="profile-name">{user.name}</div><div className="profile-email">{user.email}</div></div><form action={logoutAction}><button className="icon-button" aria-label="Uitloggen"><LogOut size={17} /></button></form></div></div>
    </aside>
    <div className="main-wrap">
      <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setOpen(true)} aria-label="Navigatie openen"><Menu size={20} /></button><span className="topbar-title">Administratie&nbsp; / &nbsp;<strong>{section?.label ?? "Stapp"}</strong></span></div><div className="topbar-actions"><Link href="/transactions/new" className="button small"><Plus size={15} /> Boeking</Link><Link href="/invoices/new" className="button primary small"><Plus size={15} /> Factuur</Link></div></header>
      <main className="main-content">{children}</main>
    </div>
  </div>;
}

function NavItem({ item, pathname, close }: { item: (typeof navigation)[number]; pathname: string; close: () => void }) {
  const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
  const Icon = item.icon;
  return <Link href={item.href} className={`nav-link ${active ? "active" : ""}`} onClick={close}><Icon size={18} /><span>{item.label}</span>{active && <ChevronRight size={14} className="nav-chevron" />}</Link>;
}
