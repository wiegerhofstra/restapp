import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrateInvoiceAmounts } from '../lib/migrate-invoice-amounts.mjs';

const schema = 'invoice_test_' + randomUUID().replaceAll('-', '');
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
let pool;
await admin.connect();
try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.query(`SET search_path TO ${schema}`);
  await admin.query(`
    CREATE TABLE invoices(id bigint PRIMARY KEY);
    CREATE TABLE invoice_lines(id bigint PRIMARY KEY, invoice_id bigint REFERENCES invoices(id),
      quantity_milli bigint NOT NULL, unit_price_cents bigint NOT NULL, tax_rate_basis_points bigint NOT NULL);
    INSERT INTO invoices VALUES(1),(2),(3),(4);
  `);
  // Expected values are cents, with explicit half-cent and credit examples.
  const cases = [
    [1500, 101, 2100, 152, 32, 184],
    [1000, 1999, 2100, 1999, 420, 2419],
    [1500, -101, 2100, -152, -32, -184],
    [-1500, 101, 2100, -152, -32, -184],
    [500, 1, 0, 1, 0, 1],
    [500, -1, 0, -1, 0, -1],
    [1000, 50, 2100, 50, 11, 61],
    [1000, -50, 2100, -50, -11, -61],
    [1000, 50, 900, 50, 5, 55],
    [1000, -50, 900, -50, -5, -55],
    [1000, 25, 600, 25, 2, 27],
    [1000, -25, 600, -25, -2, -27],
    [1, 1, 2100, 0, 0, 0],
    [0, 1999, 2100, 0, 0, 0],
    // The tax multiplication exceeds bigint, but the final amount is safe.
    [1000, '7000000000000000', 2100, 7000000000000000, 1470000000000000, 8470000000000000],
    [1, '9007199254740991', 0, 9007199254741, 0, 9007199254741],
  ];
  for (const [index, c] of cases.entries()) {
    await admin.query('INSERT INTO invoice_lines VALUES($1,1,$2,$3,$4)', [index + 1, ...c.slice(0, 3)]);
  }
  // Invoice 2 stays empty. Invoice 3 proves rounding is per line, not per invoice.
  await admin.query(`INSERT INTO invoice_lines VALUES
    (100,3,1500,101,2100),(101,3,1500,101,2100),(102,3,1000,-50,900),
    (103,4,1000,50,2100),(104,4,1000,-50,2100)`);
  await admin.query(`ALTER TABLE invoice_lines ADD COLUMN description text DEFAULT '', ADD COLUMN sort_order bigint DEFAULT 0`);
  const before = (await admin.query('SELECT row_to_json(l) data FROM invoice_lines l ORDER BY id')).rows;
  await migrateInvoiceAmounts(admin);
  await migrateInvoiceAmounts(admin);
  assert.deepEqual((await admin.query('SELECT row_to_json(l) data FROM invoice_lines l ORDER BY id')).rows, before);

  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('options', `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  const { getPool, rows, row } = await import('../../lib/db.ts');
  pool = getPool();
  const amounts = await rows('SELECT net_cents,tax_cents,total_cents FROM invoice_line_amounts WHERE invoice_id=1 ORDER BY id');
  for (const [index, amount] of amounts.entries()) {
    assert.deepEqual(Object.values(amount), cases[index].slice(3), `Rounding case ${index + 1}`);
  }
  assert.deepEqual(await row('SELECT * FROM invoice_amounts WHERE invoice_id=2'),
    { invoice_id: 2, net_cents: 0, tax_cents: 0, total_cents: 0 });
  assert.deepEqual(await row('SELECT * FROM invoice_amounts WHERE invoice_id=3'),
    { invoice_id: 3, net_cents: 254, tax_cents: 59, total_cents: 313 });
  assert.deepEqual(await row('SELECT * FROM invoice_amounts WHERE invoice_id=4'),
    { invoice_id: 4, net_cents: 0, tax_cents: 0, total_cents: 0 });
  const { getInvoiceAmounts } = await import('../../lib/invoices.ts');
  assert.deepEqual(await getInvoiceAmounts(2), { lines: [], net: 0, tax: 0, total: 0 });
  const invoice = await getInvoiceAmounts(3);
  assert.deepEqual([invoice.net, invoice.tax, invoice.total], [254, 59, 313]);
  assert.deepEqual(invoice.lines.map(l => l.net_cents), [152, 152, -50]);
  console.log('PASS: fractional quantities, zero/6/9/21% VAT, symmetric credits, half cents, empty and mixed invoices, exact large amounts, repeatable migration without source edits');

  // Quantity multiplication also uses numeric; unsafe final cents must be rejected
  // by the application's bigint parser, including aggregates of safe line amounts.
  await admin.query(`INSERT INTO invoices VALUES(5),(6);
    INSERT INTO invoice_lines(id,invoice_id,quantity_milli,unit_price_cents,tax_rate_basis_points) VALUES(105,5,100000000,100000000000,0),
      (106,6,1000,5000000000000000,0),(107,6,1000,5000000000000000,0)`);
  assert.equal((await admin.query('SELECT net_cents::text value FROM invoice_line_amounts WHERE id=105')).rows[0].value, '10000000000000000');
  await assert.rejects(row('SELECT net_cents FROM invoice_line_amounts WHERE id=105'), /safe range/);
  await assert.rejects(row('SELECT total_cents FROM invoice_amounts WHERE invoice_id=6'), /safe range/);
  console.log('PASS: exact numeric intermediates and rejection of unsafe JavaScript line/invoice totals');
} finally {
  if (pool) await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
}
