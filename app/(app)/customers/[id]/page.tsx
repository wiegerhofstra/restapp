import { requireUser } from "@/lib/auth";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Archive } from "lucide-react";
import { archiveCustomer } from "@/app/actions";
import { row, rows } from "@/lib/db";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { CustomerForm, CustomerFormValue } from "../customer-form";

type Project={id:number;name:string;status:string;transaction_count:number};
export default async function CustomerPage({params}:{params:Promise<{id:string}>}){
  await requireUser();
  const id=Number((await params).id);const customer=(await row<CustomerFormValue>("SELECT * FROM customers WHERE id=?",id));if(!customer)notFound();const projects=(await rows<Project>(`SELECT p.id,p.name,p.status,COUNT(t.id) transaction_count FROM projects p LEFT JOIN transactions t ON t.project_id=p.id WHERE p.customer_id=? GROUP BY p.id ORDER BY p.name`,id));return <><PageHeader eyebrow="Klantgegevens" title={customer.name} subtitle={`${customer.reference} · ${[customer.city,customer.country].filter(Boolean).join(", ")||"Nog geen adres"}`}><form action={archiveCustomer.bind(null,id)}><button className="button danger"><Archive size={15}/>Archiveren</button></form></PageHeader><div className="grid two"><CustomerForm customer={customer}/><section className="card flush"><div className="card-header"><div><h2 className="card-title">Projecten</h2><p className="card-description">Projecten voor deze klant</p></div><Link href={`/projects/new?customer=${id}`} className="button small">Project toevoegen</Link></div><div className="card-body">{projects.length?<table className="data-table"><thead><tr><th>Project</th><th>Status</th><th>Boekingen</th></tr></thead><tbody>{projects.map(p=><tr key={p.id}><td><Link className="row-link" href={`/projects/${p.id}`}>{p.name}</Link></td><td><Badge value={p.status}/></td><td>{p.transaction_count}</td></tr>)}</tbody></table>:<EmptyState title="Geen projecten" copy="Maak een project om boekingen, facturen en uren te koppelen." href={`/projects/new?customer=${id}`} action="Project aanmaken"/>}</div></section></div></>}
