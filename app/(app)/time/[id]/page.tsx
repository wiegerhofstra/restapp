import { requireUser } from "@/lib/auth";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { row, rows } from "@/lib/db";
import { TimeForm, TimeValue } from "../time-form";
export default async function EditTimePage({params}:{params:Promise<{id:string}>}){
  await requireUser();
  const id=Number((await params).id);const entry=(await row<TimeValue>("SELECT * FROM time_entries WHERE id=?",id));if(!entry)notFound();const projects=(await rows<{id:number;name:string;customer_name:string}>("SELECT p.id,p.name,c.name customer_name FROM projects p JOIN customers c ON c.id=p.customer_id ORDER BY c.name,p.name"));return <><PageHeader title={entry.name} subtitle="Pas tijden, declarabiliteit en notities aan."/><TimeForm entry={entry} projects={projects}/></>}
