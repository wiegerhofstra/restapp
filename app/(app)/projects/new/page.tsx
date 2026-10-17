import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { rows } from "@/lib/db";
import { ProjectForm } from "../project-form";
export default async function NewProjectPage({searchParams}:{searchParams:Promise<{customer?:string}>}){const customers=(await rows<{id:number;name:string}>("SELECT id,name FROM customers WHERE archived_at IS NULL ORDER BY name"));if(!customers.length)redirect("/customers/new");const query=await searchParams;return <><PageHeader eyebrow="Projects" title="New project" subtitle="Create a home for related work, time and finances."/><ProjectForm customers={customers} defaultCustomer={Number(query.customer)||undefined}/></>}
