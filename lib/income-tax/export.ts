import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { categories } from './calculation.ts';
import type { Workspace } from './service.ts';
import { csvCell } from '../vat/export.ts';
import { formatMoney } from '../format.ts';

function records(w:Workspace,label:string):unknown[][] {
  return [
    ['Jaarwerkplek inkomstenbelasting',w.year,label],['Controlekenmerk',w.fingerprint],['Openstaande controles',w.issues.length],
    ['Reikwijdte','Ondernemingsdeel; geen volledige aangifte of belastingberekening. Ondernemersaftrek, mkb-winstvrijstelling, investeringsaftrek en buitenvennootschappelijk vermogen niet automatisch berekend.'],
    ['Winstverdeling',w.config.allocationNote],['Winstverdeling beoordeeld',w.config.allocationReviewed?'Ja':'Nee, voorlopig'],
    ['Boekhoudkundige winst EUR',w.profit/100],[],
    ['Rekening','Rubriek','Begin debet minus credit EUR','Jaarmutatie debet minus credit EUR','Einde debet minus credit EUR','Vennoot'],
    ...w.accountRows.map(a=>[a.name,categories[a.category],a.opening/100,a.movement/100,a.closing/100,w.partners.find(p=>p.key===a.partnerKey)?.name??'']),[],
    ['Vennoot','Resterende winst %','Arbeidsvergoeding EUR','Beginkapitaal EUR','Stortingen EUR','Onttrekkingen EUR','Winstaandeel EUR','Eindkapitaal EUR','Fiscale correcties EUR','Winst na opgegeven correcties EUR'],
    ...w.partners.map(p=>[p.name,p.shareBps/100,p.labourCents/100,p.openingCapital/100,p.deposits/100,p.withdrawals/100,p.profitShare/100,p.closingCapital/100,p.adjustment/100,p.fiscalProfit/100]),
    ['Verschil beginkapitaal met balans EUR',w.openingDifference/100],['Verschil eindkapitaal met balans EUR',w.closingDifference/100],[],
    ['Fiscale correctie','Bedrag EUR','Toerekening'],...w.config.adjustments.map(a=>[a.label,a.amount/100,w.partners.find(p=>p.key===a.partnerKey)?.name??'Volgens winstpercentages']),[],
    ['Openstaande controles'],...w.issues.map(i=>[i]),[],
    ['Bronboekingen tot en met einde boekjaar','Regel','Datum','Omschrijving','Grootboekrekening','Debet EUR','Credit EUR'],
    ...w.sourceLines.map(l=>[l.transactionId,l.id,l.date,l.description,w.accountRows.find(a=>a.id===l.accountId)?.name??l.accountId,l.debit/100,l.credit/100]),[],
    ['Facturen uitsluitend ter controle','Datum','Omschrijving','Status','Betaaldatum','Exclusief btw EUR','Btw EUR'],
    ...w.invoices.map(i=>[i.number,i.date,i.description,i.status,i.paidDate??'',i.net/100,i.tax/100]),
  ];
}
export function incomeTaxCsv(w:Workspace,label:string) {
  return '\uFEFF'+records(w,label).map(r=>r.map(csvCell).join(';')).join('\r\n');
}
export async function incomeTaxPdf(w:Workspace,label:string) {
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.setTitle(`Inkomstenbelasting ${w.year} - ${label}`);
  let page=pdf.addPage([595,842]),y=795;
  const clean=(s:string)=>s.replace(/[\u2010-\u2015]/g,'-').replace(/[^\x20-\x7e\xa0-\xff€]/g,'?');
  function write(text:string,heading=false) {
    const face=heading?bold:font,size=heading?12:10;
    for(const paragraph of clean(text).split('\n')) {
      let line='';
      // Wrap even very long references without letting them spill outside the page.
      for(const char of paragraph) {
        if(face.widthOfTextAtSize(line+char,size)>499){draw(line);line='';}
        line+=char;
      }
      draw(line);y-=5;
    }
    function draw(line:string){if(y<50){page=pdf.addPage([595,842]);y=795;}page.drawText(line,{x:48,y,size,font:face,color:rgb(.12,.18,.16)});y-=15;}
  }
  write(`Inkomstenbelasting ${w.year}`,true);write(label,true);
  write(`Openstaande controles: ${w.issues.length}. Ondernemingsdeel; geen volledige aangifte of berekening van verschuldigde belasting.`);
  write('Ondernemersaftrek, mkb-winstvrijstelling, investeringsaftrek en buitenvennootschappelijk vermogen zijn niet automatisch berekend.');
  write(`Winstverdeling: ${w.config.allocationReviewed?'beoordeeld':'VOORLOPIG'}. ${w.config.allocationNote}`);
  write('Winst-en-verliesrekening',true);
  for(const [key,name] of Object.entries(categories).filter(([key])=>['revenue','other_income','cost_of_sales','staff','depreciation','other_costs'].includes(key)))write(`${name}: ${formatMoney(w.accountRows.filter(a=>a.category===key).reduce((n,a)=>n+a.value,0))}`);
  write(`Boekhoudkundige winst: ${formatMoney(w.profit)}`,true);
  write('Balans: begin / einde',true);
  for(const a of w.accountRows.filter(a=>['fixed_assets','receivables','cash','other_assets','debts'].includes(a.category)&&(a.opening||a.closing||a.count))) {
    const sign=a.category==='debts'?-1:1;write(`${categories[a.category]} - ${a.name}: ${formatMoney(sign*a.opening)} / ${formatMoney(sign*a.closing)}`);
  }
  write(`Eigen vermogen: ${formatMoney(w.openingNetAssets)} / ${formatMoney(w.closingNetAssets)}`);
  for(const p of w.partners){
    write(`Persoonlijk overzicht: ${p.name}`,true);
    write(`Resterende winst: ${p.shareBps/100}%. Arbeidsvergoeding als winstverdeling: ${formatMoney(p.labourCents)}.`);
    for(const [name,amount] of Object.entries({Beginkapitaal:p.openingCapital,Privéstortingen:p.deposits,Privéonttrekkingen:p.withdrawals,Winstaandeel:p.profitShare,Eindkapitaal:p.closingCapital,'Aanvullende fiscale correcties':p.adjustment,'Winst na opgegeven correcties (vóór ondernemersaftrek en mkb-winstvrijstelling)':p.fiscalProfit}))write(`${name}: ${formatMoney(amount)}`);
  }
  write(`Verschil kapitaal met balans: begin ${formatMoney(w.openingDifference)}, einde ${formatMoney(w.closingDifference)}.`);
  if(w.config.adjustments.length){write('Onderbouwing fiscale correcties',true);for(const a of w.config.adjustments)write(`${a.label}: ${formatMoney(a.amount)} - ${w.partners.find(p=>p.key===a.partnerKey)?.name??'Volgens winstpercentages'}`);}
  write('Openstaande controles',true);if(!w.issues.length)write('Geen openstaande controles in deze versie.');for(const issue of w.issues)write(issue);
  write('Herkomst',true);write('Berekend uit het grootboek met de vastgelegde jaarindeling. Facturen tellen niet afzonderlijk mee als omzet. De CSV bevat de bronboekingen en factuurcontrole.');write(`Controlekenmerk: ${w.fingerprint}`);
  return pdf.save();
}
