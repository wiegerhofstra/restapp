"use server";

import { currentUser } from "@/lib/auth";
import { db, moneyFromInput, optional, required } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

async function authorized() {
  if (!(await currentUser())) redirect("/login");
}

function numberValue(formData: FormData, key: string, fallback = 0) {
  const value = Number(formData.get(key));
  return Number.isFinite(value) ? value : fallback;
}

function checked(formData: FormData, key: string) {
  return formData.get(key) === "on" || formData.get(key) === "1";
}

function nullableId(formData: FormData, key: string) {
  const value = numberValue(formData, key);
  return value > 0 ? value : null;
}

export async function saveCustomer(customerId: number | null, formData: FormData) {
  await authorized();
  const values = [
    required(formData, "name"),
    required(formData, "reference").toUpperCase(),
    optional(formData, "address_line1"),
    optional(formData, "po_box"),
    optional(formData, "postal_code"),
    optional(formData, "city"),
    optional(formData, "country"),
    optional(formData, "tax_number"),
    optional(formData, "email"),
    optional(formData, "phone"),
  ];
  if (customerId) {
    (await db.prepare(`UPDATE customers SET name=?, reference=?, address_line1=?, po_box=?, postal_code=?, city=?,
      country=?, tax_number=?, email=?, phone=?, updated_at=CURRENT_TIMESTAMP::text WHERE id=?`).run(...values, customerId));
  } else {
    (await db.prepare(`INSERT INTO customers (name, reference, address_line1, po_box, postal_code, city, country,
      tax_number, email, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...values));
  }
  revalidatePath("/customers");
  redirect("/customers");
}

export async function archiveCustomer(id: number) {
  await authorized();
  (await db.prepare("UPDATE customers SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP::text), updated_at=CURRENT_TIMESTAMP::text WHERE id=?").run(id));
  revalidatePath("/customers");
}

export async function saveProject(projectId: number | null, formData: FormData) {
  await authorized();
  const values = [
    numberValue(formData, "customer_id"),
    required(formData, "name"),
    optional(formData, "description"),
    optional(formData, "status") || "active",
  ];
  if (projectId) {
    (await db.prepare("UPDATE projects SET customer_id=?, name=?, description=?, status=?, updated_at=CURRENT_TIMESTAMP::text WHERE id=?").run(...values, projectId));
  } else {
    (await db.prepare("INSERT INTO projects (customer_id, name, description, status) VALUES (?, ?, ?, ?)").run(...values));
  }
  revalidatePath("/projects");
  redirect("/projects");
}

export async function saveAccount(accountId: number | null, formData: FormData) {
  await authorized();
  const parentId = nullableId(formData, "parent_id");
  if (accountId && parentId === accountId) throw new Error("An account cannot be its own parent");
  const values = [
    required(formData, "name"),
    required(formData, "kind"),
    parentId,
    checked(formData, "can_post") ? 1 : 0,
    checked(formData, "inverted") ? 1 : 0,
  ];
  if (accountId) {
    (await db.prepare("UPDATE accounts SET name=?, kind=?, parent_id=?, can_post=?, inverted=?, updated_at=CURRENT_TIMESTAMP::text WHERE id=?").run(...values, accountId));
  } else {
    const order = (await db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM accounts").get()) as { n: number };
    (await db.prepare("INSERT INTO accounts (name, kind, parent_id, can_post, inverted, sort_order) VALUES (?, ?, ?, ?, ?, ?)").run(...values, order.n));
  }
  revalidatePath("/accounts");
  redirect("/accounts");
}

export async function moveAccount(id: number, direction: "up" | "down") {
  await authorized();
  const current = (await db.prepare("SELECT id, sort_order FROM accounts WHERE id=?").get(id)) as { id: number; sort_order: number } | undefined;
  if (!current) return;
  const operator = direction === "up" ? "<" : ">";
  const ordering = direction === "up" ? "DESC" : "ASC";
  const neighbor = (await db.prepare(`SELECT id, sort_order FROM accounts WHERE sort_order ${operator} ? ORDER BY sort_order ${ordering} LIMIT 1`).get(current.sort_order)) as { id: number; sort_order: number } | undefined;
  if (!neighbor) return;
  (await db.transaction(async () => {
    (await db.prepare("UPDATE accounts SET sort_order=? WHERE id=?").run(neighbor.sort_order, current.id));
    (await db.prepare("UPDATE accounts SET sort_order=? WHERE id=?").run(current.sort_order, neighbor.id));
  })());
  revalidatePath("/accounts");
}

export async function createTransaction(formData: FormData) {
  await authorized();
  const result = (await db.prepare(`INSERT INTO transactions (transaction_date, description, reference, project_id)
    VALUES (?, ?, ?, ?)`).run(
    required(formData, "transaction_date"),
    required(formData, "description"),
    optional(formData, "reference"),
    nullableId(formData, "project_id"),
  ));
  revalidatePath("/transactions");
  redirect(`/transactions/${result.lastInsertRowid}`);
}

export async function updateTransaction(id: number, formData: FormData) {
  await authorized();
  (await db.prepare(`UPDATE transactions SET transaction_date=?, description=?, reference=?, project_id=?, updated_at=CURRENT_TIMESTAMP::text WHERE id=?`).run(
    required(formData, "transaction_date"),
    required(formData, "description"),
    optional(formData, "reference"),
    nullableId(formData, "project_id"),
    id,
  ));
  revalidatePath(`/transactions/${id}`);
  revalidatePath("/transactions");
}

export async function deleteTransaction(id: number) {
  await authorized();
  (await db.prepare("DELETE FROM transactions WHERE id=?").run(id));
  revalidatePath("/transactions");
  redirect("/transactions");
}

export async function addTransactionLine(transactionId: number, formData: FormData) {
  await authorized();
  const debit = moneyFromInput(formData.get("debit"));
  const credit = moneyFromInput(formData.get("credit"));
  if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) throw new Error("Enter either a debit or a credit amount");
  (await db.prepare(`INSERT INTO transaction_lines (transaction_id, account_id, memo, debit_cents, credit_cents)
    VALUES (?, ?, ?, ?, ?)`).run(transactionId, numberValue(formData, "account_id"), optional(formData, "memo"), debit, credit));
  revalidatePath(`/transactions/${transactionId}`);
}

export async function deleteTransactionLine(id: number, transactionId: number) {
  await authorized();
  (await db.prepare("DELETE FROM transaction_lines WHERE id=?").run(id));
  revalidatePath(`/transactions/${transactionId}`);
}

export async function addTaxSplit(transactionId: number, formData: FormData) {
  await authorized();
  const net = moneyFromInput(formData.get("net_amount"));
  const rate = Number(String(formData.get("tax_rate") ?? "21").replace(",", "."));
  if (net <= 0 || !Number.isFinite(rate) || rate < 0) throw new Error("Enter a valid net amount and tax rate");
  const tax = Math.round(net * rate / 100);
  const gross = net + tax;
  const bankAccount = numberValue(formData, "bank_account_id");
  const categoryAccount = numberValue(formData, "category_account_id");
  const taxAccount = numberValue(formData, "tax_account_id");
  const direction = required(formData, "direction");
  const insert = db.prepare(`INSERT INTO transaction_lines (transaction_id, account_id, memo, debit_cents, credit_cents)
    VALUES (?, ?, ?, ?, ?)`);
  (await db.transaction(async () => {
    if (direction === "purchase") {
      (await insert.run(transactionId, categoryAccount, "Net amount", net, 0));
      if (tax) (await insert.run(transactionId, taxAccount, `${rate}% VAT`, tax, 0));
      (await insert.run(transactionId, bankAccount, "Gross payment", 0, gross));
    } else {
      (await insert.run(transactionId, bankAccount, "Gross receipt", gross, 0));
      (await insert.run(transactionId, categoryAccount, "Net amount", 0, net));
      if (tax) (await insert.run(transactionId, taxAccount, `${rate}% VAT`, 0, tax));
    }
  })());
  revalidatePath(`/transactions/${transactionId}`);
}

export async function createInvoice(formData: FormData) {
  await authorized();
  const next = (await db.prepare("SELECT COALESCE(MAX(invoice_number), 0) + 1 AS n FROM invoices").get()) as { n: number };
  const issueDate = required(formData, "issue_date");
  const dueDate = required(formData, "due_date");
  const result = (await db.prepare(`INSERT INTO invoices (invoice_number, reference_number, issue_date, due_date, concern, project_id, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    numberValue(formData, "invoice_number", next.n) || next.n,
    numberValue(formData, "reference_number"),
    issueDate,
    dueDate,
    required(formData, "concern"),
    numberValue(formData, "project_id"),
    optional(formData, "status") || "draft",
    optional(formData, "notes"),
  ));
  revalidatePath("/invoices");
  redirect(`/invoices/${result.lastInsertRowid}`);
}

export async function updateInvoice(id: number, formData: FormData) {
  await authorized();
  const status = required(formData, "status");
  const paidDate = status === "paid" ? optional(formData, "paid_date") || new Date().toISOString().slice(0, 10) : null;
  (await db.prepare(`UPDATE invoices SET invoice_number=?, reference_number=?, issue_date=?, due_date=?, concern=?, project_id=?,
    status=?, paid_date=?, notes=?, updated_at=CURRENT_TIMESTAMP::text WHERE id=?`).run(
    numberValue(formData, "invoice_number"),
    numberValue(formData, "reference_number"),
    required(formData, "issue_date"),
    required(formData, "due_date"),
    required(formData, "concern"),
    numberValue(formData, "project_id"),
    status,
    paidDate,
    optional(formData, "notes"),
    id,
  ));
  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
}

export async function deleteInvoice(id: number) {
  await authorized();
  (await db.prepare("DELETE FROM invoices WHERE id=?").run(id));
  revalidatePath("/invoices");
  redirect("/invoices");
}

export async function addInvoiceLine(invoiceId: number, formData: FormData) {
  await authorized();
  const quantity = Math.round(Number(String(formData.get("quantity") ?? "1").replace(",", ".")) * 1000);
  const taxRate = Math.round(Number(String(formData.get("tax_rate") ?? "21").replace(",", ".")) * 100);
  const order = (await db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM invoice_lines WHERE invoice_id=?").get(invoiceId)) as { n: number };
  (await db.prepare(`INSERT INTO invoice_lines (invoice_id, description, quantity_milli, unit_price_cents, tax_rate_basis_points, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)`).run(invoiceId, required(formData, "description"), quantity, moneyFromInput(formData.get("unit_price")), taxRate, order.n));
  revalidatePath(`/invoices/${invoiceId}`);
}

export async function deleteInvoiceLine(id: number, invoiceId: number) {
  await authorized();
  (await db.prepare("DELETE FROM invoice_lines WHERE id=?").run(id));
  revalidatePath(`/invoices/${invoiceId}`);
}

export async function createTimeEntry(formData: FormData) {
  await authorized();
  const now = new Date().toISOString();
  (await db.prepare(`INSERT INTO time_entries (project_id, name, description, started_at, ended_at, billable, hourly_rate_cents)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    numberValue(formData, "project_id"),
    required(formData, "name"),
    optional(formData, "description"),
    optional(formData, "started_at") || now,
    optional(formData, "ended_at") || null,
    checked(formData, "billable") ? 1 : 0,
    formData.get("hourly_rate") ? moneyFromInput(formData.get("hourly_rate")) : null,
  ));
  revalidatePath("/time");
  redirect("/time");
}

export async function updateTimeEntry(id: number, formData: FormData) {
  await authorized();
  (await db.prepare(`UPDATE time_entries SET project_id=?, name=?, description=?, started_at=?, ended_at=?, billable=?,
    hourly_rate_cents=?, updated_at=CURRENT_TIMESTAMP::text WHERE id=?`).run(
    numberValue(formData, "project_id"),
    required(formData, "name"),
    optional(formData, "description"),
    required(formData, "started_at"),
    optional(formData, "ended_at") || null,
    checked(formData, "billable") ? 1 : 0,
    formData.get("hourly_rate") ? moneyFromInput(formData.get("hourly_rate")) : null,
    id,
  ));
  revalidatePath("/time");
  redirect("/time");
}

export async function stopTimeEntry(id: number) {
  await authorized();
  (await db.prepare("UPDATE time_entries SET ended_at=?, updated_at=CURRENT_TIMESTAMP::text WHERE id=? AND ended_at IS NULL").run(new Date().toISOString(), id));
  revalidatePath("/time");
}

export async function deleteTimeEntry(id: number) {
  await authorized();
  (await db.prepare("DELETE FROM time_entries WHERE id=?").run(id));
  revalidatePath("/time");
}

export async function createReport(formData: FormData) {
  await authorized();
  const result = (await db.prepare("INSERT INTO reports (name, start_date, end_date, total_label) VALUES (?, ?, ?, ?)").run(
    required(formData, "name"),
    required(formData, "start_date"),
    required(formData, "end_date"),
    optional(formData, "total_label") || "Total",
  ));
  revalidatePath("/reports");
  redirect(`/reports/${result.lastInsertRowid}`);
}

export async function updateReport(id: number, formData: FormData) {
  await authorized();
  (await db.prepare("UPDATE reports SET name=?, start_date=?, end_date=?, total_label=?, updated_at=CURRENT_TIMESTAMP::text WHERE id=?").run(
    required(formData, "name"), required(formData, "start_date"), required(formData, "end_date"), optional(formData, "total_label") || "Total", id,
  ));
  revalidatePath(`/reports/${id}`);
  revalidatePath("/reports");
}

export async function duplicateReport(id: number) {
  await authorized();
  const report = (await db.prepare("SELECT * FROM reports WHERE id=?").get(id)) as Record<string, unknown>;
  const result = (await db.prepare("INSERT INTO reports (name, start_date, end_date, total_label) VALUES (?, ?, ?, ?)").run(
    `Copy of ${report.name}`, report.start_date, report.end_date, report.total_label,
  ));
  (await db.prepare(`INSERT INTO report_rows (report_id, label, account_id, side, legacy_column, total_effect, sort_order)
    SELECT ?, label, account_id, side, legacy_column, total_effect, sort_order FROM report_rows WHERE report_id=?`).run(result.lastInsertRowid, id));
  revalidatePath("/reports");
  redirect(`/reports/${result.lastInsertRowid}`);
}

export async function deleteReport(id: number) {
  await authorized();
  (await db.prepare("DELETE FROM reports WHERE id=?").run(id));
  revalidatePath("/reports");
  redirect("/reports");
}

export async function addReportRow(reportId: number, formData: FormData) {
  await authorized();
  const order = (await db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM report_rows WHERE report_id=?").get(reportId)) as { n: number };
  (await db.prepare("INSERT INTO report_rows (report_id, label, account_id, side, total_effect, sort_order) VALUES (?, ?, ?, ?, ?, ?)").run(
    reportId,
    required(formData, "label"),
    numberValue(formData, "account_id"),
    required(formData, "side"),
    numberValue(formData, "total_effect", 1),
    order.n,
  ));
  revalidatePath(`/reports/${reportId}`);
}

export async function deleteReportRow(id: number, reportId: number) {
  await authorized();
  (await db.prepare("DELETE FROM report_rows WHERE id=?").run(id));
  revalidatePath(`/reports/${reportId}`);
}

export async function saveSettings(formData: FormData) {
  await authorized();
  const settings = (await db.prepare("SELECT key FROM settings").all()) as { key: string }[];
  const update = db.prepare("UPDATE settings SET value=?, updated_at=CURRENT_TIMESTAMP::text WHERE key=?");
  (await db.transaction(async () => {
    for (const setting of settings) (await update.run(optional(formData, setting.key), setting.key));
  })());
  revalidatePath("/settings");
}
