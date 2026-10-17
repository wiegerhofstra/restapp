import { Plus } from "lucide-react";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { rows } from "@/lib/db";
import { formatDate } from "@/lib/format";
type Report={id:number;name:string;start_date:string;end_date:string;total_label:string;row_count:number};
export default async function ReportsPage(){const reports=(await rows<Report>("SELECT r.*,COUNT(rr.id) row_count FROM reports r LEFT JOIN report_rows rr ON rr.report_id=r.id GROUP BY r.id ORDER BY r.start_date DESC"));return <><PageHeader eyebrow="Analysis" title="Reports" subtitle="Build reusable reports from any ledger accounts and date range."><Link href="/reports/new" className="button primary"><Plus size={16}/>New report</Link></PageHeader><section className="card flush"><div className="card-body">{reports.length?<table className="data-table"><thead><tr><th>Report</th><th>Period</th><th>Total label</th><th>Rows</th></tr></thead><tbody>{reports.map(r=><tr key={r.id}><td><Link className="row-link" href={`/reports/${r.id}`}>{r.name}</Link></td><td>{formatDate(r.start_date)} — {formatDate(r.end_date)}</td><td>{r.total_label}</td><td>{r.row_count}</td></tr>)}</tbody></table>:<EmptyState title="No reports yet" copy="Create a reusable report and choose which accounts feed each row." href="/reports/new" action="Build a report"/>}</div></section></>}
