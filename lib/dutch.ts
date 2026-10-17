// Presentation labels only: persisted statuses, URLs and accounting codes stay stable.
const labels:Record<string,string>={
  draft:'Concept',sent:'Verzonden',overdue:'Vervallen',paid:'Betaald',void:'Geannuleerd',cancelled:'Geannuleerd',
  active:'Actief',on_hold:'Gepauzeerd',completed:'Afgerond',archived:'Gearchiveerd',
  asset:'Activa',liability:'Vreemd vermogen',equity:'Eigen vermogen',income:'Opbrengsten',expense:'Kosten',
  transaction:'Boeking',invoice:'Factuur',rule_applied:'Volgens leveranciersregel',needs_review:'Controle nodig',reviewed:'Gecontroleerd',changed:'Gewijzigd',deleted:'Verwijderd',submitted:'Ingediend',
  linked:'Gekoppeld',created:'Aangemaakt',posted:'Geboekt',unlinked:'Ontkoppeld',link:'Koppelen',unlink:'Ontkoppelen',post:'Boeken',
  payment:'Betaling',refund:'Terugbetaling',both:'Betalingen en terugbetalingen',
  name:'Naam',description:'Omschrijving',iban:'IBAN',company:'Bedrijf',billing:'Facturatie',invoice_settings:'Factuurinstellingen',
  'Company name':'Bedrijfsnaam','Address':'Adres','Postal code & city':'Postcode en plaats','Tax number':'Btw-identificatienummer',
  'Bank account':'Bankrekening','Invoice footer':'Factuurvoettekst','Country':'Land',legacy:'Oorspronkelijke instellingen','Currency':'Valuta','Email':'E-mailadres','Phone':'Telefoonnummer',
  started_at:'Begintijd',ended_at:'Eindtijd',issue_date:'Factuurdatum',due_date:'Vervaldatum',transaction_date:'Boekdatum',reference:'Kenmerk',concern:'Onderwerp',
  invoice_number:'Factuurnummer',start_date:'Begindatum',end_date:'Einddatum',project_id:'Project',customer_id:'Klant',account_id:'Grootboekrekening',
  status:'Status',label:'Omschrijving',total_label:'Omschrijving totaal',side:'Bedragsoort',kind:'Rekeningsoort',
  street:'Straat en huisnummer',postal_code:'Postcode',city:'Plaats',country:'Land',tax_number:'Btw-identificatienummer',
  'Shared payment reference':'Overeenkomstig betalingskenmerk','Shared description':'Overeenkomstige omschrijving','Same date':'Zelfde datum',
  'Same amount and direction':'Zelfde bedrag en betalingsrichting','Existing transaction is unbalanced':'Bestaande boeking is niet in evenwicht',
};
export function labelNl(value:string) {
  if (/^Legacy: footer_[1-7]$/.test(value)) return `Oorspronkelijke voettekst ${value.slice(-1)}`;
  if (value === 'Legacy: own_company_id') return 'Oorspronkelijk bedrijfsnummer';
  return labels[value]??value.replaceAll('_',' ');
}
// Stored bank warnings may predate the Dutch UI. Translate these known system messages,
// never supplier descriptions or other source evidence.
const warnings:Record<string,string>={
  'Batch booking: individual payment details are missing. Review the batch total before linking or posting.':'Verzamelbetaling: details van de afzonderlijke betalingen ontbreken. Controleer het totaal voordat u koppelt of boekt.',
  'Batch booking: review the individual payments below. Link or post the total once.':'Verzamelbetaling: controleer de afzonderlijke betalingen hieronder. Koppel of boek het totaal één keer.',
  'Batch details do not fully explain the booked total. Review the total and any charges before posting.':'De details van de verzamelbetaling sluiten niet aan op het geboekte totaal. Controleer het totaal en eventuele kosten voordat u boekt.',
};
export function bankWarningNl(value:string) {return warnings[value]??value;}
