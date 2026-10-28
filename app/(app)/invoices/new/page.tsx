import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { InvoiceForm } from "../invoice-form";
import { PageHeader } from "@/components/ui";
import { row, rows } from "@/lib/db";
export default async function NewInvoicePage(){
  await requireUser();
  const projects=(await rows<{id:number;name:string;customer_name:string;reference:string}>("SELECT p.id,p.name,c.name customer_name,c.reference FROM projects p JOIN customers c ON c.id=p.customer_id WHERE p.status!='archived' ORDER BY c.name,p.name"));if(!projects.length)redirect("/projects/new");const next=(await row<{n:number}>("SELECT COALESCE(MAX(invoice_number),0)+1 n FROM invoices"))!.n;return <><PageHeader title="Nieuwe factuur" subtitle="Vul eerst de factuurgegevens in en voeg daarna producten of diensten toe."/><InvoiceForm projects={projects} nextNumber={next}/></>}
