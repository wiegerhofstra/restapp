export const rubrics = [
  {code:'1a', label:'Leveringen/diensten belast met hoog tarief', base:true, tax:true},
  {code:'1b', label:'Leveringen/diensten belast met laag tarief', base:true, tax:true},
  {code:'1c', label:'Leveringen/diensten belast met overige tarieven, behalve 0%', base:true, tax:true},
  {code:'1d', label:'Privégebruik', base:true, tax:true},
  {code:'1e', label:'Leveringen/diensten belast met 0% of niet bij u belast', base:true, tax:false},
  {code:'2a', label:'Leveringen/diensten waarbij de btw naar u is verlegd', base:true, tax:true},
  {code:'3a', label:'Leveringen naar landen buiten de EU', base:true, tax:false},
  {code:'3b', label:'Leveringen naar/diensten in landen binnen de EU', base:true, tax:false},
  {code:'3c', label:'Installatie/afstandsverkopen binnen de EU', base:true, tax:false},
  {code:'4a', label:'Leveringen/diensten uit landen buiten de EU', base:true, tax:true},
  {code:'4b', label:'Leveringen/diensten uit landen binnen de EU', base:true, tax:true},
  {code:'5a', label:'Verschuldigde btw (rubrieken 1 t/m 4)', base:false, tax:true},
  {code:'5b', label:'Voorbelasting', base:false, tax:true},
] as const;
export function rubricLabel(code:string) {return rubrics.find(r=>r.code===code)?.label??code;}
export type VatCode = Exclude<typeof rubrics[number]['code'], '5a'>;
export type VatLine = {date:string; code:VatCode; base:number; tax:number; deductibleBps:number};
export type VatTotals = {code:string; label:string; base:number|null; tax:number|null; baseEuros:number|null; taxEuros:number|null}[];
export type VatRounding = 'nearest-v1' | 'favourable-v1';
export function roundingDescription(policy?:VatRounding) {
  // Copies saved before rounding policies were recorded used nearest-euro rounding.
  return policy==='favourable-v1'
    ? "Afronding in uw voordeel na optelling per rubriek: verschuldigde btw en grondslagen naar beneden, voorbelasting (5b) naar boven op hele euro’s. Bij negatieve bedragen betekent naar beneden: verder onder nul; naar boven: dichter bij nul."
    : "Bedragen zijn afgerond op de dichtstbijzijnde hele euro. Halve euro’s zijn van nul af afgerond.";
}
export function period(year:number, quarter:number) {
  if(!Number.isInteger(year)||year<2000||year>2100||!Number.isInteger(quarter)||quarter<1||quarter>4) throw new Error("Kies een geldig jaar en kwartaal.");
  const start=`${year}-${String(quarter*3-2).padStart(2,'0')}-01`;
  const end=new Date(Date.UTC(year,quarter*3,0)).toISOString().slice(0,10);
  return {year,quarter,start,end};
}
export function validDate(date:string) {
  const parsed=new Date(`${date}T12:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date>='2000-01-01' && date<='2100-12-31' && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0,10)===date;
}
function deductibleCents(tax:number,bps:number) {
  const amount=BigInt(Math.abs(tax))*BigInt(bps);
  return Math.sign(tax)*Number((amount+BigInt(5000))/BigInt(10000));
}
export function validateLines(input:unknown): VatLine[] {
  if(!Array.isArray(input)||input.length>100) throw new Error("Gebruik maximaal 100 btw-regels.");
  return input.map((l)=>{
    if(!l||typeof l.date!=='string'||!validDate(l.date)) throw new Error("Elke btw-regel moet een geldige btw-datum hebben.");
    const rubric=rubrics.find(r=>r.code===l.code&&r.code!=='5a');
    if(!rubric) throw new Error("Kies een invulbare btw-rubriek.");
    for(const field of ['base','tax','deductibleBps']) if(!Number.isSafeInteger(l[field])) throw new Error("Btw-bedragen moeten in hele centen worden opgegeven.");
    if(Math.abs(l.base)>1e12||Math.abs(l.tax)>1e12||l.deductibleBps<0||l.deductibleBps>10000) throw new Error("Het btw-bedrag of aftrekpercentage valt buiten het toegestane bereik.");
    if(!rubric.tax&&l.tax!==0) throw new Error(`${l.code} heeft geen btw-bedrag.`);
    if(l.base && l.tax && Math.sign(l.base)!==Math.sign(l.tax)) throw new Error("De grondslag en de btw moeten hetzelfde teken hebben. Gebruik negatieve bedragen voor creditnota’s.");
    if(!['2a','4a','4b','5b'].includes(l.code)&&l.deductibleBps!==0) throw new Error("Alleen voorbelasting en verlegde btw kunnen een aftrekpercentage hebben.");
    return {date:l.date,code:l.code,base:l.base,tax:l.tax,deductibleBps:l.deductibleBps};
  });
}
export function calculateVat(lines:VatLine[]) {
  const totals:VatTotals=rubrics.map(r=>({...r,base:r.base?0:null,tax:r.tax?0:null,baseEuros:r.base?0:null,taxEuros:r.tax?0:null}));
  const byCode=new Map(totals.map(r=>[r.code,r]));
  let deductible=0;
  for(const raw of lines) {
    const line=validateLines([raw])[0];
    const r=byCode.get(line.code)!;
    if(r.base!==null) r.base+=line.base;
    if(line.code!=='5b'&&r.tax!==null) r.tax+=line.tax;
    if(['2a','4a','4b','5b'].includes(line.code)) deductible+=deductibleCents(line.tax,line.deductibleBps);
  }
  byCode.get('5b')!.tax=deductible;
  byCode.get('5a')!.tax=totals.filter(r=>!['5a','5b'].includes(r.code)).reduce((n,r)=>n+(r.tax??0),0);
  for(const r of totals) {
    if((r.base!==null&&!Number.isSafeInteger(r.base))||(r.tax!==null&&!Number.isSafeInteger(r.tax))) throw new Error("Het btw-totaal is te groot.");
    r.baseEuros=r.base===null?null:Math.floor(r.base/100);
    // Minimize signed output VAT; maximize the signed deduction. This also
    // handles credit notes: -42.90 output becomes -43, -42.90 input becomes -42.
    // Normalize negative zero for copy/export consistency.
    r.taxEuros=r.tax===null?null:(r.code==='5b'?Math.ceil(r.tax/100):Math.floor(r.tax/100))||0;
  }
  // The declaration total must agree with the whole-euro fields being copied.
  byCode.get('5a')!.taxEuros=totals.filter(r=>!['5a','5b'].includes(r.code)).reduce((n,r)=>n+(r.taxEuros??0),0);
  return {rounding:'favourable-v1' as VatRounding,totals, balanceCents:byCode.get('5a')!.tax!-deductible, balanceEuros:byCode.get('5a')!.taxEuros!-byCode.get('5b')!.taxEuros!};
}
