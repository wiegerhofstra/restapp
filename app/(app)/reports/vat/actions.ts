'use server';
import { currentUser } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { saveReview, saveSnapshot } from '@/lib/vat/service';
import { period } from '@/lib/vat/calculation';

export type ActionState={error?:string};
export async function reviewAction(_:ActionState,data:FormData):Promise<ActionState> {
  const user=await currentUser();if(!user) redirect('/login');
  const year=Number(data.get('year')),quarter=Number(data.get('quarter'));
  try {
    period(year,quarter);
    if(data.get('confirmed')!=='on') throw new Error("Bevestig de btw-datum, fiscale behandeling en het bewijsstuk.");
    await saveReview(String(data.get('kind')),Number(data.get('id')),String(data.get('hash')),Number(data.get('reviewId')),
      JSON.parse(String(data.get('lines'))),String(data.get('note')??''),user.id);
  } catch(error) {return {error:error instanceof Error?error.message:"De controle kon niet worden opgeslagen."};}
  revalidatePath('/reports','layout');
  redirect(`/reports/vat/${year}/${quarter}?saved=1#evidence`);
}
export async function snapshotAction(_:ActionState,data:FormData):Promise<ActionState> {
  const user=await currentUser();if(!user) redirect('/login');
  const year=Number(data.get('year')),quarter=Number(data.get('quarter'));
  let id:number|undefined;
  try {
    if(data.get('complete')!=='on') throw new Error("Bevestig de volledigheid, de controle op dubbel getelde facturen en betalingen, buitenlandse prestaties en eventuele correcties.");
    const status=data.get('status');if(status!=='reviewed'&&status!=='submitted') throw new Error("Ongeldige status.");
    id=await saveSnapshot(year,quarter,String(data.get('fingerprint')),status,String(data.get('receipt')??''),user.id);
  } catch(error) {return {error:error instanceof Error?error.message:"De aangifte kon niet worden opgeslagen."};}
  revalidatePath('/reports','layout');
  redirect(`/reports/vat/${year}/${quarter}?snapshot=${id}`);
}
