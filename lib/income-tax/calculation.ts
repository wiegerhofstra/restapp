export const categories = {
  revenue: 'Netto-omzet', other_income: 'Overige opbrengsten', cost_of_sales: 'Inkoopkosten en uitbesteed werk',
  staff: 'Personeelskosten', depreciation: 'Afschrijvingen', other_costs: 'Overige bedrijfskosten',
  fixed_assets: 'Vaste activa', receivables: 'Vorderingen', cash: 'Liquide middelen', other_assets: 'Overige activa',
  debts: 'Schulden', capital: 'Kapitaalmutaties', withdrawal: 'Privéonttrekkingen', deposit: 'Privéstortingen', unmapped: 'Nog indelen',
} as const;
export type Category = keyof typeof categories;
export const checks = {
  opening: 'Beginbalans en kapitaal per vennoot sluiten aan op het vorige jaar.',
  invoices: 'Facturen, betalingen en openstaande posten zijn volledig en eenmaal verwerkt in het grootboek.',
  accruals: 'Opbrengsten en kosten zijn aan het juiste boekjaar toegerekend.',
  assets: 'Investeringen, afschrijvingen en de waardering van bezittingen en schulden zijn gecontroleerd.',
  private: 'Privégebruik, privéopnamen, stortingen en fiscale correcties zijn gecontroleerd.',
} as const;
export type Partner = { key: string; name: string; shareBps: number; labourCents: number; openingCapital: number };
export type Mapping = { accountId: number; category: Category; partnerKey: string };
export type Adjustment = { label: string; amount: number; partnerKey: string };
export type Config = {
  partners: Partner[]; mappings: Mapping[]; adjustments: Adjustment[];
  allocationNote: string; allocationReviewed: boolean; mappingsReviewed: boolean;
  checks: Record<keyof typeof checks, boolean>; reviewedSourceHash: string;
};
export type LedgerLine = { id: number; transactionId: number; date: string; description: string; accountId: number; debit: number; credit: number };
export type Account = { id: number; name: string; kind: string };
export function validYear(year: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('Kies een boekjaar tussen 2000 en 2100.');
  return year;
}
export function defaultCategory(kind: string): Category {
  return ({income:'revenue',expense:'other_costs',asset:'other_assets',liability:'debts',equity:'capital'} as Record<string,Category>)[kind] ?? 'unmapped';
}
export function defaultConfig(): Config {
  return { partners: [{key:'primary',name:'U',shareBps:10000,labourCents:0,openingCapital:0},{key:'partner',name:'Uw vennoot',shareBps:0,labourCents:0,openingCapital:0}],
    mappings:[], adjustments:[], allocationNote:'Voorlopige afspraak: 100% van de winst aan de werkende vennoot. Rechtsgeldigheid en fiscale verwerking nog te beoordelen.', allocationReviewed:false,mappingsReviewed:false,
    checks:{opening:false,invoices:false,accruals:false,assets:false,private:false},reviewedSourceHash:'' };
}
export function integer(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || Math.abs(value) > 1_000_000_000_000) throw new Error(`${label}: ongeldig bedrag of percentage.`);
  return value;
}
export function validateConfig(input: Config): Config {
  if (!input || !Array.isArray(input.partners) || input.partners.length < 2 || input.partners.length > 20) throw new Error('Voer minimaal twee vennoten in.');
  const keys = new Set<string>();
  const partners = input.partners.map(p => {
    if (!p || !/^[a-zA-Z0-9_-]{1,60}$/.test(p.key) || keys.has(p.key)) throw new Error('Elke vennoot moet een unieke sleutel hebben.');
    keys.add(p.key);
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 100) throw new Error('Vul de naam van iedere vennoot in.');
    integer(p.shareBps,'Winstaandeel'); integer(p.labourCents,'Arbeidsvergoeding'); integer(p.openingCapital,'Beginkapitaal');
    if (p.shareBps < 0 || p.shareBps > 10000 || p.labourCents < 0) throw new Error('Winstaandeel moet tussen 0 en 100% liggen; arbeidsvergoeding mag niet negatief zijn.');
    return {...p,name:p.name.trim()};
  });
  if (partners.reduce((s,p)=>s+p.shareBps,0)!==10000) throw new Error('De winstaandelen moeten samen 100% zijn.');
  if (!Array.isArray(input.mappings) || !Array.isArray(input.adjustments) || input.mappings.length>5000 || input.adjustments.length>200) throw new Error('Ongeldige jaarinstellingen.');
  const ids = new Set<number>();
  const mappings = input.mappings.map(m=>{
    integer(m.accountId,'Grootboekrekening');
    if (m.accountId<=0 || ids.has(m.accountId) || !Object.hasOwn(categories,m.category)) throw new Error('Ongeldige of dubbele grootboekindeling.');
    ids.add(m.accountId);
    if (['withdrawal','deposit','capital'].includes(m.category) && !keys.has(m.partnerKey)) throw new Error('Koppel elke privé- of kapitaalrekening aan een vennoot.');
    return {accountId:m.accountId,category:m.category,partnerKey:['withdrawal','deposit','capital'].includes(m.category)?m.partnerKey:''};
  });
  const adjustments=input.adjustments.map(a=>{
    integer(a.amount,'Fiscale correctie');
    if (typeof a.label!=='string' || !a.label.trim() || a.label.length>500 || (a.partnerKey && !keys.has(a.partnerKey))) throw new Error('Geef iedere fiscale correctie een toelichting en geldige vennoot.');
    return {...a,label:a.label.trim()};
  });
  if (typeof input.allocationNote!=='string' || input.allocationNote.length>4000 || (input.allocationReviewed && !input.allocationNote.trim())) throw new Error('Licht de beoordeelde winstverdeling toe.');
  return {partners,mappings,adjustments,allocationNote:input.allocationNote.trim(),allocationReviewed:input.allocationReviewed===true,mappingsReviewed:input.mappingsReviewed===true,
    checks:Object.fromEntries(Object.keys(checks).map(k=>[k,input.checks?.[k as keyof typeof checks]===true])) as Config['checks'],reviewedSourceHash:''};
}
// Allocate signed cents once; largest remainders preserve the total, including losses.
export function allocate(amount: number, partners: Partner[]) {
  integer(amount,'Te verdelen bedrag');
  const sign=amount<0?-1:1, total=BigInt(Math.abs(amount));
  const parts=partners.map((p,i)=>({i,value:Number(total*BigInt(p.shareBps)/BigInt(10000)),remainder:total*BigInt(p.shareBps)%BigInt(10000)}));
  let rest=Math.abs(amount)-parts.reduce((s,p)=>s+p.value,0);
  for (const p of [...parts].sort((a,b)=>a.remainder===b.remainder?a.i-b.i:a.remainder>b.remainder?-1:1)) { if(rest--<=0) break; p.value++; }
  return parts.map(p=>p.value===0?0:p.value*sign);
}
export function calculateYear(year: number, accounts: Account[], lines: LedgerLine[], config: Config) {
  validYear(year);
  const start=`${year}-01-01`,end=`${year}-12-31`, issues:string[]=[];
  const mappings=new Map(config.mappings.map(m=>[m.accountId,m]));
  const accountRows=accounts.map(a=>{
    const mapping=mappings.get(a.id), category=mapping?.category??defaultCategory(a.kind);
    const own=lines.filter(l=>l.accountId===a.id && l.date<=end);
    const opening=own.filter(l=>l.date<start).reduce((s,l)=>s+l.debit-l.credit,0);
    const current=own.filter(l=>l.date>=start);
    const movement=current.reduce((s,l)=>s+l.debit-l.credit,0);
    const creditNormal=['revenue','other_income','debts','capital','deposit'].includes(category);
    return {...a,category,partnerKey:mapping?.partnerKey??'',opening,movement,closing:opening+movement,value:creditNormal?-movement:movement,count:current.length,mapped:!!mapping};
  });
  const assets=accountRows.filter(a=>['fixed_assets','receivables','cash','other_assets'].includes(a.category));
  const debts=accountRows.filter(a=>a.category==='debts');
  const sum=(list:typeof accountRows,key:'opening'|'closing'|'value')=>list.reduce((s,a)=>s+a[key],0);
  const openingNetAssets=sum(assets,'opening')+sum(debts,'opening');
  const closingNetAssets=sum(assets,'closing')+sum(debts,'closing');
  const revenue=sum(accountRows.filter(a=>['revenue','other_income'].includes(a.category)),'value');
  const costs=sum(accountRows.filter(a=>['cost_of_sales','staff','depreciation','other_costs'].includes(a.category)),'value');
  const profit=revenue-costs;
  const labour=config.partners.reduce((s,p)=>s+p.labourCents,0);
  const residual=allocate(profit-labour,config.partners);
  const commonCorrections=allocate(config.adjustments.filter(a=>!a.partnerKey).reduce((s,a)=>s+a.amount,0),config.partners);
  const partners=config.partners.map((p,i)=>{
    const own=accountRows.filter(a=>a.partnerKey===p.key);
    const withdrawals=own.filter(a=>a.category==='withdrawal').reduce((s,a)=>s+a.value,0)+own.filter(a=>a.category==='capital').reduce((s,a)=>s+Math.max(0,a.movement),0);
    const deposits=own.filter(a=>a.category==='deposit').reduce((s,a)=>s+a.value,0)+own.filter(a=>a.category==='capital').reduce((s,a)=>s+Math.max(0,-a.movement),0);
    const profitShare=p.labourCents+residual[i];
    const adjustment=commonCorrections[i]+config.adjustments.filter(a=>a.partnerKey===p.key).reduce((s,a)=>s+a.amount,0);
    return {...p,withdrawals,deposits,profitShare,adjustment,fiscalProfit:profitShare+adjustment,closingCapital:p.openingCapital+deposits-withdrawals+profitShare};
  });
  const openingDifference=partners.reduce((s,p)=>s+p.openingCapital,0)-openingNetAssets;
  const closingDifference=partners.reduce((s,p)=>s+p.closingCapital,0)-closingNetAssets;
  if(openingDifference!==0) issues.push('Het beginkapitaal van de vennoten sluit niet aan op het eigen vermogen van de beginbalans.');
  if(closingDifference!==0) issues.push('Het eindkapitaal van de vennoten sluit niet aan op het eigen vermogen van de eindbalans.');
  if(accountRows.some(a=>(a.opening||a.movement||a.closing||a.count)&&(!a.mapped||a.category==='unmapped'))) issues.push('Controleer en sla de indeling van alle gebruikte grootboekrekeningen op.');
  if(accountRows.some(a=>['withdrawal','deposit','capital'].includes(a.category)&&!config.partners.some(p=>p.key===a.partnerKey))) issues.push('Er zijn privé- of kapitaalrekeningen zonder vennoot.');
  const transactions=new Map<number,{id:number;date:string;description:string;balance:number}>();
  for(const l of lines.filter(l=>l.date<=end)) {
    const t=transactions.get(l.transactionId)??{id:l.transactionId,date:l.date,description:l.description,balance:0};t.balance+=l.debit-l.credit;transactions.set(t.id,t);
  }
  const unbalanced=[...transactions.values()].filter(t=>t.balance!==0);
  if(unbalanced.length) issues.push(`${unbalanced.length} boeking(en) tot en met dit jaar zijn niet in evenwicht; dit beïnvloedt ook de beginbalans.`);
  return {year,start,end,accountRows,revenue,costs,profit,labour,openingNetAssets,closingNetAssets,openingDifference,closingDifference,partners,unbalanced,issues};
}
