import { db, row, rows } from '../db.ts';
import { matchBankSupplier, normalizeBankPattern, type BankSupplierSource, type BankSupplierRule, type RecognizableSupplier, type BankSupplierMatch } from './bank-matching.ts';

export type SupplierLink={id:number;entry_id:number;supplier_id:number|null;supplier_name:string|null;supplier_active:boolean|null;mode:'automatic'|'manual';status:BankSupplierMatch['status']|'excluded';evidence:BankSupplierMatch['evidence'];version:number};
export async function bankSuppliersReady(){return Boolean((await row<{ready:boolean}>("SELECT to_regclass('bank_supplier_links') IS NOT NULL ready"))?.ready);}
export async function getBankSupplierRules(supplierId?:number) {
  if(!await bankSuppliersReady()) return [];
  return rows<BankSupplierRule>('SELECT * FROM supplier_bank_rules'+(supplierId?' WHERE supplier_id=?':'')+' ORDER BY id',...(supplierId?[supplierId]:[]));
}
export async function getBankSupplierLinks() {
  if(!await bankSuppliersReady()) return new Map<number,SupplierLink>();
  const links=await rows<SupplierLink>('SELECT l.*,s.name supplier_name,s.active supplier_active FROM bank_supplier_links l LEFT JOIN suppliers s ON s.id=l.supplier_id ORDER BY l.entry_id');
  return new Map(links.map(l=>[l.entry_id,l]));
}
async function bankSources(ids?:number[]) {
  return rows<BankSupplierSource>(`SELECT e.id,e.counterparty,e.counterparty_iban,e.description,e.details,e.warning,t.description transaction_description
    FROM bank_entries e LEFT JOIN transactions t ON t.id=e.transaction_id ${ids?'WHERE e.id=ANY(?::bigint[])':''} ORDER BY e.id`,...(ids?[ids]:[]));
}
async function identityRules() {
  return rows<{id:number;supplier_id:number;pattern:string}>(`SELECT r.id,r.supplier_id,r.config->>'pattern' pattern FROM
    (SELECT DISTINCT ON (supplier_id) * FROM vat_supplier_rules ORDER BY supplier_id,id DESC) r
    JOIN suppliers s ON s.id=r.supplier_id WHERE r.active AND s.active AND (r.config->>'supplierVersion')::integer=s.version`);
}
async function writeLink(entryId:number,mode:SupplierLink['mode'],match:Pick<SupplierLink,'supplier_id'|'status'|'evidence'>,actor:string,old?:SupplierLink) {
  // PostgreSQL JSONB reorders keys; compare the evidence structurally in SQL.
  const same=old&&await row("SELECT 1 FROM bank_supplier_links WHERE entry_id=? AND mode=? AND supplier_id IS NOT DISTINCT FROM ?::bigint AND status=? AND evidence=?::jsonb",entryId,mode,match.supplier_id,match.status,JSON.stringify(match.evidence));
  if(same) return false;
  await db.prepare(`INSERT INTO bank_supplier_links(entry_id,supplier_id,mode,status,evidence,actor) VALUES(?,?,?,?,?::jsonb,?)
    ON CONFLICT(entry_id) DO UPDATE SET supplier_id=EXCLUDED.supplier_id,mode=EXCLUDED.mode,status=EXCLUDED.status,evidence=EXCLUDED.evidence,actor=EXCLUDED.actor,version=bank_supplier_links.version+1,updated_at=now()`)
    .run(entryId,match.supplier_id,mode,match.status,JSON.stringify(match.evidence),actor);
  await db.prepare('INSERT INTO bank_supplier_events(entry_id,supplier_id,mode,status,evidence,actor) VALUES(?,?,?,?,?::jsonb,?)')
    .run(entryId,match.supplier_id,mode,match.status,JSON.stringify(match.evidence),actor);
  return true;
}
// Call inside a transaction holding 713055 before acquiring 713053, just like
// bank imports. Manual choices (including "no supplier") are never overwritten.
export async function refreshBankSupplierLinks(actor:string,ids?:number[]) {
  if(!await bankSuppliersReady()) return 0;
  await db.prepare('SELECT pg_advisory_xact_lock(713053)').all();
  const suppliers=await rows<RecognizableSupplier>('SELECT id,name,active FROM suppliers ORDER BY id');
  const rules=await getBankSupplierRules(),vatRules=await identityRules(),links=await getBankSupplierLinks();
  let changed=0;
  for(const entry of await bankSources(ids)) {
    const old=links.get(entry.id);if(old?.mode==='manual') continue;
    if(await writeLink(entry.id,'automatic',matchBankSupplier(entry,suppliers,rules,vatRules),actor,old)) changed++;
  }
  return changed;
}
export async function recognizeBankSuppliers(actor:string) {
  return db.transaction(async()=>{await db.prepare('SELECT pg_advisory_xact_lock(713055)').all();return refreshBankSupplierLinks(actor);})();
}
async function addRule(supplierId:number,field:string,pattern:string,actor:string) {
  const normalized=normalizeBankPattern(field,pattern);
  if(!await row('SELECT 1 FROM suppliers WHERE id=? AND active',supplierId)) throw new Error('Kies een actieve leverancier.');
  await db.prepare(`INSERT INTO supplier_bank_rules(supplier_id,field,pattern,actor) VALUES(?,?,?,?) ON CONFLICT(supplier_id,field,pattern) WHERE active DO NOTHING`).all(supplierId,field,normalized,actor);
}
export async function saveBankSupplierRule(supplierId:number,field:string,pattern:string,actor:string) {
  return db.transaction(async()=>{
    await db.prepare('SELECT pg_advisory_xact_lock(713055)').all();
    await addRule(supplierId,field,pattern,actor);
    return refreshBankSupplierLinks(actor);
  })();
}
export async function disableBankSupplierRule(id:number,actor:string) {
  return db.transaction(async()=>{
    await db.prepare('SELECT pg_advisory_xact_lock(713055)').all();
    const result=await db.prepare('UPDATE supplier_bank_rules SET active=false,disabled_by=?,disabled_at=now() WHERE id=? AND active').run(actor,id);
    if(!result.changes) throw new Error('Deze herkenningsregel is al gewijzigd. Vernieuw de pagina.');
    return refreshBankSupplierLinks(actor);
  })();
}
export async function chooseBankSupplier(entryId:number,version:number,supplierId:number|null,newName:string|null,remember:{field:string;pattern:string}|null,automatic:boolean,actor:string) {
  return db.transaction(async()=>{
    await db.prepare('SELECT pg_advisory_xact_lock(713055)').all();
    await db.prepare('SELECT pg_advisory_xact_lock(713053)').all();
    const entry=(await bankSources([entryId]))[0];if(!entry) throw new Error('Bankmutatie niet gevonden.');
    const old=(await getBankSupplierLinks()).get(entryId);
    if((old?.version??0)!==version) throw new Error('De leverancierskoppeling is gewijzigd. Vernieuw de pagina.');
    if(automatic) {
      const suppliers=await rows<RecognizableSupplier>('SELECT id,name,active FROM suppliers ORDER BY id');
      return writeLink(entryId,'automatic',matchBankSupplier(entry,suppliers,await getBankSupplierRules(),await identityRules()),actor,old);
    }
    if(newName!==null) {
      const name=newName.trim();if(name.length<2||name.length>100) throw new Error('Vul een leveranciersnaam van 2 tot 100 tekens in.');
      if(await row('SELECT id FROM suppliers WHERE lower(trim(name))=lower(?)',name)) throw new Error('Er bestaat al een leverancier met deze naam. Selecteer deze in de lijst.');
      supplierId=(await db.prepare('INSERT INTO suppliers(name) VALUES(?)').run(name)).lastInsertRowid!;
    }
    const supplier=supplierId?await row<RecognizableSupplier>('SELECT id,name,active FROM suppliers WHERE id=? AND active',supplierId):null;
    if(supplierId&&!supplier) throw new Error('Kies een actieve leverancier.');
    if(remember) {
      if(!supplierId) throw new Error('Kies eerst een leverancier voor de herkenningsregel.');
      if(entry.warning||entry.details.length>1) throw new Error('Maak geen herkenningsregel op basis van een verzamelbetaling.');
      const rule={id:0,supplier_id:supplierId,active:true,field:remember.field as BankSupplierRule['field'],pattern:normalizeBankPattern(remember.field,remember.pattern)};
      if(matchBankSupplier(entry,[supplier!],[rule]).evidence.ruleIds.length!==1) throw new Error('De herkenningsregel moet overeenkomen met deze bankmutatie.');
      await addRule(supplierId,remember.field,remember.pattern,actor);
    }
    const evidence:SupplierLink['evidence']={candidates:supplier?[{id:supplier.id,name:supplier.name,reasons:['Handmatig gekozen']}]:[],ruleIds:[],vatRuleIds:[]};
    await writeLink(entryId,'manual',{supplier_id:supplierId,status:supplierId?'matched':'excluded',evidence},actor,old);
    await refreshBankSupplierLinks(actor);
    return true;
  })();
}
