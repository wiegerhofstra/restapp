import { redirect } from 'next/navigation';
export default function VatIndex() {
  const now=new Date();const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit'}).format(now);
  const [year,month]=date.split('-').map(Number);const quarter=Math.ceil(month/3);
  redirect(`/reports/vat/${quarter===1?year-1:year}/${quarter===1?4:quarter-1}`);
}
