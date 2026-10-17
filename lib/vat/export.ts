import { outsideVatReturn, supplierTreatmentLabel } from './supplier-rules.ts';
import { labelNl } from '../dutch.ts';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Workspace } from './service';
import { roundingDescription, rubricLabel } from './calculation.ts';
import { decimalNl, formatDate } from '../format.ts';

function exclusionLabel(entry:Workspace['entries'][number]) {
  if(entry.supplierRule&&outsideVatReturn(entry.supplierRule.config.code)) return supplierTreatmentLabel(entry.supplierRule.config.code);
  return entry.state==='reviewed'?'Niet opgenomen in de btw-aangifte':'Btw-behandeling nog te controleren';
}

export function csvCell(value:unknown) {
  let text=typeof value==='number'?String(value).replace('.',','):String(value??'');
  // Free text must never become a spreadsheet formula. Numeric cells stay numeric.
  if(typeof value!=='number'&&/^[\s]*[=+\-@\t\r]/.test(text)) text=`'${text}`;
  return `"${text.replaceAll('"','""')}"`;
}
export function vatCsv(data:Workspace,label:string) {
  const records:unknown[][]=[["Btw-aangifte",`${data.year} kwartaal ${data.quarter}`,label],["Controlekenmerk",data.fingerprint],["Afronding",roundingDescription(data.rounding)],["Controlepunten",data.blockers.length],[],
    ["Rubriek","Omschrijving","Maatstaf van heffing EUR (exact)","Btw EUR (exact)","Maatstaf van heffing EUR (aangifte)","Btw EUR (aangifte)"],
    ...data.totals.map(r=>[r.code,rubricLabel(r.code),r.base===null?'':r.base/100,r.tax===null?'':r.tax/100,r.baseEuros??'',r.taxEuros??'']),
    ["Saldo: positief te betalen / negatief terug te vragen",'', '',data.balanceCents/100,'',data.balanceEuros],[],
    ["Bron",'ID',"Omschrijving","Boek- of factuurdatum","Btw-datum","Rubriek","Grondslag EUR","Btw EUR","Aftrekbaar %","Controlestatus","Document / toelichting","Controlenummer","Gecontroleerd door","Gecontroleerd op","Leverancier","Leveranciersregel","Onderbouwing leveranciersregel"],
  ];
  for(const e of data.entries) {
    const prefix=[labelNl(e.source.kind),e.source.id,e.source.description,e.source.date];
    const audit=[labelNl(e.state),e.review?.note??'',e.review?.id??'',e.review?.actor??'',e.review?.created_at?new Date(e.review.created_at).toISOString():'',e.supplierRule?.supplier.name??'',e.supplierRule?.id??'',[e.supplierRule?.config.note,e.roundingNote].filter(Boolean).join(' ')];
    if(!e.lines.length) records.push([...prefix,'',exclusionLabel(e),'','','',...audit]);
    for(const l of e.lines) records.push([...prefix,l.date,l.code,l.base/100,l.tax/100,l.deductibleBps/100,...audit]);
  }
  records.push([],["Openstaande controlepunten"],...data.blockers.map(b=>[b]));
  return '\uFEFF'+records.map(record=>record.map(csvCell).join(';')).join('\r\n');
}

export async function vatPdf(data:Workspace,label:string) {
  const pdf=await PDFDocument.create();
  const font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.setTitle(`Omzetbelasting ${data.year} kwartaal ${data.quarter} - ${label}`);
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
  write(`Omzetbelasting ${data.year} - kwartaal ${data.quarter}`,20,true);
  write(label,12,true);write(`${formatDate(data.start)} t/m ${formatDate(data.end)}`);
  if(data.blockers.length) write(`CONCEPT: ${data.blockers.length} openstaande controlepunten. Dien deze ongecontroleerde bedragen niet in.`,11,true);
  write("Aangiftebedragen in hele euro’s. Btw vóór afronding tussen haakjes.");y-=12;
  for(const r of data.totals) write(`${r.code}  ${rubricLabel(r.code)}  |  Omzet: ${r.baseEuros??'-'}  |  Btw: ${r.taxEuros??'-'}${r.tax===null?'':` (${decimalNl(r.tax/100)})`}`,10,r.code.startsWith('5'));
  y-=12;write(`${data.balanceEuros<0?'Terug te vragen':'Te betalen'}: EUR ${Math.abs(data.balanceEuros)}`,15,true);
  write(`Saldo vóór afronding: EUR ${decimalNl(data.balanceCents/100)}.`);
  write(roundingDescription(data.rounding));
  write("5a is de som van de afgeronde btw-bedragen; saldo = 5a - 5b.");
  write(`Controlekenmerk: ${data.fingerprint}`,7);y-=12;
  write("Onderbouwing",14,true);
  for(const e of data.entries) {
    write(`${labelNl(e.source.kind)} #${e.source.id} - ${formatDate(e.source.date)} - ${e.source.description}`,10,true);
    write(`Controle: ${labelNl(e.state)}${e.review?` (#${e.review.id}) - ${e.review.note}`:''}`,9);
    if(e.supplierRule) write(`Leverancier: ${e.supplierRule.supplier.name}, regel #${e.supplierRule.id}. ${e.supplierRule.config.note}`,9);
    if(e.roundingNote) write(e.roundingNote,9);
    if(!e.lines.length) write(exclusionLabel(e),9);
    for(const l of e.lines) write(`${formatDate(l.date)}: ${l.code}, grondslag EUR ${decimalNl(l.base/100)}, btw EUR ${decimalNl(l.tax/100)}, aftrekbaar ${decimalNl(l.deductibleBps/100,2)}%${l.date<data.start||l.date>data.end?" (buiten dit kwartaal)":''}`,9);
    y-=8;
  }
  if(data.blockers.length){write("Openstaande controlepunten",14,true);for(const blocker of data.blockers) write(blocker,9);}
  write("Voorbereidingsversie. Indiening via Mijn Belastingdienst Zakelijk, opgaaf ICP, OSS-melding en suppletie worden afzonderlijk afgehandeld.",9);
  const pages=pdf.getPages();pages.forEach((p,i)=>p.drawText(`${i+1} / ${pages.length}`,{x:520,y:25,size:8,font}));
  return pdf.save();
}
