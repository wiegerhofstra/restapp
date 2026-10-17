import { refreshBankSupplierLinks } from './bank.ts';
import { db, row, rows } from '../db.ts';
import { hash, lockSources, sources, ruleContexts, supplierRules } from '../vat/service.ts';
import { applySupplierRule, classifySupplier, ruleAccounts, supplierMatches, type Supplier, type SupplierRule, type RuleConfig } from '../vat/supplier-rules.ts';
import { validDate } from '../vat/calculation.ts';

export async function getSuppliers() {return rows<Supplier>('SELECT * FROM suppliers ORDER BY name,id');}
export type SupplierInput={name:string;country:string;tax_number:string;active:boolean};
function validateSupplier(input:SupplierInput) {
  const name=input.name.trim(),country=input.country.trim().toUpperCase(),tax_number=input.tax_number.trim();
  if(name.length<2||name.length>100) throw new Error('Vul een leveranciersnaam van 2 tot 100 tekens in.');
  if(country&&!/^[A-Z]{2}$/.test(country)) throw new Error('Gebruik een landcode van twee letters, bijvoorbeeld NL, DE of IE.');
  if(tax_number.length>50) throw new Error('Het btw-identificatienummer is te lang.');
  return {name,country,tax_number,active:input.active};
}
export async function saveSupplier(id:number|null,version:number,input:SupplierInput,actor='system') {
  const value=validateSupplier(input);
  return db.transaction(async()=>{
    await db.prepare('SELECT pg_advisory_xact_lock(713055)').all();
    if(id) {
      const current=await row<Supplier>('SELECT * FROM suppliers WHERE id=? FOR UPDATE',id);
      if(!current||current.version!==version) throw new Error('Deze leverancier is gewijzigd. Vernieuw de pagina.');
      if(current.name===value.name&&current.country===value.country&&current.tax_number===value.tax_number&&current.active===value.active) return id;
      const result=await db.prepare('UPDATE suppliers SET name=?,country=?,tax_number=?,active=?,version=version+1 WHERE id=? AND version=?').run(value.name,value.country,value.tax_number,value.active,id,version);
      if(!result.changes) throw new Error('Deze leverancier is gewijzigd. Vernieuw de pagina.');
      await refreshBankSupplierLinks(actor);
      return id;
    }
    const created=(await db.prepare('INSERT INTO suppliers(name,country,tax_number,active) VALUES(?,?,?,?)').run(value.name,value.country,value.tax_number,value.active)).lastInsertRowid!;
    await refreshBankSupplierLinks(actor);
    return created;
  })();
}
export type RuleInput={sampleId:number;sampleHash:string;supplierId:number|null;newSupplier:SupplierInput;pattern:string;code:string;rateBps:number;deductibleBps:number;validFrom:string;note:string};
export type RulePreview={token:string;count:number;examples:{id:number;date:string;description:string;automatic:boolean;reason:string}[];total:number;accounts:{name:string;kind:string}[]};
async function prepareRule(input:RuleInput) {
  const supplier:Supplier=input.supplierId
    ? (await row<Supplier>('SELECT * FROM suppliers WHERE id=?',input.supplierId))!
    : {...validateSupplier(input.newSupplier),id:0,version:1};
  if(!supplier||!supplier.active) throw new Error('Kies een actieve leverancier.');
  if(!['5b','2a','4a','4b'].includes(input.code)) throw new Error('Kies voorbelasting of de toepasselijke verleggingsrubriek.');
  if(!Number.isInteger(input.rateBps)||input.rateBps<=0||input.rateBps>10000||!Number.isInteger(input.deductibleBps)||input.deductibleBps<0||input.deductibleBps>10000) throw new Error('Vul een geldig btw-tarief en aftrekpercentage in.');
  const pattern=input.pattern.trim().replace(/\s+/g,' '),note=input.note.trim();
  if(pattern.length<4||pattern.length>120||!/[\p{L}]/u.test(pattern)) throw new Error('Gebruik specifieke leverancierstekst van 4 tot 120 tekens.');
  if(!validDate(input.validFrom)) throw new Error('Kies een geldige ingangsdatum.');
  if(note.length<5||note.length>2000) throw new Error('Licht de vaste btw-behandeling toe en verwijs naar een gecontroleerde factuur.');
  const all=await sources(),source=all.find(s=>s.kind==='transaction'&&s.id===input.sampleId);
  if(!source||source.hash!==input.sampleHash) throw new Error('De voorbeeldboeking is gewijzigd. Vernieuw de pagina.');
  if(!supplierMatches(pattern,source.description)) throw new Error('De herkenningstekst komt niet voor in de voorbeeldboeking.');
  const contexts=await ruleContexts(),context=contexts.get(source.id)??{postings:[],batch:false};
  const code=input.code as RuleConfig['code'];
  const config:RuleConfig={pattern,code,rateBps:input.rateBps,deductibleBps:input.deductibleBps,validFrom:input.validFrom,datePolicy:'booking_date',supplierVersion:supplier.version,
    accounts:ruleAccounts(context.postings,code),sampleId:source.id,sampleHash:source.hash,sampleSource:source,note};
  const candidate:SupplierRule={id:0,supplier_id:supplier.id,active:true,config,actor:'',created_at:'',supplier};
  const sampleResult=applySupplierRule(source,context,candidate);
  if(!sampleResult.lines) throw new Error(sampleResult.reason);
  const oldRules=await supplierRules(),rules=[...oldRules.filter(r=>r.supplier_id!==supplier.id),candidate];
  const reviews=await rows<{source_id:number;source_hash:string;id:number}>("SELECT DISTINCT ON (source_id) id,source_id,source_hash FROM vat_reviews WHERE source_kind='transaction' ORDER BY source_id,id DESC");
  const relevant=all.filter(s=>s.kind==='transaction'&&supplierMatches(pattern,s.description)&&s.date>=input.validFrom);
  const examples=relevant.map(s=>{
    const manual=reviews.find(r=>r.source_id===s.id),result=classifySupplier(s,contexts.get(s.id)??{postings:[],batch:false},rules);
    return {id:s.id,date:s.date,description:s.description,automatic:!manual&&Boolean(result.lines),reason:manual?'Bestaande handmatige controle blijft behouden.':result.reason??'Automatisch volgens deze leveranciersregel'};
  });
  const preview:RulePreview={token:hash({config,supplier,relevant,contexts:relevant.map(s=>contexts.get(s.id)),reviews,rules}),count:examples.filter(e=>e.automatic).length,examples:examples.slice(0,50),total:examples.length,accounts:context.postings.map(p=>({name:p.name,kind:p.kind}))};
  return {preview,candidate};
}
export async function previewSupplierRule(input:RuleInput) {
  return db.transaction(async()=>{await db.prepare('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ').run();return (await prepareRule(input)).preview;})();
}
export async function saveSupplierRule(input:RuleInput,token:string,actor:string) {
  return db.transaction(async()=>{
    await db.prepare('SELECT pg_advisory_xact_lock(713055)').all();
    await db.prepare('SELECT pg_advisory_xact_lock(713053)').all();
    await lockSources();
    const {preview,candidate}=await prepareRule(input);
    if(preview.token!==token) throw new Error('De instellingen, boekingen of regels zijn gewijzigd. Bekijk eerst een nieuw voorbeeld.');
    let supplierId=candidate.supplier_id;
    if(!supplierId) {
      const s=candidate.supplier;
      supplierId=(await db.prepare('INSERT INTO suppliers(name,country,tax_number) VALUES(?,?,?)').run(s.name,s.country,s.tax_number)).lastInsertRowid!;
    }
    await db.prepare('INSERT INTO vat_supplier_rules(supplier_id,active,config,actor) VALUES(?,true,?,?)').run(supplierId,JSON.stringify(candidate.config),actor);
    await refreshBankSupplierLinks(actor);
    return supplierId;
  })();
}
export async function disableSupplierRule(supplierId:number,expectedRule:number,actor:string) {
  return db.transaction(async()=>{
    await db.prepare('SELECT pg_advisory_xact_lock(713055)').all();
    const rule=await row<SupplierRule>('SELECT * FROM vat_supplier_rules WHERE supplier_id=? ORDER BY id DESC LIMIT 1',supplierId);
    if(!rule||rule.id!==expectedRule||!rule.active) throw new Error('De regel is gewijzigd. Vernieuw de pagina.');
    await db.prepare('INSERT INTO vat_supplier_rules(supplier_id,active,config,actor) VALUES(?,false,?,?)').run(supplierId,JSON.stringify(rule.config),actor);
    await refreshBankSupplierLinks(actor);
  })();
}
