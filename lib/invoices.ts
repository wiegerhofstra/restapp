import { rows } from './db.ts';

export type InvoiceLine = {
  id: number;
  description: string;
  quantity_milli: number;
  unit_price_cents: number;
  tax_rate_basis_points: number;
  net_cents: number;
  tax_cents: number;
  total_cents: number;
};

export async function getInvoiceAmounts(id: number) {
  // One statement keeps line amounts and totals on the same database snapshot
  // even when another request edits the invoice while it is being rendered.
  const lines = await rows<InvoiceLine & { invoice_net: number; invoice_tax: number; invoice_total: number }>(`
    SELECT l.*, a.net_cents invoice_net, a.tax_cents invoice_tax, a.total_cents invoice_total
    FROM invoice_line_amounts l JOIN invoice_amounts a ON a.invoice_id=l.invoice_id
    WHERE l.invoice_id=? ORDER BY l.sort_order,l.id`, id);
  return {
    lines,
    net: lines[0]?.invoice_net ?? 0,
    tax: lines[0]?.invoice_tax ?? 0,
    total: lines[0]?.invoice_total ?? 0,
  };
}
