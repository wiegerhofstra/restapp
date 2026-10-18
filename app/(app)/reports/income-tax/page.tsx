import { requireUser } from "@/lib/auth";
import { redirect } from 'next/navigation';
export default async function IncomeTaxPage(){
  await requireUser();
  redirect(`/reports/income-tax/${new Date().getFullYear()}`);}
