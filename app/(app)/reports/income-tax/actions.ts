'use server';
import { currentUser } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { saveIncomeTaxConfig, saveIncomeTaxSnapshot } from '@/lib/income-tax/service';
export type ActionState={error?:string};
export async function configAction(_:ActionState,data:FormData):Promise<ActionState> {
  const user=await currentUser();if(!user)redirect('/login');
  const year=Number(data.get('year'));
  try {await saveIncomeTaxConfig(year,Number(data.get('configId')),String(data.get('sourceHash')),JSON.parse(String(data.get('config'))),user.id);}
  catch(error){return {error:error instanceof Error?error.message:'Opslaan mislukt.'};}
  revalidatePath('/reports/income-tax','layout');redirect(`/reports/income-tax/${year}?saved=1`);
}
export async function snapshotAction(_:ActionState,data:FormData):Promise<ActionState> {
  const user=await currentUser();if(!user)redirect('/login');
  const year=Number(data.get('year'));let id;
  try {
    const status=String(data.get('status'));
    if(status!=='draft'&&status!=='reviewed')throw new Error('Ongeldige status.');
    if(status==='reviewed'&&data.get('confirmed')!=='on')throw new Error('Bevestig dat u de jaarcijfers en persoonlijke toerekening hebt gecontroleerd.');
    id=await saveIncomeTaxSnapshot(year,String(data.get('fingerprint')),status,user.id);
  } catch(error){return {error:error instanceof Error?error.message:'Bewaren mislukt.'};}
  revalidatePath('/reports/income-tax','layout');redirect(`/reports/income-tax/${year}?snapshot=${id}`);
}
