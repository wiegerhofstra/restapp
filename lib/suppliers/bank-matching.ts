import { supplierMatches } from '../vat/supplier-rules.ts';
export type BankSupplierSource={id:number;counterparty:string;counterparty_iban:string;description:string;details:unknown[];warning:string;transaction_description?:string};
export type RecognizableSupplier={id:number;name:string;active:boolean};
export type BankSupplierRule={id:number;supplier_id:number;field:'iban'|'name'|'description';pattern:string;active:boolean};
export type VatIdentityRule={id:number;supplier_id:number;pattern:string};
export type SupplierCandidate={id:number;name:string;reasons:string[]};
export type BankSupplierMatch={supplier_id:number|null;status:'matched'|'unmatched'|'ambiguous'|'batch';evidence:{candidates:SupplierCandidate[];ruleIds:number[];vatRuleIds:number[]}};
export const normalizeName=(s:string)=>s.normalize('NFKC').toLocaleLowerCase('nl-NL').replace(/\s+/g,' ').trim();
export const normalizeIban=(s:string)=>s.replace(/\s+/g,'').toUpperCase();
export function normalizeBankPattern(field:string,pattern:string) {
  if(!['iban','name','description'].includes(field)) throw new Error('Kies IBAN, naam tegenpartij of omschrijving.');
  if(field==='iban') {
    const iban=normalizeIban(pattern);
    if(!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) throw new Error('Vul het volledige IBAN van de tegenpartij in.');
    const rearranged=iban.slice(4)+iban.slice(0,4);let remainder=0;
    for(const c of rearranged) for(const d of /[A-Z]/.test(c)?String(c.charCodeAt(0)-55):c) remainder=(remainder*10+Number(d))%97;
    if(remainder!==1) throw new Error('Het controlegetal van dit IBAN is niet geldig.');
    return iban;
  }
  const text=normalizeName(pattern);
  if(text.length<4||text.length>200||!/[\p{L}]/u.test(text)) throw new Error('Gebruik specifieke herkenningstekst van 4 tot 200 tekens.');
  return text;
}
export function matchBankSupplier(entry:BankSupplierSource,suppliers:RecognizableSupplier[],rules:BankSupplierRule[],vatRules:VatIdentityRule[]=[]):BankSupplierMatch {
  const evidence:BankSupplierMatch['evidence']={candidates:[],ruleIds:[],vatRuleIds:[]};
  if(entry.warning||entry.details.length>1) return {supplier_id:null,status:'batch',evidence};
  for(const supplier of suppliers.filter(s=>s.active)) {
    const reasons:string[]=[];
    if(normalizeName(supplier.name).length>=4&&normalizeName(supplier.name)===normalizeName(entry.counterparty)) reasons.push('Naam tegenpartij is gelijk aan leveranciersnaam');
    for(const rule of rules.filter(r=>r.active&&r.supplier_id===supplier.id)) {
      const matched=rule.field==='iban'?Boolean(entry.counterparty_iban)&&normalizeIban(entry.counterparty_iban)===normalizeIban(rule.pattern)
        :rule.field==='name'?normalizeName(entry.counterparty)===normalizeName(rule.pattern)
        :supplierMatches(rule.pattern,entry.description);
      if(matched){reasons.push(rule.field==='iban'?'IBAN herkend':rule.field==='name'?'Naam tegenpartij herkend':'Omschrijving herkend');evidence.ruleIds.push(rule.id);}
    }
    for(const rule of vatRules.filter(r=>r.supplier_id===supplier.id)) {
      if([entry.counterparty,entry.description,entry.transaction_description??''].some(text=>supplierMatches(rule.pattern,text))) {
        reasons.push('Herkenning uit bestaande btw-regel');evidence.vatRuleIds.push(rule.id);
      }
    }
    if(reasons.length) evidence.candidates.push({id:supplier.id,name:supplier.name,reasons:[...new Set(reasons)]});
  }
  return {supplier_id:evidence.candidates.length===1?evidence.candidates[0].id:null,status:evidence.candidates.length===1?'matched':evidence.candidates.length?'ambiguous':'unmatched',evidence};
}
