import { rubricLabel, validDate, validateLines, type VatLine } from './calculation.ts';
import type { Source } from './service';

export type Supplier = {id:number;name:string;country:string;tax_number:string;active:boolean;version:number};
export type Posting = {accountId:number;name:string;kind:string;debit:number;credit:number};
export type RuleConfig = {
  name?:string;
  pattern:string;code:'5b'|'2a'|'4a'|'4b'|'exempt_purchase'|'vat_settlement'|'supplier_credit';rateBps:number;deductibleBps:number;
  settlement?:{direction:'payment'|'refund'|'both';balanceKind:'asset'|'liability'};
  invoiceRoundingCents?:0|1;
  validFrom:string;datePolicy:'booking_date';supplierVersion:number;
  accounts:{base:number;input:number|null;output:number|null;payment:number};
  sampleId:number;sampleHash:string;sampleSource?:Source;note:string;
};
export type SupplierRule = {id:number;rule_key?:string;supplier_id:number;active:boolean;config:RuleConfig;actor:string;created_at:string;supplier:Supplier};
export type RuleContext = {postings:Posting[];batch:boolean;bankAccountIds?:number[];supplierId?:number;supplierBlockedReason?:string;supplierEvidence?:unknown[]};
export type RuleResult = {rule?:SupplierRule;lines?:VatLine[];reason?:string;notice?:string};
export function supplierTreatmentLabel(code:RuleConfig['code']) {
  if(code==='supplier_credit') return 'Leverancierstegoed opwaarderen — buiten de btw-aangifte';
  if(code==='vat_settlement') return 'Btw-betaling of -teruggaaf — buiten de aangifte';
  return code==='exempt_purchase'?'Vrijgestelde inkoop — niet opnemen in de btw-aangifte':`${code} · ${rubricLabel(code)}`;
}
export function outsideVatReturn(code:string) {return ['exempt_purchase','vat_settlement','supplier_credit'].includes(code);}
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
  if(c.code==='supplier_credit') {
    const roles=c.accounts,bank=context.postings.find(p=>p.accountId===roles.payment),credit=context.postings.find(p=>p.accountId===roles.base);
    if(c.rateBps!==0||c.deductibleBps!==0||(c.invoiceRoundingCents??0)!==0||roles.input!==null||roles.output!==null) return fail('Opwaarderen zonder btw vereist een regel zonder btw-tarief of aftrek.');
    if(context.postings.length!==2||roles.base===roles.payment||!bank||!credit||bank.kind!=='asset'||credit.kind!=='asset'||context.bankAccountIds?.includes(roles.base)) return fail('Opwaarderen vereist alleen de ingestelde bankrekening en tegoedrekening van de leverancier.');
    if(context.postings.some(p=>!Number.isSafeInteger(p.debit)||!Number.isSafeInteger(p.credit)||p.debit<0||p.credit<0)||bank.debit!==0||bank.credit<=0||credit.credit!==0||credit.debit!==bank.credit) return fail('Bedrag of richting wijkt af: alleen stortingen van de bank naar het leverancierstegoed vallen onder deze regel.');
    return {rule,lines:[]};
  }
  if(c.code==='vat_settlement') {
    const roles=c.accounts,settlement=c.settlement;
    if(!settlement||!['payment','refund','both'].includes(settlement.direction)||!['asset','liability'].includes(settlement.balanceKind)||c.rateBps!==0||c.deductibleBps!==0||(c.invoiceRoundingCents??0)!==0||roles.input!==null||roles.output!==null) return fail('Stel de btw-afwikkeling opnieuw vast met een bankrekening, btw-balansrekening en betalingsrichting.');
    if(!supplierMatches(c.pattern,source.description)) return fail('De omschrijving wijkt af van de herkenningstekst voor deze btw-betaling of -teruggaaf.');
    const bank=context.postings.find(p=>p.accountId===roles.payment),balance=context.postings.find(p=>p.accountId===roles.base);
    if(context.bankAccountIds?.includes(roles.base)) return fail('Een overboeking tussen bankrekeningen is geen btw-afwikkeling.');
    if(context.postings.length!==2||roles.payment===roles.base||!bank||!balance||bank.kind!=='asset'||balance.kind!==settlement.balanceKind) return fail('Btw-afwikkeling vereist uitsluitend de ingestelde bankrekening en btw-balansrekening. Kosten, opbrengsten en extra boekingsregels vragen controle.');
    if(context.postings.some(p=>!Number.isSafeInteger(p.debit)||!Number.isSafeInteger(p.credit)||p.debit<0||p.credit<0||(p.debit>0&&p.credit>0))) return fail('De bedragen van de btw-afwikkeling zijn ongeldig.');
    const refund=bank.debit>0&&bank.credit===0&&balance.debit===0&&balance.credit===bank.debit;
    const payment=bank.credit>0&&bank.debit===0&&balance.credit===0&&balance.debit===bank.credit;
    if(!(refund&&(settlement.direction==='refund'||settlement.direction==='both'))&&!(payment&&(settlement.direction==='payment'||settlement.direction==='both'))) return fail('Het bedrag of de betalingsrichting wijkt af van de ingestelde btw-afwikkeling.');
    return {rule,lines:[]};
  }
  const exempt=c.code==='exempt_purchase',roles=c.accounts;
  if(exempt?(roles.input!==null||roles.output!==null||c.rateBps!==0||c.deductibleBps!==0):roles.input===null) return fail('De leveranciersregel bevat geen geldige btw-instellingen. Stel de regel opnieuw vast.');
  const expected=[roles.base,roles.payment,...(roles.input===null?[]:[roles.input]),...(roles.output===null?[]:[roles.output])];
  if(context.postings.length!==expected.length||new Set(expected).size!==expected.length||context.postings.some(p=>!expected.includes(p.accountId))) return fail('De grootboekrekeningen wijken af van de leveranciersregel.');
  const find=(id:number)=>context.postings.find(p=>p.accountId===id)!;
  if(expected.some(id=>context.postings.filter(p=>p.accountId===id).length!==1)) return fail('Gesplitste boekingsregels moeten afzonderlijk worden gecontroleerd.');
  const base=find(roles.base),input=roles.input===null?undefined:find(roles.input),payment=find(roles.payment),output=roles.output===null?undefined:find(roles.output);
  if(base.kind!=='expense'||(input&&input.kind!=='asset')||payment.kind!=='asset'||(output&&output.kind!=='liability')) return fail('De rekeningsoorten zijn gewijzigd.');
  if(context.postings.some(p=>!Number.isSafeInteger(p.debit)||!Number.isSafeInteger(p.credit)||p.debit<0||p.credit<0||(p.debit>0&&p.credit>0))||base.debit<=0||base.credit!==0||(input&&input.credit!==0)||payment.debit!==0||(output&&output.debit!==0)) return fail('Terugbetaling of afwijkende boekingsrichting: controleer deze boeking.');
  if(exempt) return payment.credit===base.debit?{rule,lines:[]}:fail('Het betalingsbedrag wijkt af van de vrijgestelde kosten.');
  const calculatedTax=Number((BigInt(base.debit)*BigInt(c.rateBps)+BigInt(5000))/BigInt(10000));
  const tax=input?.debit??0,difference=Math.abs(tax-calculatedTax);
  const money=(cents:number)=>`€ ${(cents/100).toLocaleString('nl-NL',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  // Invoice rounding is an explicit domestic-purchase policy, never a blanket
  // tolerance for reverse charge, missing VAT, payment differences or old rules.
  const tolerance=c.code==='5b'&&c.invoiceRoundingCents===1?1:0;
  if(calculatedTax<=0||tax<=0||difference>tolerance) return fail(`Geboekte btw ${money(tax)}; bij ${(c.rateBps/100).toLocaleString('nl-NL')}% over ${money(base.debit)} wordt ${money(calculatedTax)} verwacht (verschil ${money(difference)}). Controleer de factuur.${c.code==='5b'&&difference===1&&!tolerance?' Bij bevestigde factuurafronding kunt u voor deze leverancier maximaal € 0,01 verschil toestaan.':''}`);
  if(output&&output.credit!==calculatedTax) return fail(`Verlegde btw wijkt af: ${money(output.credit)} geboekt, ${money(calculatedTax)} verwacht.`);
  const expectedPayment=base.debit+(output?0:tax);
  if(payment.credit!==expectedPayment) return fail(`Betalingsbedrag wijkt af: ${money(payment.credit)} geboekt, ${money(expectedPayment)} verwacht op basis van kosten en geboekte btw.`);
  try {
    const lines=validateLines([{date:source.date,code:c.code,base:base.debit,tax,deductibleBps:c.deductibleBps}]);
    return {rule,lines,...(difference?{notice:`Factuurafronding ${money(difference)} volgens leveranciersregel: geboekte btw ${money(tax)} behouden; berekend ${money(calculatedTax)}.`}:{})};
  } catch {return fail('De btw-regel levert geen geldige aangifteregel op.');}
}
export function classifySupplier(source:Source,context:RuleContext,rules:SupplierRule[]):RuleResult {
  if(source.kind!=='transaction') return {};
  if(context.supplierBlockedReason) return {reason:context.supplierBlockedReason};
  const matches=rules.filter(r=>r.active&&(context.supplierId!==undefined?r.supplier_id===context.supplierId:supplierMatches(r.config.pattern,source.description)));
  // Distinct suppliers remain ambiguous. Within one supplier, account roles,
  // direction and VAT amounts distinguish funding from purchases and other flows.
  if(new Set(matches.map(r=>r.supplier_id)).size>1) return {reason:'Meerdere leveranciers herkennen deze boeking. Kies de juiste leverancier.'};
  const results=matches.map(r=>applySupplierRule(source,context,r)),accepted=results.filter(r=>r.rule&&r.lines);
  if(accepted.length>1) return {reason:'Meerdere leveranciersregels passen volledig op deze boeking. Maak de regels specifieker of pauzeer de dubbele regel.'};
  if(accepted.length===1) return accepted[0];
  return results.length===1?results[0]:results.length?{reason:`Geen leveranciersregel past volledig. ${[...new Set(results.map(r=>r.reason).filter(Boolean))].join(' ')}`}:{ };
}

export function ruleAccounts(postings:Posting[],code:RuleConfig['code'],bankAccountId?:number):RuleConfig['accounts'] {
  if(code==='supplier_credit') {
    const bank=postings.find(p=>p.accountId===bankAccountId),credit=postings.find(p=>p.accountId!==bankAccountId);
    if(postings.length!==2||!bank||!credit||bank.kind!=='asset'||credit.kind!=='asset') throw new Error('Kies de bankrekening. Opwaarderen vereist één bankrekening en één tegoedrekening, zonder kosten of btw-regels.');
    return {base:credit.accountId,payment:bank.accountId,input:null,output:null};
  }
  if(code==='vat_settlement') {
    const bank=postings.find(p=>p.accountId===bankAccountId),balance=postings.find(p=>p.accountId!==bankAccountId);
    if(postings.length!==2||!bank||bank.kind!=='asset'||!balance||!['asset','liability'].includes(balance.kind)) throw new Error('Kies de bankrekening uit deze boeking. Btw-afwikkeling vereist één bankrekening en één btw-balansrekening, zonder kosten, opbrengsten of extra regels.');
    return {base:balance.accountId,payment:bank.accountId!,input:null,output:null};
  }
  const single=(kind:string,side:'debit'|'credit')=>{
    const found=postings.filter(p=>p.kind===kind&&p[side]>0&&p[side==='debit'?'credit':'debit']===0);
    if(found.length!==1) throw new Error(code==='exempt_purchase'?'Vrijgestelde inkoop vereist één kostenrekening en één bankrekening. Kies voor een btw-betaling of -teruggaaf de behandeling ‘Btw-betaling of -teruggaaf — buiten de aangifte’.':'Gebruik als voorbeeld een eenvoudige leveranciersbetaling met één kostenrekening en afzonderlijke btw-rekeningen.');
    return found[0].accountId;
  };
  return {base:single('expense','debit'),input:code==='exempt_purchase'?null:single('asset','debit'),payment:single('asset','credit'),output:code==='5b'||code==='exempt_purchase'?null:single('liability','credit')};
}
