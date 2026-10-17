import { ArrowRight, Building2, Clock3, FilePlus2, FileText, Plus, ReceiptText, Scale, WalletCards } from "lucide-react";
import Link from "next/link";
import { row, rows } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/ui";

type RecentTransaction = { id:number; transaction_date:string; description:string; project_name:string|null; customer_name:string|null; amount:number };

export default async function DashboardPage() {
  const currency = (await row<{ value:string }>("SELECT value FROM settings WHERE key='currency'"))?.value || "EUR";
  const outstanding = (await row<{ total:number; count:number }>(`SELECT COALESCE(SUM((l.quantity_milli * l.unit_price_cents / 1000) * (10000 + l.tax_rate_basis_points) / 10000),0) total,
    COUNT(DISTINCT i.id) count FROM invoices i LEFT JOIN invoice_lines l ON l.invoice_id=i.id WHERE i.status IN ('sent','overdue')`))!;
  const customerCount = (await row<{ count:number }>("SELECT COUNT(*) count FROM customers WHERE archived_at IS NULL"))!.count;
  const accountCount = (await row<{ count:number }>("SELECT COUNT(*) count FROM accounts"))!.count;
  const tracked = (await row<{ minutes:number }>(`SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at::timestamptz,CURRENT_TIMESTAMP)-started_at::timestamptz))/60),0) minutes
    FROM time_entries WHERE started_at::timestamptz >= date_trunc('month',CURRENT_TIMESTAMP)`))!.minutes;
  const ledger = (await row<{ debit:number; credit:number }>("SELECT COALESCE(SUM(debit_cents),0) debit, COALESCE(SUM(credit_cents),0) credit FROM transaction_lines"))!;
  const recent = (await rows<RecentTransaction>(`SELECT t.id,t.transaction_date,t.description,p.name project_name,c.name customer_name,
    COALESCE((SELECT MAX(GREATEST(debit_cents,credit_cents)) FROM transaction_lines WHERE transaction_id=t.id),0) amount
    FROM transactions t LEFT JOIN projects p ON p.id=t.project_id LEFT JOIN customers c ON c.id=p.customer_id
    ORDER BY t.transaction_date DESC,t.id DESC LIMIT 7`));
  const isNew = customerCount === 0 && accountCount === 0;
  return <>
    <PageHeader eyebrow="Good overview" title="Your business at a glance" subtitle="A focused view of what needs attention and what moved recently."><Link href="/transactions/new" className="button"><Plus size={16}/>New transaction</Link><Link href="/invoices/new" className="button primary"><FilePlus2 size={16}/>Create invoice</Link></PageHeader>
    <div className="grid four">
      <div className="card metric"><div className="metric-top"><span>Outstanding</span><span className="metric-icon"><FileText size={18}/></span></div><div><div className="metric-value">{formatMoney(outstanding.total,currency)}</div><div className="metric-note">{outstanding.count} open {outstanding.count === 1 ? "invoice" : "invoices"}</div></div></div>
      <div className="card metric"><div className="metric-top"><span>This month</span><span className="metric-icon"><Clock3 size={18}/></span></div><div><div className="metric-value">{Math.round(tracked/60*10)/10}h</div><div className="metric-note">Time tracked across projects</div></div></div>
      <div className="card metric"><div className="metric-top"><span>Customers</span><span className="metric-icon"><Building2 size={18}/></span></div><div><div className="metric-value">{customerCount}</div><div className="metric-note">Active relationships</div></div></div>
      <div className="card metric"><div className="metric-top"><span>Ledger difference</span><span className="metric-icon"><Scale size={18}/></span></div><div><div className="metric-value">{formatMoney(ledger.debit-ledger.credit,currency)}</div><div className="metric-note">Debits minus credits</div></div></div>
    </div>
    <div className="dashboard-grid" style={{marginTop:18}}>
      <section className="card flush"><div className="card-header"><div><h2 className="card-title">Recent transactions</h2><p className="card-description">Latest activity across every project</p></div><Link className="button small" href="/transactions">View all<ArrowRight size={14}/></Link></div><div className="card-body">{recent.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Description</th><th>Project</th><th className="numeric">Amount</th></tr></thead><tbody>{recent.map((item)=><tr key={item.id}><td className="mono">{formatDate(item.transaction_date)}</td><td><Link className="row-link" href={`/transactions/${item.id}`}>{item.description}</Link></td><td>{item.project_name ? <><span>{item.project_name}</span><div className="secondary">{item.customer_name}</div></> : "—"}</td><td className="numeric">{formatMoney(item.amount,currency)}</td></tr>)}</tbody></table></div> : <EmptyState title="No transactions yet" copy="Your latest transactions will appear here." href="/transactions/new" action="Add a transaction"/>}</div></section>
      <aside className="grid">
        {isNew && <section className="card"><div className="card-header"><div><h2 className="card-title">Set up your workspace</h2><p className="card-description">Two steps before you can start</p></div></div><div className="card-body quick-actions"><Link href="/customers/new" className="quick-action"><span className="quick-action-icon"><Building2 size={17}/></span><div><strong>Add a customer</strong><span>Contact and billing details</span></div></Link><Link href="/accounts/new" className="quick-action"><span className="quick-action-icon"><WalletCards size={17}/></span><div><strong>Build your accounts</strong><span>Create your chart of accounts</span></div></Link></div></section>}
        <section className="card"><div className="card-header"><div><h2 className="card-title">Quick actions</h2><p className="card-description">Keep the work moving</p></div></div><div className="card-body quick-actions"><Link href="/transactions/new" className="quick-action"><span className="quick-action-icon"><ReceiptText size={17}/></span><div><strong>Record a transaction</strong><span>Add balanced ledger lines</span></div></Link><Link href="/time/new" className="quick-action"><span className="quick-action-icon"><Clock3 size={17}/></span><div><strong>Start tracking time</strong><span>Log work against a project</span></div></Link></div></section>
      </aside>
    </div>
  </>;
}
