import { currentUser } from '@/lib/auth';
import { getIncomeTaxWorkspace } from '@/lib/income-tax/service';
import { validYear } from '@/lib/income-tax/calculation';
import { incomeTaxCsv, incomeTaxPdf } from '@/lib/income-tax/export';
export async function GET(request:Request,{params}:{params:Promise<{year:string}>}) {
  if(!await currentUser())return new Response('Niet aangemeld',{status:401});
  const year=Number((await params).year);try{validYear(year);}catch{return new Response('Ongeldig boekjaar',{status:400});}
  const search=new URL(request.url).searchParams,format=search.get('format');
  if(format!=='csv'&&format!=='pdf')return new Response('Kies CSV of PDF',{status:400});
  const {current,snapshots}=await getIncomeTaxWorkspace(year);
  const snapshot=search.has('snapshot')?snapshots.find(s=>s.id===Number(search.get('snapshot'))):undefined;
  if(search.has('snapshot')&&!snapshot)return new Response('Versie niet gevonden',{status:404});
  const data=snapshot?.payload??current;
  const label=snapshot?`${snapshot.status==='reviewed'?'GECONTROLEERD':'CONCEPT'} versie #${snapshot.id} - ${new Date(snapshot.created_at).toISOString()}`:'ACTUEEL CONCEPT';
  const content=format==='pdf'?new Uint8Array(await incomeTaxPdf(data,label)):incomeTaxCsv(data,label);
  return new Response(content,{headers:{'Content-Type':format==='pdf'?'application/pdf':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="inkomstenbelasting-${year}-${snapshot?`versie-${snapshot.id}`:'concept'}.${format}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
