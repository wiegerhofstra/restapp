'use server';
import { saveBankSupplierRule, disableBankSupplierRule, recognizeBankSuppliers, chooseBankSupplier } from '@/lib/suppliers/bank';
import { currentUser } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { saveSupplier, previewSupplierRule, saveSupplierRule, disableSupplierRule, type RuleInput, type RulePreview } from '@/lib/suppliers/service';
import { parseAmount } from '@/lib/presets/calculation';
export type SupplierState={error?:string;message?:string;preview?:RulePreview};
async function actor(){const user=await currentUser();if(!user)redirect('/login');return user.id;}
const value=(data:FormData,key:string)=>String(data.get(key)??'');
function supplierInput(data:FormData){return {name:value(data,'name'),country:value(data,'country'),tax_number:value(data,'tax_number'),active:data.get('active')==='on'};}
function refresh(){revalidatePath('/bank','layout');revalidatePath('/transactions','layout');revalidatePath('/suppliers','layout');revalidatePath('/reports','layout');}
export async function supplierAction(id:number|null,_:SupplierState,data:FormData):Promise<SupplierState> {
  const user=await actor();let saved:number;
  try {saved=await saveSupplier(id,Number(data.get('version')),supplierInput(data),user);} catch(e){return {error:e instanceof Error?e.message:'De leverancier kon niet worden opgeslagen.'};}
  refresh();redirect(`/suppliers/${saved}`);
}
export async function ruleAction(_:SupplierState,data:FormData):Promise<SupplierState> {
  const user=await actor();let supplierId:number;
  try {
    const input:RuleInput={ruleKey:value(data,'ruleKey')||'new',ruleName:value(data,'ruleName'),sampleId:Number(data.get('sampleId')),sampleHash:value(data,'sampleHash'),supplierId:Number(data.get('supplierId'))||null,
      newSupplier:{...supplierInput(data),active:true},pattern:value(data,'pattern'),code:value(data,'code'),rateBps:parseAmount(value(data,'rate')),deductibleBps:parseAmount(value(data,'deductible')),
      settlementBankAccountId:Number(data.get('settlementBankAccountId'))||undefined,settlementDirection:value(data,'settlementDirection'),invoiceRoundingCents:data.get('invoiceRounding')==='on'?1:0,linkSampleBank:data.get('linkSampleBank')==='on',validFrom:value(data,'validFrom'),note:value(data,'note')};
    if(data.get('intent')==='preview') return {preview:await previewSupplierRule(input)};
    if(data.get('intent')!=='activate'||data.get('confirmed')!=='on') throw new Error('Bevestig de vaste btw-behandeling, bewijsstukken en btw-datum voor deze reeks.');
    supplierId=await saveSupplierRule(input,value(data,'token'),user);
  } catch(e){return {error:e instanceof Error?e.message:'De leveranciersregel kon niet worden opgeslagen.'};}
  refresh();redirect(`/suppliers/${supplierId}?activated=1`);
}
export async function disableRuleAction(supplierId:number,ruleId:number):Promise<SupplierState> {
  const user=await actor();
  try {await disableSupplierRule(supplierId,ruleId,user);} catch(e){return {error:e instanceof Error?e.message:'De regel kon niet worden gepauzeerd.'};}
  refresh();return {};
}

export async function bankRuleAction(supplierId:number,_:SupplierState,data:FormData):Promise<SupplierState> {
  const user=await actor();
  try {await saveBankSupplierRule(supplierId,value(data,'field'),value(data,'pattern'),user);}
  catch(e){return {error:e instanceof Error?e.message:'De herkenningsregel kon niet worden opgeslagen.'};}
  refresh();return {message:'Herkenningsregel opgeslagen en bestaande bankmutaties opnieuw herkend.'};
}
export async function disableBankRuleAction(ruleId:number):Promise<SupplierState> {
  const user=await actor();
  try {await disableBankSupplierRule(ruleId,user);}
  catch(e){return {error:e instanceof Error?e.message:'De herkenningsregel kon niet worden gepauzeerd.'};}
  refresh();return {message:'Herkenningsregel gepauzeerd. Handmatige koppelingen zijn behouden.'};
}
export async function recognizeBankAction():Promise<SupplierState> {
  const user=await actor();
  try {const changed=await recognizeBankSuppliers(user);refresh();return {message:`Leveranciersherkenning voltooid: ${changed} bankmutaties bijgewerkt. Handmatige keuzes zijn behouden.`};}
  catch(e){return {error:e instanceof Error?e.message:'Leveranciersherkenning is niet gelukt.'};}
}
export async function bankSupplierAction(entryId:number,_:SupplierState,data:FormData):Promise<SupplierState> {
  const user=await actor();
  try {
    const selected=value(data,'supplier_id'),automatic=data.get('intent')==='automatic';
    if(!automatic&&selected!=='new'&&selected!==''&&(!Number.isSafeInteger(Number(selected))||Number(selected)<=0)) throw new Error('Kies een geldige leverancier.');
    await chooseBankSupplier(entryId,Number(data.get('version')),selected==='new'||selected===''?null:Number(selected),selected==='new'?value(data,'name'):null,
      data.get('remember')==='on'?{field:value(data,'field'),pattern:value(data,'pattern')}:null,automatic,user);
  } catch(e){return {error:e instanceof Error?e.message:'De leverancierskoppeling kon niet worden opgeslagen.'};}
  refresh();return {message:'Leverancierskoppeling opgeslagen. Eventuele herkenningsregels zijn ook op bestaande bankmutaties toegepast.'};
}
