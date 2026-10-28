import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ReportForm } from "../report-form";
export default async function NewReportPage(){
  await requireUser();
  return <><PageHeader title="Nieuw rapport" subtitle="Maak een herbruikbaar financieel overzicht voor een gekozen periode."/><ReportForm/></>}
