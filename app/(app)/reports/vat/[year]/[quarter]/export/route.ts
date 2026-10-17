import { currentUser } from '@/lib/auth';
import { getWorkspace } from '@/lib/vat/service';
import { period } from '@/lib/vat/calculation';
import { vatCsv, vatPdf } from '@/lib/vat/export';

export async function GET(request:Request,{params}:{params:Promise<{year:string;quarter:string}>}) {
  if(!await currentUser()) return new Response('Unauthorized',{status:401});
  const p=await params,year=Number(p.year),quarter=Number(p.quarter);
  try {period(year,quarter);} catch {return new Response('Invalid period',{status:400});}
  const search=new URL(request.url).searchParams,format=search.get('format');
  if(format!=='csv'&&format!=='pdf') return new Response('Choose csv or pdf',{status:400});
  const {current,snapshots}=await getWorkspace(year,quarter);
  const snapshot=search.has('snapshot')?snapshots.find(s=>s.id===Number(search.get('snapshot'))):undefined;
  if(search.has('snapshot')&&!snapshot) return new Response('Snapshot not found',{status:404});
  const data=snapshot?.payload??current;
  const label=snapshot?`${snapshot.status.toUpperCase()} copy #${snapshot.id} - ${new Date(snapshot.created_at).toISOString()}${snapshot.receipt?` - Receipt: ${snapshot.receipt}`:''}`:'LIVE DRAFT - not a submission receipt';
  const content=format==='pdf'?new Uint8Array(await vatPdf(data,label)):vatCsv(data,label);
  return new Response(content,{headers:{'Content-Type':format==='pdf'?'application/pdf':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="omzetbelasting-${year}-Q${quarter}-${snapshot?`copy-${snapshot.id}`:'draft'}.${format}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
