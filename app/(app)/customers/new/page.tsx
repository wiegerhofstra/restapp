import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { CustomerForm } from "../customer-form";
export default async function NewCustomerPage(){
  await requireUser();
  return <><PageHeader eyebrow="Klanten" title="Nieuwe klant" subtitle="Leg de klantgegevens vast voor projecten en facturatie."/><CustomerForm/></>}
