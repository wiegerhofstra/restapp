import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import Link from "next/link";
import { row, rows } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/ui";

type Transaction={id:number;transaction_date:string;description:string;reference:string;project_name:string|null;customer_name:string|null;debit:number;credit:number};

export default async function TransactionsPage({searchParams}:{searchParams:Promise<{q?:string;page?:string}>}){
  const query=await searchParams;
  const search=(query.q||"").trim();
  const page=Math.max(1,Number(query.page)||1);
  const perPage=100;
  const filter=search?`WHERE t.description ILIKE ? OR t.reference ILIKE ? OR t.transaction_date ILIKE ? OR p.name ILIKE ? OR c.name ILIKE ?`:"";
  const searchValues=search?Array(5).fill(`%${search}%`):[];
  const total=(await row<{count:number}>(`SELECT COUNT(*) count FROM transactions t LEFT JOIN projects p ON p.id=t.project_id LEFT JOIN customers c ON c.id=p.customer_id ${filter}`,...searchValues))!.count;
  const pages=Math.max(1,Math.ceil(total/perPage));
  const currentPage=Math.min(page,pages);
  const transactions=(await rows<Transaction>(`SELECT t.id,t.transaction_date,t.description,t.reference,p.name project_name,c.name customer_name,COALESCE(SUM(l.debit_cents),0) debit,COALESCE(SUM(l.credit_cents),0) credit FROM transactions t LEFT JOIN projects p ON p.id=t.project_id LEFT JOIN customers c ON c.id=p.customer_id LEFT JOIN transaction_lines l ON l.transaction_id=t.id ${filter} GROUP BY t.id,p.id,c.id ORDER BY t.transaction_date DESC,t.id DESC LIMIT ? OFFSET ?`,...searchValues,perPage,(currentPage-1)*perPage));
  const pageHref=(next:number)=>`/transactions?${new URLSearchParams({...(search?{q:search}:{}),page:String(next)})}`;
  return <><PageHeader eyebrow="Ledger" title="Transactions" subtitle={`${total.toLocaleString("en-NL")} financial events, with balance visible at a glance.`}><Link href="/bank" className="button">Import bank statement</Link><Link href="/transactions/new" className="button primary"><Plus size={16}/>New transaction</Link></PageHeader><section className="card flush"><div className="list-toolbar"><form className="search-form"><Search size={17}/><input name="q" defaultValue={search} placeholder="Search description, reference, project or customer…" aria-label="Search transactions"/><button className="button small">Search</button></form>{search&&<Link href="/transactions" className="button small">Clear</Link>}</div><div className="card-body">{transactions.length?<><div className="table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Description</th><th>Project</th><th>Reference</th><th>Status</th><th className="numeric">Amount</th></tr></thead><tbody>{transactions.map(t=><tr key={t.id}><td>{formatDate(t.transaction_date)}</td><td><Link className="row-link" href={`/transactions/${t.id}`}>{t.description}</Link></td><td>{t.project_name||"—"}<div className="secondary">{t.customer_name}</div></td><td>{t.reference||"—"}</td><td><span className={`badge ${t.debit===t.credit&&t.debit>0?"paid":"draft"}`}>{t.debit===t.credit&&t.debit>0?"Balanced":"Needs review"}</span></td><td className="numeric">{formatMoney(Math.max(t.debit,t.credit))}</td></tr>)}</tbody></table></div><div className="pagination"><span>Page {currentPage} of {pages}</span><div>{currentPage>1?<Link className="button small icon-only" aria-label="Previous page" href={pageHref(currentPage-1)}><ChevronLeft size={15}/></Link>:<span/>}{currentPage<pages&&<Link className="button small icon-only" aria-label="Next page" href={pageHref(currentPage+1)}><ChevronRight size={15}/></Link>}</div></div></>:<EmptyState title={search?"No matching transactions":"No transactions yet"} copy={search?"Try another description, reference, project or customer.":"Create a transaction, then add balanced debit and credit lines."} href={search?"/transactions":"/transactions/new"} action={search?"Clear search":"Record a transaction"}/>}</div></section></>
}
