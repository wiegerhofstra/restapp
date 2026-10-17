import { AccountForm } from "../account-form";
import { PageHeader } from "@/components/ui";
import { rows } from "@/lib/db";
export default async function NewAccountPage(){const accounts=(await rows<{id:number;name:string}>("SELECT id,name FROM accounts ORDER BY sort_order"));return <><PageHeader eyebrow="Rekeningschema" title="Nieuwe grootboekrekening" subtitle="Voeg een boekingsrekening of een verzamelrekening toe."/><AccountForm accounts={accounts}/></>}
