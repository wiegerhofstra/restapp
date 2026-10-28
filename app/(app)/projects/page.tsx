import { requireUser } from "@/lib/auth";
import { Plus } from "lucide-react";
import Link from "next/link";
import { rows } from "@/lib/db";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
type Project={id:number;name:string;status:string;customer_name:string;transaction_count:number;invoice_count:number};
export default async function ProjectsPage(){
  await requireUser();
  const projects=(await rows<Project>(`SELECT p.id,p.name,p.status,c.name customer_name,COUNT(DISTINCT t.id) transaction_count,COUNT(DISTINCT i.id) invoice_count FROM projects p JOIN customers c ON c.id=p.customer_id LEFT JOIN transactions t ON t.project_id=p.id LEFT JOIN invoices i ON i.project_id=p.id GROUP BY p.id,c.id ORDER BY CASE p.status WHEN 'active' THEN 0 ELSE 1 END,p.name`));return <><PageHeader title="Projecten" subtitle="Koppel klantwerkzaamheden aan uren, boekingen en facturen."><Link href="/projects/new" className="button primary"><Plus size={16}/>Nieuw project</Link></PageHeader><section className="card flush"><div className="card-body">{projects.length?<div className="table-wrap"><table className="data-table"><thead><tr><th>Project</th><th>Klant</th><th>Status</th><th>Boekingen</th><th>Facturen</th></tr></thead><tbody>{projects.map(p=><tr key={p.id}><td><Link className="row-link" href={`/projects/${p.id}`}>{p.name}</Link></td><td>{p.customer_name}</td><td><Badge value={p.status}/></td><td>{p.transaction_count}</td><td>{p.invoice_count}</td></tr>)}</tbody></table></div>:<EmptyState title="Nog geen projecten" copy="Projecten koppelen uw klanten aan financiële mutaties en uren." href="/projects/new" action="Project aanmaken"/>}</div></section></>}
