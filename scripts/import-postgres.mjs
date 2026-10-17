import { calendarDate as dateOnly, calendarDateTypes, addCalendarDays as plusDays } from "./lib/calendar-dates.mjs";
import pg from "pg";
import { db } from "../lib/sqlite.ts";
import { standardAccount, standardLegacyLine, standardReportSide } from "../lib/legacy-ledger.ts";

const { Client } = pg;

const sourceConfig = {
  host: process.env.STAPP_SOURCE_HOST || "127.0.0.1",
  port: Number(process.env.STAPP_SOURCE_PORT || 5555),
  database: process.env.STAPP_SOURCE_DATABASE || "stapp",
  user: process.env.STAPP_SOURCE_USER || "stapp",
  password: process.env.STAPP_SOURCE_PASSWORD || process.env.PGPASSWORD,
  options: "-c default_transaction_read_only=on",
};

if (!sourceConfig.password) {
  throw new Error("Set STAPP_SOURCE_PASSWORD (or PGPASSWORD) before running the importer");
}

const businessTables = [
  "users", "customers", "projects", "accounts", "transactions", "transaction_lines",
  "invoices", "invoice_lines", "time_entries", "reports", "report_rows",
];

for (const table of businessTables) {
  const { count } = db.prepare(`SELECT COUNT(*) count FROM ${table}`).get();
  if (count !== 0) throw new Error(`Target is not empty: ${table} contains ${count} rows`);
}

function iso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value).replace(" ", "T");
}

function scaledInteger(value, decimals) {
  const text = String(value ?? "0").trim();
  const negative = text.startsWith("-");
  const unsigned = text.replace(/^[+-]/, "");
  const [wholeRaw, fractionRaw = ""] = unsigned.split(".");
  const whole = BigInt(wholeRaw || "0");
  const padded = `${fractionRaw}${"0".repeat(decimals + 1)}`;
  const fraction = BigInt(padded.slice(0, decimals) || "0");
  const roundingDigit = Number(padded[decimals] || "0");
  let result = whole * (10n ** BigInt(decimals)) + fraction;
  if (roundingDigit >= 5) result += 1n;
  return Number(negative ? -result : result);
}

const client = new Client({ ...sourceConfig, types: calendarDateTypes });
await client.connect();

try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const readOnly = await client.query("SHOW transaction_read_only");
  if (readOnly.rows[0].transaction_read_only !== "on") throw new Error("Source transaction is not read-only");

  const query = async (sql) => (await client.query(sql)).rows;
  const source = {
    users: await query("SELECT id,name,email,encrypted_password,created_at FROM users ORDER BY id"),
    customers: await query("SELECT id,name,street,postbus,postalcode,city,country,taxnr,reference,created_at,updated_at FROM customers ORDER BY id"),
    projects: await query("SELECT id,name,customer_id,created_at,updated_at FROM projects ORDER BY id"),
    accounts: await query('SELECT id,name,account_type,parent_id,\"order\",can_hold_transactions,inverted,created_at,updated_at FROM accounts ORDER BY id'),
    transactions: await query("SELECT id,date,description,project_id,created_at,updated_at FROM stransactions ORDER BY id"),
    items: await query('SELECT id,description,account_id,\"in\",\"out\",stransaction_id,created_at FROM items ORDER BY id'),
    invoices: await query("SELECT id,idate,refnr,invoicenr,concern,project_id,payed,paydate,created_at,updated_at FROM invoices ORDER BY id"),
    invoiceItems: await query("SELECT id,description,amount,price,tax,invoice_id,created_at FROM invoice_items ORDER BY id"),
    trackers: await query("SELECT id,start_date,end_date,project_id,name,description,created_at,updated_at FROM trackers ORDER BY id"),
    reports: await query("SELECT id,start_date,end_date,name,totalname,created_at,updated_at FROM reports ORDER BY id"),
    reportItems: await query('SELECT id,report_id,name,account_id,\"in\",include_in_total,negative FROM report_items ORDER BY id'),
    settings: await query("SELECT id,name,value FROM settings ORDER BY id"),
  };

  const root = source.accounts.find((account) => account.name === "root" && Number(account.parent_id) < 0);
  const importedAccounts = source.accounts.filter((account) => account.id !== root?.id);
  const accountById = new Map(source.accounts.map((account) => [account.id, account]));
  const legacyAccount = (account) => ({ id: account.id, name: account.name,
    kind: account.account_type === 1 ? "asset" : account.account_type === 2 ? "expense" : "income",
    parent_id: account.parent_id === root?.id || Number(account.parent_id) < 1 ? null : account.parent_id,
    inverted: account.inverted ? 1 : 0 });
  if (source.items.some((item) => item.account_id === root?.id)) throw new Error("Root account unexpectedly contains ledger items");

  const insert = {
    user: db.prepare("INSERT INTO users (id,name,email,password_hash,created_at) VALUES (?,?,?,?,?)"),
    customer: db.prepare(`INSERT INTO customers (id,name,reference,address_line1,po_box,postal_code,city,country,tax_number,email,phone,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`),
    project: db.prepare("INSERT INTO projects (id,customer_id,name,description,status,created_at,updated_at) VALUES (?,?,?,'','active',?,?)"),
    account: db.prepare("INSERT INTO accounts (id,name,kind,parent_id,can_post,inverted,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)"),
    transaction: db.prepare("INSERT INTO transactions (id,transaction_date,description,reference,project_id,created_at,updated_at) VALUES (?,?,?,'',?,?,?)"),
    line: db.prepare(`INSERT INTO transaction_lines (id,transaction_id,account_id,memo,debit_cents,credit_cents,source_in_cents,source_out_cents,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`),
    invoice: db.prepare(`INSERT INTO invoices (id,invoice_number,reference_number,issue_date,due_date,concern,project_id,status,paid_date,notes,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,? ,?,'',?,?)`),
    invoiceLine: db.prepare(`INSERT INTO invoice_lines (id,invoice_id,description,quantity_milli,unit_price_cents,tax_rate_basis_points,sort_order,created_at)
      VALUES (?,?,?,?,?,?,?,?)`),
    time: db.prepare(`INSERT INTO time_entries (id,project_id,name,description,started_at,ended_at,billable,hourly_rate_cents,created_at,updated_at)
      VALUES (?,?,?,?,?,?,1,NULL,?,?)`),
    report: db.prepare("INSERT INTO reports (id,name,start_date,end_date,total_label,created_at,updated_at) VALUES (?,?,?,?,?,?,?)"),
    reportRow: db.prepare(`INSERT INTO report_rows (id,report_id,label,account_id,side,legacy_column,total_effect,sort_order)
      VALUES (?,?,?,?,?,NULL,?,?)`),
    setting: db.prepare(`INSERT INTO settings (key,value,label,group_name,updated_at) VALUES (?,?,?,'legacy',CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,label=excluded.label,group_name='legacy',updated_at=CURRENT_TIMESTAMP`),
    updateSetting: db.prepare("UPDATE settings SET value=?,updated_at=CURRENT_TIMESTAMP WHERE key=?"),
  };

  const importTarget = db.transaction(() => {
    for (const user of source.users) insert.user.run(user.id, user.name || user.email.split("@")[0], user.email.toLowerCase(), user.encrypted_password, iso(user.created_at));
    for (const customer of source.customers) insert.customer.run(customer.id, customer.name, customer.reference, customer.street || "", customer.postbus || "", customer.postalcode || "", customer.city || "", customer.country || "", customer.taxnr || "", "", "", iso(customer.created_at), iso(customer.updated_at));
    for (const project of source.projects) insert.project.run(project.id, project.customer_id, project.name, iso(project.created_at), iso(project.updated_at));
    for (const account of importedAccounts) {
      const converted = standardAccount(legacyAccount(account));
      insert.account.run(account.id, account.name, converted.kind, converted.parent_id, account.can_hold_transactions ? 1 : 0, converted.inverted, account.order ?? account.id, iso(account.created_at), iso(account.updated_at));
    }
    for (const transaction of source.transactions) insert.transaction.run(transaction.id, dateOnly(transaction.date), transaction.description, transaction.project_id, iso(transaction.created_at), iso(transaction.updated_at));
    for (const item of source.items) {
      const account = accountById.get(item.account_id);
      if (!account) throw new Error(`Ledger item ${item.id} references missing account ${item.account_id}`);
      const sourceIn = scaledInteger(item.in, 2);
      const sourceOut = scaledInteger(item.out, 2);
      const converted = standardLegacyLine({id:item.id, transaction_id:item.stransaction_id, account_id:item.account_id, source_in_cents:sourceIn, source_out_cents:sourceOut}, legacyAccount(account));
      insert.line.run(item.id, item.stransaction_id, item.account_id, item.description || "", converted.debit_cents, converted.credit_cents, sourceIn, sourceOut, iso(item.created_at));
    }
    for (const invoice of source.invoices) {
      const issueDate = dateOnly(invoice.idate);
      const dueDate = plusDays(issueDate, 30);
      const status = invoice.payed ? "paid" : dueDate < new Date().toISOString().slice(0, 10) ? "overdue" : "sent";
      insert.invoice.run(invoice.id, invoice.invoicenr, invoice.refnr, issueDate, dueDate, invoice.concern, invoice.project_id, status, dateOnly(invoice.paydate), iso(invoice.created_at), iso(invoice.updated_at));
    }
    const invoiceOrder = new Map();
    for (const line of source.invoiceItems) {
      const order = invoiceOrder.get(line.invoice_id) || 0;
      invoiceOrder.set(line.invoice_id, order + 1);
      insert.invoiceLine.run(line.id, line.invoice_id, line.description, scaledInteger(line.amount, 3), scaledInteger(line.price, 2), Number(line.tax) * 100, order, iso(line.created_at));
    }
    for (const tracker of source.trackers) insert.time.run(tracker.id, tracker.project_id, tracker.name, tracker.description || "", iso(tracker.start_date), iso(tracker.end_date), iso(tracker.created_at), iso(tracker.updated_at));
    for (const report of source.reports) insert.report.run(report.id, report.name, dateOnly(report.start_date), dateOnly(report.end_date), report.totalname || "Total", iso(report.created_at), iso(report.updated_at));
    const reportOrder = new Map();
    for (const reportItem of source.reportItems) {
      const order = reportOrder.get(reportItem.report_id) || 0;
      reportOrder.set(reportItem.report_id, order + 1);
      const effect = reportItem.include_in_total ? (reportItem.negative ? -1 : 1) : 0;
      const separate = source.reportItems.some(other => other.report_id === reportItem.report_id && other.account_id === reportItem.account_id && other.in !== reportItem.in);
      const side = standardReportSide(legacyAccount(accountById.get(reportItem.account_id)), reportItem.in ? "in" : "out", separate);
      insert.reportRow.run(reportItem.id, reportItem.report_id, reportItem.name, reportItem.account_id, side, effect, order);
    }
    for (const setting of source.settings) insert.setting.run(`legacy.${setting.name}`, setting.value || "", `Legacy: ${setting.name}`);

    const companyId = Number(source.settings.find((setting) => setting.name === "own_company_id")?.value);
    const company = source.customers.find((customer) => customer.id === companyId);
    if (company) {
      insert.updateSetting.run(company.name || "", "company_name");
      insert.updateSetting.run(company.street || "", "company_address");
      insert.updateSetting.run([company.postalcode, company.city].filter(Boolean).join(" "), "company_postal_city");
      insert.updateSetting.run(company.country || "", "company_country");
      insert.updateSetting.run(company.taxnr || "", "company_tax_number");
    }
    const footer = source.settings.filter((setting) => /^footer_\d+$/.test(setting.name)).sort((a, b) => a.name.localeCompare(b.name)).map((setting) => setting.value).filter(Boolean).join("\n");
    if (footer) insert.updateSetting.run(footer, "invoice_footer");
    const foreignKeyErrors = db.pragma("foreign_key_check");
  if (foreignKeyErrors.length) throw new Error(`Target foreign-key validation failed: ${JSON.stringify(foreignKeyErrors.slice(0, 5))}`);

  const targetCounts = Object.fromEntries(businessTables.map((table) => [table, db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count]));
  const sourceCounts = {
    users: source.users.length, customers: source.customers.length, projects: source.projects.length,
    accounts: importedAccounts.length, transactions: source.transactions.length, transaction_lines: source.items.length,
    invoices: source.invoices.length, invoice_lines: source.invoiceItems.length, time_entries: source.trackers.length,
    reports: source.reports.length, report_rows: source.reportItems.length,
  };
  for (const [table, count] of Object.entries(sourceCounts)) {
    if (targetCounts[table] !== count) throw new Error(`Count mismatch for ${table}: source ${count}, target ${targetCounts[table]}`);
  }

  const ledger = db.prepare(`SELECT COUNT(*) total,
    SUM(CASE WHEN difference=0 THEN 1 ELSE 0 END) balanced,
    SUM(CASE WHEN difference<>0 THEN 1 ELSE 0 END) unbalanced,
    MAX(ABS(difference)) largest_difference_cents
    FROM (SELECT t.id,COALESCE(SUM(l.debit_cents-l.credit_cents),0) difference FROM transactions t LEFT JOIN transaction_lines l ON l.transaction_id=t.id GROUP BY t.id)`).get();
  const totals = db.prepare("SELECT COALESCE(SUM(source_in_cents),0) source_in_cents,COALESCE(SUM(source_out_cents),0) source_out_cents FROM transaction_lines").get();
    const invoiceTotals = db.prepare("SELECT COALESCE(SUM(quantity_milli*unit_price_cents),0) net_milli_cents FROM invoice_lines").get();

    return { sourceReadOnly: true, imported: targetCounts, ledger, sourceColumnTotals: totals, invoiceTotals };
  });

  const summary = importTarget();
  await client.query("COMMIT");
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end();
}
