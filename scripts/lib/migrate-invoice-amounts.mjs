export async function migrateInvoiceAmounts(client) {
  // PostgreSQL numeric ROUND rounds ties away from zero, including credits.
  // Cast before multiplying: bigint operands can overflow before division.
  await client.query(`
    CREATE OR REPLACE VIEW invoice_line_amounts AS
    SELECT l.*, n.net::bigint net_cents, t.tax::bigint tax_cents,
      (n.net + t.tax)::bigint total_cents
    FROM invoice_lines l
    CROSS JOIN LATERAL (
      SELECT ROUND(l.quantity_milli::numeric * l.unit_price_cents / 1000) net
    ) n
    CROSS JOIN LATERAL (
      SELECT ROUND(n.net * l.tax_rate_basis_points / 10000) tax
    ) t;

    CREATE OR REPLACE VIEW invoice_amounts AS
    SELECT i.id invoice_id,
      COALESCE(SUM(l.net_cents), 0)::bigint net_cents,
      COALESCE(SUM(l.tax_cents), 0)::bigint tax_cents,
      COALESCE(SUM(l.total_cents), 0)::bigint total_cents
    FROM invoices i LEFT JOIN invoice_line_amounts l ON l.invoice_id = i.id
    GROUP BY i.id;
  `);
}
