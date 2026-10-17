import { AccountForm } from "../account-form";
import { PageHeader } from "@/components/ui";
import { rows } from "@/lib/db";
export default async function NewAccountPage(){const accounts=(await rows<{id:number;name:string}>("SELECT id,name FROM accounts ORDER BY sort_order"));return <><PageHeader eyebrow="Chart of accounts" title="New account" subtitle="Add a posting account or a grouping category."/><AccountForm accounts={accounts}/></>}
