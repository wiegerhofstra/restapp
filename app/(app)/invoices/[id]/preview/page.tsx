import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PrintButton } from "@/components/print-button";
import { PageHeader } from "@/components/ui";
import { row, rows } from "@/lib/db";

type Invoice = {
  id: number;
  invoice_number: number;
  reference_number: number;
  issue_date: string;
  due_date: string;
  concern: string;
  customer_name: string;
  reference: string;
  address_line1: string;
  po_box: string;
  postal_code: string;
  city: string;
  country: string;
  tax_number: string;
};

type Line = {
  id: number;
  description: string;
  quantity_milli: number;
  unit_price_cents: number;
  tax_rate_basis_points: number;
};

const formatInvoiceDate = (value: string) =>
  new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T12:00:00`));

const formatInvoiceMoney = (cents: number, currency: string) =>
  new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);

export default async function InvoicePreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const invoice = (await row<Invoice>(
    `SELECT i.*,c.name customer_name,c.reference,c.address_line1,c.po_box,c.postal_code,c.city,c.country,c.tax_number
     FROM invoices i
     JOIN projects p ON p.id=i.project_id
     JOIN customers c ON c.id=p.customer_id
     WHERE i.id=?`,
    id,
  ));
  if (!invoice) notFound();

  const lines = (await rows<Line>("SELECT * FROM invoice_lines WHERE invoice_id=? ORDER BY sort_order,id", id));
  const settings = Object.fromEntries(
    (await rows<{ key: string; value: string }>("SELECT key,value FROM settings")).map((setting) => [setting.key, setting.value]),
  );
  const currency = settings.currency || "EUR";
  const net = lines.reduce(
    (total, line) => total + Math.round((line.quantity_milli * line.unit_price_cents) / 1000),
    0,
  );
  const tax = lines.reduce((total, line) => {
    const base = Math.round((line.quantity_milli * line.unit_price_cents) / 1000);
    return total + Math.round((base * line.tax_rate_basis_points) / 10000);
  }, 0);

  return (
    <>
      <PageHeader
        eyebrow="Afdrukvoorbeeld"
        title={`Factuur #${invoice.invoice_number}`}
        subtitle="Gebruik het afdrukvenster van uw browser om de factuur als pdf op te slaan."
      >
        <Link href={`/invoices/${id}`} className="button">
          <ArrowLeft size={16} /> Terug
        </Link>
        <PrintButton />
      </PageHeader>

      <article className="invoice-paper">
        <div className="invoice-head">
          <div className="invoice-brand">
            <Image src="/logo.svg" alt="" width={66} height={88} priority />
            <div className="invoice-brand-copy">
              <h1>Factuur</h1>
            </div>
          </div>
          <div className="invoice-meta">
            <strong>#{invoice.invoice_number}</strong>
            <p>{formatInvoiceDate(invoice.issue_date)}</p>
            <p>Referentie {invoice.reference}-{invoice.reference_number}</p>
            <p>Vervaldatum {formatInvoiceDate(invoice.due_date)}</p>
          </div>
        </div>

        <div className="invoice-addresses">
          <div>
            <strong>{settings.company_name || "Configureer uw bedrijf bij Instellingen"}</strong>
            <p>{settings.company_address}</p>
            <p>{settings.company_postal_city}</p>
            <p>{settings.company_country}</p>
            <p>{settings.company_tax_number}</p>
          </div>
          <div>
            <strong>{invoice.customer_name}</strong>
            <p>{invoice.address_line1}</p>
            {invoice.po_box && <p>Postbus {invoice.po_box}</p>}
            <p>{invoice.postal_code} {invoice.city}</p>
            <p>{invoice.country}</p>
            <p>{invoice.tax_number}</p>
          </div>
        </div>

        <h2 style={{ fontSize: 20, marginBottom: 18 }}>{invoice.concern}</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Omschrijving</th>
              <th className="numeric">Aantal</th>
              <th className="numeric">Btw</th>
              <th className="numeric">Prijs</th>
              <th className="numeric">Totaal</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const total = Math.round((line.quantity_milli * line.unit_price_cents) / 1000);
              return (
                <tr key={line.id}>
                  <td>{line.description}</td>
                  <td className="numeric">{line.quantity_milli / 1000}</td>
                  <td className="numeric">{line.tax_rate_basis_points / 100}%</td>
                  <td className="numeric">{formatInvoiceMoney(line.unit_price_cents, currency)}</td>
                  <td className="numeric">{formatInvoiceMoney(total, currency)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="invoice-total" style={{ marginTop: 28 }}>
          <div><span>Subtotaal</span><strong>{formatInvoiceMoney(net, currency)}</strong></div>
          <div><span>Btw</span><strong>{formatInvoiceMoney(tax, currency)}</strong></div>
          <div className="grand"><span>Totaal</span><span>{formatInvoiceMoney(net + tax, currency)}</span></div>
        </div>

        <div className="invoice-footer">
          <strong>{settings.invoice_footer}</strong>
          <p className="secondary" style={{ marginTop: 7 }}>
            {[settings.company_iban, settings.company_email, settings.company_phone].filter(Boolean).join(" · ")}
          </p>
        </div>
      </article>
    </>
  );
}
