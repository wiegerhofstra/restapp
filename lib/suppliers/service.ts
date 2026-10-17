import { randomUUID } from 'node:crypto';
import { refreshBankSupplierLinks, getSampleBankLinks, linkBankSupplierForVat, type SampleBankLink } from './bank.ts';
import { db, row, rows } from '../db.ts';
import { hash, lockSources, sources, ruleContexts, supplierRules } from '../vat/service.ts';
import { applySupplierRule, classifySupplier, outsideVatReturn, supplierTreatmentLabel, ruleAccounts, supplierMatches, type Supplier, type SupplierRule, type RuleConfig } from '../vat/supplier-rules.ts';
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
export type RuleInput={ruleKey?:string;ruleName?:string;sampleId:number;sampleHash:string;supplierId:number|null;newSupplier:SupplierInput;pattern:string;code:string;rateBps:number;deductibleBps:number;invoiceRoundingCents?:0|1;settlementBankAccountId?:number;settlementDirection?:string;linkSampleBank?:boolean;validFrom:string;note:string};
export type RulePreview={token:string;count:number;examples:{id:number;date:string;description:string;automatic:boolean;reason:string}[];total:number;accounts:{name:string;kind:string}[];blockedReason?:string;bankLink?:SampleBankLink & {selectedSupplier:string}};
async function prepareRule(input:RuleInput) {
  const supplier:Supplier=input.supplierId
    ? (await row<Supplier>('SELECT * FROM suppliers WHERE id=?',input.supplierId))!
    : {...validateSupplier(input.newSupplier),id:0,version:1};
  if(!supplier||!supplier.active) throw new Error('Kies een actieve leverancier.');
  if(!['5b','2a','4a','4b','exempt_purchase','vat_settlement','supplier_credit'].includes(input.code)) throw new Error('Kies een geldige btw-behandeling.');
  const ruleKey=input.ruleKey??'default',ruleName=input.ruleName?.trim()||supplierTreatmentLabel(input.code as RuleConfig['code']);
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(ruleKey)||ruleName.length>120) throw new Error('Ongeldige regel of te lange regelnaam.');
  const invoiceRoundingCents=input.invoiceRoundingCents??0;
  if(![0,1].includes(invoiceRoundingCents)||(invoiceRoundingCents!==0&&input.code!=='5b')) throw new Error('Maximaal één cent factuurafronding is alleen instelbaar voor Nederlandse inkoopfacturen.');
  if(outsideVatReturn(input.code)) {
    if(input.rateBps!==0||input.deductibleBps!==0) throw new Error('Bij deze behandeling zijn geen btw en voorbelasting van toepassing.');
  } else if(!Number.isInteger(input.rateBps)||input.rateBps<=0||input.rateBps>10000||!Number.isInteger(input.deductibleBps)||input.deductibleBps<0||input.deductibleBps>10000) throw new Error('Vul een geldig btw-tarief en aftrekpercentage in.');
  const pattern=input.pattern.trim().replace(/\s+/g,' '),note=input.note.trim();
  if(pattern.length<4||pattern.length>120||!/[\p{L}]/u.test(pattern)) throw new Error('Gebruik specifieke leverancierstekst van 4 tot 120 tekens.');
  if(!validDate(input.validFrom)) throw new Error('Kies een geldige ingangsdatum.');
  if(note.length<5||note.length>2000) throw new Error('Licht de vaste btw-behandeling toe en verwijs naar een gecontroleerde factuur of ander bewijsstuk.');
  const all=await sources(),source=all.find(s=>s.kind==='transaction'&&s.id===input.sampleId);
  if(!source||source.hash!==input.sampleHash) throw new Error('De voorbeeldboeking is gewijzigd. Vernieuw de pagina.');
  if(!supplierMatches(pattern,source.description)) throw new Error('De herkenningstekst komt niet voor in de voorbeeldboeking.');
  const contexts=await ruleContexts(),context=contexts.get(source.id)??{postings:[],batch:false};
  const sampleBanks=await getSampleBankLinks(source.id);
  const bankLink=input.linkSampleBank?sampleBanks[0]:undefined;
  if(input.linkSampleBank&&(sampleBanks.length!==1||!bankLink?.eligible||context.batch)) throw new Error('Koppel verzamelbetalingen of meerdere bankmutaties eerst afzonderlijk aan de juiste leverancier.');
  if(bankLink) contexts.set(source.id,{...context,supplierId:supplier.id,supplierBlockedReason:undefined});
  const code=input.code as RuleConfig['code'];
  const accounts=ruleAccounts(context.postings,code,input.settlementBankAccountId);
  if(code==='supplier_credit'&&((context.bankAccountIds?.length&&!context.bankAccountIds.includes(accounts.payment))||context.bankAccountIds?.includes(accounts.base))) throw new Error('Kies de geregistreerde bankrekening; de andere rekening moet een leverancierstegoed zijn.');
  let settlement:RuleConfig['settlement'];
  if(code==='vat_settlement') {
    if(!['payment','refund','both'].includes(input.settlementDirection??'')) throw new Error('Kies welke betalingsrichting deze btw-regel mag verwerken.');
    if(context.bankAccountIds?.length&&!context.bankAccountIds.includes(accounts.payment)) throw new Error('Kies de geregistreerde bankrekening van deze boeking.');
    if(context.bankAccountIds?.includes(accounts.base)) throw new Error('Een overboeking tussen bankrekeningen is geen btw-afwikkeling. Kies een btw-balansrekening.');
    settlement={direction:input.settlementDirection as 'payment'|'refund'|'both',balanceKind:context.postings.find(p=>p.accountId===accounts.base)!.kind as 'asset'|'liability'};
  }
  const config:RuleConfig={name:ruleName,pattern,code,rateBps:input.rateBps,deductibleBps:input.deductibleBps,invoiceRoundingCents,validFrom:input.validFrom,datePolicy:'booking_date',supplierVersion:supplier.version,
    accounts,...(settlement?{settlement}:{}),sampleId:source.id,sampleHash:source.hash,sampleSource:source,note};
  const candidate:SupplierRule={id:0,rule_key:ruleKey,supplier_id:supplier.id,active:true,config,actor:'',created_at:'',supplier};
  const sampleResult=applySupplierRule(source,context,candidate);
  if(!sampleResult.lines) throw new Error(sampleResult.reason);
  const oldRules=await supplierRules(),rules=[...oldRules.filter(r=>ruleKey==='new'||r.supplier_id!==supplier.id||(r.rule_key??'default')!==ruleKey),candidate];
  const reviews=await rows<{source_id:number;source_hash:string;id:number}>("SELECT DISTINCT ON (source_id) id,source_id,source_hash FROM vat_reviews WHERE source_kind='transaction' ORDER BY source_id,id DESC");
  const relevant=all.filter(s=>s.kind==='transaction'&&(supplierMatches(pattern,s.description)||(supplier.id>0&&contexts.get(s.id)?.supplierId===supplier.id))&&s.date>=input.validFrom);
  const examples=relevant.map(s=>{
    const manual=reviews.find(r=>r.source_id===s.id),result=classifySupplier(s,contexts.get(s.id)??{postings:[],batch:false},rules);
    const matchesCandidate=result.rule===candidate&&Boolean(result.lines);
    return {id:s.id,date:s.date,description:s.description,automatic:!manual&&matchesCandidate,reason:manual?'Bestaande handmatige controle blijft behouden.':result.reason??(!matchesCandidate?'De boeking is niet aan deze leverancier gekoppeld.':result.notice??(result.rule&&outsideVatReturn(result.rule.config.code)?supplierTreatmentLabel(result.rule.config.code):'Automatisch volgens deze leveranciersregel'))};
  });
  const sample=examples.find(e=>e.id===source.id);
  const blockedReason=!reviews.some(r=>r.source_id===source.id)&&!sample?.automatic?`De voorbeeldboeking kan nog niet automatisch worden verwerkt. ${sample?.reason??'Controleer de leverancierskoppeling.'}`:undefined;
  const preview:RulePreview={token:hash({config,supplier,relevant,contexts:relevant.map(s=>contexts.get(s.id)),sampleBanks,linkSampleBank:!!input.linkSampleBank,reviews,rules}),count:examples.filter(e=>e.automatic).length,examples:examples.slice(0,50),total:examples.length,accounts:context.postings.map(p=>({name:p.name,kind:p.kind})),blockedReason,...(bankLink?{bankLink:{...bankLink,selectedSupplier:supplier.name}}:{})};
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
    if(preview.blockedReason) throw new Error(preview.blockedReason);
    let supplierId=candidate.supplier_id;
    if(!supplierId) {
      const s=candidate.supplier;
      supplierId=(await db.prepare('INSERT INTO suppliers(name,country,tax_number) VALUES(?,?,?)').run(s.name,s.country,s.tax_number)).lastInsertRowid!;
    }
    if(preview.bankLink) await linkBankSupplierForVat(preview.bankLink.entryId,preview.bankLink.version,supplierId,actor);
    const savedKey=candidate.rule_key==='new'?randomUUID():candidate.rule_key;
    await db.prepare('INSERT INTO vat_supplier_rules(supplier_id,rule_key,active,config,actor) VALUES(?,?,true,?,?)').run(supplierId,savedKey,JSON.stringify(candidate.config),actor);
    await refreshBankSupplierLinks(actor);
    // Refresh can uncover a shared payment-processor IBAN after adding a rule.
    // Never report successful activation if its unreviewed sample stays blocked.
    if(!await row("SELECT 1 FROM vat_reviews WHERE source_kind='transaction' AND source_id=?",input.sampleId)) {
      const context=(await ruleContexts()).get(input.sampleId)??{postings:[],batch:false};
      const result=classifySupplier(candidate.config.sampleSource!,context,await supplierRules());
      if(!result.lines||result.rule?.supplier_id!==supplierId||result.rule.rule_key!==savedKey) throw new Error(`De voorbeeldboeking blijft geblokkeerd. ${result.reason??'Controleer de leverancierskoppeling en overlappende regels.'} Controleer de voorvertoning en koppel de bankmutatie zo nodig aan de gekozen leverancier.`);
    }
    return supplierId;
  })();
}
export async function disableSupplierRule(supplierId:number,expectedRule:number,actor:string) {
  return db.transaction(async()=>{
    await db.prepare('SELECT pg_advisory_xact_lock(713055)').all();
    const selected=await row<SupplierRule>('SELECT * FROM vat_supplier_rules WHERE supplier_id=? AND id=?',supplierId,expectedRule);
    const rule=selected?await row<SupplierRule>('SELECT * FROM vat_supplier_rules WHERE supplier_id=? AND rule_key=? ORDER BY id DESC LIMIT 1',supplierId,selected.rule_key):undefined;
    if(!rule||rule.id!==expectedRule||!rule.active) throw new Error('De regel is gewijzigd. Vernieuw de pagina.');
    await db.prepare('INSERT INTO vat_supplier_rules(supplier_id,rule_key,active,config,actor) VALUES(?,?,false,?,?)').run(supplierId,rule.rule_key,JSON.stringify(rule.config),actor);
    await refreshBankSupplierLinks(actor);
  })();
}
