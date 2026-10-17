import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dataDirectory = path.join(process.cwd(), "data");
fs.mkdirSync(dataDirectory, { recursive: true });

const databasePath = process.env.STAPP_DATABASE_PATH || path.join(dataDirectory, "stapp.db");

const globalForDatabase = globalThis as unknown as { stappDb?: Database.Database };

export const db = globalForDatabase.stappDb ?? new Database(databasePath);

if (process.env.NODE_ENV !== "production") globalForDatabase.stappDb = db;

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    reference TEXT NOT NULL COLLATE NOCASE,
    address_line1 TEXT NOT NULL DEFAULT '',
    po_box TEXT NOT NULL DEFAULT '',
    postal_code TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',
    tax_number TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    archived_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'on_hold', 'completed', 'archived')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('asset', 'liability', 'equity', 'income', 'expense')),
    parent_id INTEGER REFERENCES accounts(id) ON DELETE RESTRICT,
    can_post INTEGER NOT NULL DEFAULT 1,
    inverted INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_date TEXT NOT NULL,
    description TEXT NOT NULL,
    reference TEXT NOT NULL DEFAULT '',
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS transaction_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    memo TEXT NOT NULL DEFAULT '',
    debit_cents INTEGER NOT NULL DEFAULT 0 CHECK(debit_cents >= 0),
    credit_cents INTEGER NOT NULL DEFAULT 0 CHECK(credit_cents >= 0),
    source_in_cents INTEGER,
    source_out_cents INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK(NOT (debit_cents > 0 AND credit_cents > 0))
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number INTEGER NOT NULL UNIQUE,
    reference_number INTEGER NOT NULL,
    issue_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    concern TEXT NOT NULL,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'sent', 'overdue', 'paid', 'void')),
    paid_date TEXT,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS invoice_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity_milli INTEGER NOT NULL DEFAULT 1000,
    unit_price_cents INTEGER NOT NULL DEFAULT 0,
    tax_rate_basis_points INTEGER NOT NULL DEFAULT 2100,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS time_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL,
    ended_at TEXT,
    billable INTEGER NOT NULL DEFAULT 1,
    hourly_rate_cents INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    total_label TEXT NOT NULL DEFAULT 'Total',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS report_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    side TEXT NOT NULL DEFAULT 'debit' CHECK(side IN ('debit', 'credit', 'net', 'net_debit', 'net_credit')),
    legacy_column TEXT CHECK(legacy_column IN ('in', 'out') OR legacy_column IS NULL),
    total_effect INTEGER NOT NULL DEFAULT 1 CHECK(total_effect IN (-1, 0, 1)),
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    label TEXT NOT NULL DEFAULT '',
    group_name TEXT NOT NULL DEFAULT 'general',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_projects_customer ON projects(customer_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date);
  CREATE INDEX IF NOT EXISTS idx_transaction_lines_transaction ON transaction_lines(transaction_id);
  CREATE INDEX IF NOT EXISTS idx_transaction_lines_account ON transaction_lines(account_id);
  CREATE INDEX IF NOT EXISTS idx_invoices_project ON invoices(project_id);
  CREATE INDEX IF NOT EXISTS idx_time_entries_project ON time_entries(project_id);
`);

// Forward-only compatibility migrations for databases created by earlier builds.
const transactionLineColumns = db.pragma("table_info(transaction_lines)") as { name: string }[];
if (!transactionLineColumns.some((column) => column.name === "source_in_cents")) {
  db.exec("ALTER TABLE transaction_lines ADD COLUMN source_in_cents INTEGER");
  db.exec("ALTER TABLE transaction_lines ADD COLUMN source_out_cents INTEGER");
}
const reportRowColumns = db.pragma("table_info(report_rows)") as { name: string }[];
if (!reportRowColumns.some((column) => column.name === "legacy_column")) {
  db.exec("ALTER TABLE report_rows ADD COLUMN legacy_column TEXT CHECK(legacy_column IN ('in', 'out') OR legacy_column IS NULL)");
}

const customerIndexes = db.pragma("index_list(customers)") as { name: string; unique: number }[];
const hasLegacyReferenceConstraint = customerIndexes.some((index) => {
  if (!index.unique) return false;
  const columns = db.pragma(`index_info('${index.name.replaceAll("'", "''")}')`) as { name: string }[];
  return columns.length === 1 && columns[0].name === "reference";
});
if (hasLegacyReferenceConstraint) {
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE customers_without_unique_reference (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      reference TEXT NOT NULL COLLATE NOCASE,
      address_line1 TEXT NOT NULL DEFAULT '',
      po_box TEXT NOT NULL DEFAULT '',
      postal_code TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      tax_number TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      archived_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO customers_without_unique_reference SELECT * FROM customers;
    DROP TABLE customers;
    ALTER TABLE customers_without_unique_reference RENAME TO customers;
  `);
  db.pragma("foreign_keys = ON");
}

const defaultSettings = [
  ["company_name", "", "Company name", "company"],
  ["company_address", "", "Address", "company"],
  ["company_postal_city", "", "Postal code & city", "company"],
  ["company_country", "", "Country", "company"],
  ["company_tax_number", "", "Tax number", "company"],
  ["company_email", "", "Email", "company"],
  ["company_phone", "", "Phone", "company"],
  ["company_iban", "", "IBAN", "billing"],
  ["invoice_footer", "Payment is due within 30 days.", "Invoice footer", "billing"],
  ["currency", "EUR", "Currency", "billing"],
];

const insertSetting = db.prepare(
  "INSERT OR IGNORE INTO settings (key, value, label, group_name) VALUES (?, ?, ?, ?)",
);
const seedSettings = db.transaction(() => {
  for (const setting of defaultSettings) insertSetting.run(...setting);
});
seedSettings();

export function rows<T>(sql: string, ...params: unknown[]) {
  return db.prepare(sql).all(...params) as T[];
}

export function row<T>(sql: string, ...params: unknown[]) {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function moneyFromInput(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "0").trim().replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

export function required(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`${key.replaceAll("_", " ")} is required`);
  return value;
}

export function optional(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}
