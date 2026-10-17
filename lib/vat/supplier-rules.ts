import { validDate, validateLines, type VatLine } from './calculation.ts';
import type { Source } from './service';

export type Supplier = {id:number;name:string;country:string;tax_number:string;active:boolean;version:number};
export type Posting = {accountId:number;name:string;kind:string;debit:number;credit:number};
export type RuleConfig = {
  pattern:string;code:'5b'|'2a'|'4a'|'4b';rateBps:number;deductibleBps:number;
  validFrom:string;datePolicy:'booking_date';supplierVersion:number;
  accounts:{base:number;input:number;output:number|null;payment:number};
  sampleId:number;sampleHash:string;sampleSource?:Source;note:string;
};
export type SupplierRule = {id:number;supplier_id:number;active:boolean;config:RuleConfig;actor:string;created_at:string;supplier:Supplier};
export type RuleContext = {postings:Posting[];batch:boolean;supplierId?:number;supplierBlockedReason?:string;supplierEvidence?:unknown[]};
export type RuleResult = {rule?:SupplierRule;lines?:VatLine[];reason?:string};
const normalize=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
export function supplierMatches(pattern:string,description:string) {
  const escaped=normalize(pattern).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return escaped.length>0 && new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`,'u').test(normalize(description));
}

// Exact account roles and signed amounts prevent a familiar supplier name from
// approving refunds, mixed rates, split payments or an unrelated kind of purchase.
export function applySupplierRule(source:Source,context:RuleContext,rule:SupplierRule):RuleResult {
  const c=rule.config;
  const fail=(reason:string):RuleResult=>({reason});
  if(!rule.supplier.active||rule.supplier.version!==c.supplierVersion) return fail('Leveranciersgegevens zijn gewijzigd of de leverancier is inactief. Stel de btw-regel opnieuw vast.');
  if(context.batch) return fail('Verzamelbetaling of meerdere bankmutaties: controleer de onderliggende facturen.');
  if(source.balance!==0||source.deleted) return fail('De boeking is gewijzigd, verwijderd of niet in evenwicht.');
  if(!validDate(source.date)||source.date<c.validFrom) return fail('Deze boeking valt vóór de ingangsdatum van de leveranciersregel.');
  if(c.datePolicy!=='booking_date') return fail('Geen vaste btw-datum ingesteld.');
  const roles=c.accounts, expected=[roles.base,roles.input,roles.payment,...(roles.output?[roles.output]:[])];
  if(context.postings.length!==expected.length||new Set(expected).size!==expected.length||context.postings.some(p=>!expected.includes(p.accountId))) return fail('De grootboekrekeningen wijken af van de leveranciersregel.');
  const find=(id:number)=>context.postings.find(p=>p.accountId===id)!;
  if(expected.some(id=>context.postings.filter(p=>p.accountId===id).length!==1)) return fail('Gesplitste boekingsregels moeten afzonderlijk worden gecontroleerd.');
  const base=find(roles.base),input=find(roles.input),payment=find(roles.payment),output=roles.output?find(roles.output):undefined;
  if(base.kind!=='expense'||input.kind!=='asset'||payment.kind!=='asset'||(output&&output.kind!=='liability')) return fail('De rekeningsoorten zijn gewijzigd.');
  if(context.postings.some(p=>!Number.isSafeInteger(p.debit)||!Number.isSafeInteger(p.credit)||p.debit<0||p.credit<0||(p.debit>0&&p.credit>0))||base.debit<=0||base.credit!==0||input.credit!==0||payment.debit!==0||(output&&output.debit!==0)) return fail('Terugbetaling of afwijkende boekingsrichting: controleer deze boeking.');
  const tax=Number((BigInt(base.debit)*BigInt(c.rateBps)+BigInt(5000))/BigInt(10000));
  if(tax<=0||input.debit!==tax||(output&&output.credit!==tax)||payment.credit!==base.debit+(output?0:tax)) return fail('Btw-bedrag, tarief of betalingsbedrag wijkt af van de leveranciersregel.');
  try {
    const lines=validateLines([{date:source.date,code:c.code,base:base.debit,tax,deductibleBps:c.deductibleBps}]);
    return {rule,lines};
  } catch {return fail('De btw-regel levert geen geldige aangifteregel op.');}
}
export function classifySupplier(source:Source,context:RuleContext,rules:SupplierRule[]):RuleResult {
  if(source.kind!=='transaction') return {};
  if(context.supplierBlockedReason) return {reason:context.supplierBlockedReason};
  const matches=rules.filter(r=>r.active&&(context.supplierId!==undefined?r.supplier_id===context.supplierId:supplierMatches(r.config.pattern,source.description)));
  if(matches.length>1) return {reason:'Meerdere leveranciersregels herkennen deze boeking. Kies de juiste btw-behandeling.'};
  return matches.length?applySupplierRule(source,context,matches[0]):{};
}

export function ruleAccounts(postings:Posting[],code:RuleConfig['code']):RuleConfig['accounts'] {
  const single=(kind:string,side:'debit'|'credit')=>{
    const found=postings.filter(p=>p.kind===kind&&p[side]>0&&p[side==='debit'?'credit':'debit']===0);
    if(found.length!==1) throw new Error('Gebruik als voorbeeld een eenvoudige leveranciersbetaling met één kostenrekening en afzonderlijke btw-rekeningen.');
    return found[0].accountId;
  };
  return {base:single('expense','debit'),input:single('asset','debit'),payment:single('asset','credit'),output:code==='5b'?null:single('liability','credit')};
}
