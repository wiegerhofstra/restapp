import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { rows } from "@/lib/db";
import { TimeForm } from "../time-form";
export default async function NewTimePage(){const projects=(await rows<{id:number;name:string;customer_name:string}>("SELECT p.id,p.name,c.name customer_name FROM projects p JOIN customers c ON c.id=p.customer_id WHERE p.status='active' ORDER BY c.name,p.name"));if(!projects.length)redirect("/projects/new");return <><PageHeader eyebrow="Time tracking" title="New time entry" subtitle="Start now or enter a completed block of work."/><TimeForm projects={projects}/></>}
