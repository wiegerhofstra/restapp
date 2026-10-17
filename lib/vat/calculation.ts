export const rubrics = [
  {code:'1a', label:'Leveringen/diensten belast met hoog tarief', base:true, tax:true},
  {code:'1b', label:'Leveringen/diensten belast met laag tarief', base:true, tax:true},
  {code:'1c', label:'Overige tarieven, behalve 0%', base:true, tax:true},
  {code:'1d', label:'Privégebruik', base:true, tax:true},
  {code:'1e', label:'0% of niet bij u belast', base:true, tax:false},
  {code:'2a', label:'Verleggingsregelingen binnenland', base:true, tax:true},
  {code:'3a', label:'Leveringen naar landen buiten de EU', base:true, tax:false},
  {code:'3b', label:'Leveringen/diensten naar landen binnen de EU', base:true, tax:false},
  {code:'3c', label:'Installatie/afstandsverkopen binnen de EU', base:true, tax:false},
  {code:'4a', label:'Leveringen/diensten uit landen buiten de EU', base:true, tax:true},
  {code:'4b', label:'Leveringen/diensten uit landen binnen de EU', base:true, tax:true},
  {code:'5a', label:'Verschuldigde omzetbelasting', base:false, tax:true},
  {code:'5b', label:'Voorbelasting', base:false, tax:true},
] as const;
export type VatCode = Exclude<typeof rubrics[number]['code'], '5a'>;
export type VatLine = {date:string; code:VatCode; base:number; tax:number; deductibleBps:number};
export type VatTotals = {code:string; label:string; base:number|null; tax:number|null; baseEuros:number|null; taxEuros:number|null}[];
export type VatRounding = 'nearest-v1' | 'favourable-v1';
export function roundingDescription(policy?:VatRounding) {
  // Copies saved before rounding policies were recorded used nearest-euro rounding.
  return policy==='favourable-v1'
    ? 'Favourable rounding after aggregation: VAT due and taxable bases round down; deductible VAT (5b) rounds up to whole euros. For negative amounts, down means more negative and up means closer to zero.'
    : 'Amounts are rounded to the nearest euro, halves away from zero.';
}
export function period(year:number, quarter:number) {
  if(!Number.isInteger(year)||year<2000||year>2100||!Number.isInteger(quarter)||quarter<1||quarter>4) throw new Error('Choose a valid year and quarter.');
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
  if(!Array.isArray(input)||input.length>100) throw new Error('Use at most 100 VAT lines.');
  return input.map((l)=>{
    if(!l||typeof l.date!=='string'||!validDate(l.date)) throw new Error('Every VAT line needs a valid tax date.');
    const rubric=rubrics.find(r=>r.code===l.code&&r.code!=='5a');
    if(!rubric) throw new Error('Choose an editable VAT rubric.');
    for(const field of ['base','tax','deductibleBps']) if(!Number.isSafeInteger(l[field])) throw new Error('VAT amounts must be whole cents.');
    if(Math.abs(l.base)>1e12||Math.abs(l.tax)>1e12||l.deductibleBps<0||l.deductibleBps>10000) throw new Error('VAT amounts or deduction percentage are out of range.');
    if(!rubric.tax&&l.tax!==0) throw new Error(`${l.code} has no VAT amount.`);
    if(l.base && l.tax && Math.sign(l.base)!==Math.sign(l.tax)) throw new Error('The base and VAT must have the same sign. Use negative amounts for credit notes.');
    if(!['2a','4a','4b','5b'].includes(l.code)&&l.deductibleBps!==0) throw new Error('Only input VAT and reverse charges have deductible VAT.');
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
    if((r.base!==null&&!Number.isSafeInteger(r.base))||(r.tax!==null&&!Number.isSafeInteger(r.tax))) throw new Error('VAT total exceeds the supported amount range.');
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
