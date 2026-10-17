import { redirect } from 'next/navigation';
export default function IncomeTaxPage(){redirect(`/reports/income-tax/${new Date().getFullYear()}`);}
