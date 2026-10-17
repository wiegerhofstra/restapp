import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Workspace } from './service';
import { roundingDescription } from './calculation.ts';

export function csvCell(value:unknown) {
  let text=String(value??'');
  // Free text must never become a spreadsheet formula. Numeric cells stay numeric.
  if(typeof value!=='number'&&/^[\s]*[=+\-@\t\r]/.test(text)) text=`'${text}`;
  return `"${text.replaceAll('"','""')}"`;
}
export function vatCsv(data:Workspace,label:string) {
  const records:unknown[][]=[['VAT return',`${data.year} Q${data.quarter}`,label],['Fingerprint',data.fingerprint],['Rounding',roundingDescription(data.rounding)],['Review items',data.blockers.length],[],
    ['Rubric','Description','Taxable base EUR (exact)','VAT EUR (exact)','Taxable base EUR (return)','VAT EUR (return)'],
    ...data.totals.map(r=>[r.code,r.label,r.base===null?'':r.base/100,r.tax===null?'':r.tax/100,r.baseEuros??'',r.taxEuros??'']),
    ['Balance: positive payable / negative refundable','', '',data.balanceCents/100,'',data.balanceEuros],[],
    ['Source','ID','Description','Booking/invoice date','VAT date','Rubric','Base EUR','VAT EUR','Deductible %','Review status','Document/reason','Review ID','Reviewed by','Reviewed at'],
  ];
  for(const e of data.entries) {
    const prefix=[e.source.kind,e.source.id,e.source.description,e.source.date];
    const audit=[e.state,e.review?.note??'',e.review?.id??'',e.review?.actor??'',e.review?.created_at?new Date(e.review.created_at).toISOString():''];
    if(!e.lines.length) records.push([...prefix,'','Excluded / unclassified','','','',...audit]);
    for(const l of e.lines) records.push([...prefix,l.date,l.code,l.base/100,l.tax/100,l.deductibleBps/100,...audit]);
  }
  records.push([],['Outstanding review items'],...data.blockers.map(b=>[b]));
  return '\uFEFF'+records.map(record=>record.map(csvCell).join(',')).join('\r\n');
}

export async function vatPdf(data:Workspace,label:string) {
  const pdf=await PDFDocument.create();
  const font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.setTitle(`Omzetbelasting ${data.year} Q${data.quarter} - ${label}`);
  let page=pdf.addPage([595.28,841.89]),y=795;
  // The built-in PDF fonts cannot encode arbitrary customer names; replace only
  // unsupported glyphs rather than letting a description break the export.
  const clean=(text:string)=>Array.from(text).map(c=>{try{font.encodeText(c);return c;}catch{return '?';}}).join('');
  const write=(text:string,size=10,strong=false)=>{
    const words=clean(text).split(/\s+/);let line='';
    const draw=()=>{if(y<55){page=pdf.addPage([595.28,841.89]);y=795;}page.drawText(line,{x:42,y,size,font:strong?bold:font,color:rgb(.1,.14,.12)});y-=size+6;};
    for(const word of words){if(font.widthOfTextAtSize(`${line} ${word}`,size)>505&&line){draw();line='';}line+=(line?' ':'')+word;}
    draw();
  };
  write(`Omzetbelasting ${data.year} - Q${data.quarter}`,20,true);
  write(label,12,true);write(`${data.start} to ${data.end}`);
  if(data.blockers.length) write(`DRAFT: ${data.blockers.length} review items remain. Do not file these unverified figures.`,11,true);
  write('Declaration amounts in whole euros. Exact VAT shown in parentheses.');y-=12;
  for(const r of data.totals) write(`${r.code}  ${r.label}  |  Omzet: ${r.baseEuros??'-'}  |  Btw: ${r.taxEuros??'-'}${r.tax===null?'':` (${(r.tax/100).toFixed(2)})`}`,10,r.code.startsWith('5'));
  y-=12;write(`${data.balanceEuros<0?'Terug te vragen':'Te betalen'}: EUR ${Math.abs(data.balanceEuros)}`,15,true);
  write(`Exact balance: EUR ${(data.balanceCents/100).toFixed(2)}.`);
  write(roundingDescription(data.rounding));
  write('5a is the sum of rounded VAT fields; balance = 5a - 5b.');
  write(`Fingerprint: ${data.fingerprint}`,7);y-=12;
  write('Supporting evidence',14,true);
  for(const e of data.entries) {
    write(`${e.source.kind} #${e.source.id} - ${e.source.date} - ${e.source.description}`,10,true);
    write(`Review: ${e.state.replaceAll('_',' ')}${e.review?` (#${e.review.id}) - ${e.review.note}`:''}`,9);
    if(!e.lines.length) write('Excluded / no VAT classification',9);
    for(const l of e.lines) write(`${l.date}: ${l.code}, base EUR ${(l.base/100).toFixed(2)}, VAT EUR ${(l.tax/100).toFixed(2)}, deductible ${l.deductibleBps/100}%${l.date<data.start||l.date>data.end?' (outside this quarter)':''}`,9);
    y-=8;
  }
  if(data.blockers.length){write('Outstanding review items',14,true);for(const blocker of data.blockers) write(blocker,9);}
  write('Preparation copy. Filing in Mijn Belastingdienst Zakelijk, ICP, OSS and corrections are separate.',9);
  const pages=pdf.getPages();pages.forEach((p,i)=>p.drawText(`${i+1} / ${pages.length}`,{x:520,y:25,size:8,font}));
  return pdf.save();
}
