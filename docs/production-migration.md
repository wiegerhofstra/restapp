# Production migration plan

The legacy PostgreSQL database was imported into the local Stapp SQLite database on 4 September 2026. The reusable importer reads PostgreSQL in a repeatable-read, read-only transaction and writes SQLite atomically. It refuses to run unless all target business tables are empty.

Run it against another empty target with connection values supplied through the environment (never commit the password):

```bash
STAPP_SOURCE_HOST=127.0.0.1 \
STAPP_SOURCE_PORT=5555 \
STAPP_SOURCE_DATABASE=stapp \
STAPP_SOURCE_USER=stapp \
STAPP_SOURCE_PASSWORD='…' \
npm run import:postgres
```

## Important mappings

| Rails | Stapp | Transformation |
| --- | --- | --- |
| `customers` | `customers` | Rename address and tax fields; preserve the Rails id in an importer-only mapping table. |
| `projects` | `projects` | Add `status = active`; translate customer ids through the mapping table. |
| `accounts.account_type` | `accounts.kind` | `1 → asset`, `2 → expense`, `3 → income`; retain hierarchy, ordering, posting and inversion flags. |
| `stransactions` | `transactions` | Rename `date` to `transaction_date`; preserve descriptions and project references. |
| `items.in/out` | `transaction_lines.debit_cents/credit_cents` | Convert amounts to integer cents using the Rails account-type/inversion rules. Compatibility columns retain the original `in`/`out` values for exact legacy reporting. |
| `invoices` | `invoices` | Rename fields; map `payed` to `paid` or `sent`; derive a due date from the configured payment term when absent. |
| `invoice_items` | `invoice_lines` | Convert amount to thousandths, prices to cents and tax percentages to basis points. |
| `trackers` | `time_entries` | Rename timestamps and set billable defaults explicitly. |
| `reports` / `report_items` | `reports` / `report_rows` | Convert in/out to debit/credit and the two booleans to `total_effect` (`-1`, `0`, or `1`). |
| `settings` | `settings` | Map known invoice/company keys; preserve unknown keys in an import audit file. |
| `users` | `users` | Do not copy Devise password hashes blindly. Prefer a password reset or verify bcrypt compatibility first. |

## Import reconciliation

- 1 user, 35 customers, 47 projects and 32 visible accounts imported. The hidden Rails root account was intentionally flattened out.
- 1,522 transactions and 4,577 lines imported. The 1,490 balanced and 32 pre-existing unbalanced transactions match the Rails calculation.
- 242 invoices and 543 invoice lines imported, with aggregate invoice values matching exactly.
- 62 reports and 541 report rows imported. Every report row matches its Rails result to the cent.
- Duplicate customer reference codes were preserved rather than rewritten.
- All SQLite foreign keys pass validation.

## Cutover sequence

1. Take a consistent, read-only production snapshot.
2. Run a dry-run importer that only reports row counts, broken references, duplicate invoice numbers/references, precision changes, and unbalanced transactions.
3. Fix or explicitly waive every reported inconsistency.
4. Import into a new empty Stapp database in dependency order: customers, projects, accounts, transactions/lines, invoices/lines, time, reports/rows, settings, users.
5. Reconcile counts and financial totals per account, project, invoice, tax rate and report period.
6. Perform a short write freeze, take a final snapshot, repeat the import and reconciliation, then switch over.

The importer should be idempotent and never mutate the Rails source database.

## SQLite to PostgreSQL cutover — 17 October 2026

Created database `restapp`, owned by login `restapp`, on the server configured by `DATABASE_ADMIN_URL`. The login has no superuser, database creation, role creation, replication or row-security bypass privileges. Public database access was revoked. Application connections use the separate `DATABASE_URL` stored in `.env.local` with mode 0600.

Migrated all 13 tables: users (1), sessions (2), customers (35), projects (47), accounts (32), transactions (1,522), transaction lines (4,577), invoices (242), invoice lines (543), time entries (1), reports (62), report rows (541), settings (18). Every column of every row was compared via a canonical SHA-256 digest before committing. Foreign keys were validated, indexes recreated, and identity sequences advanced to at least the original SQLite high-water marks. Email uniqueness remains case-insensitive. Dates/timestamps retain their original text values.

The source was locked against writes during backup, copy and cutover. Its records remain unchanged in `data/stapp.db`. Consistent SQLite snapshots, the previous code/configuration archive, recovery credentials and the reconciliation JSON are stored privately under `data/backups/`.

The runtime now uses asynchronous PostgreSQL queries, PostgreSQL date calculations, case-insensitive search and PostgreSQL-compatible grouping. The historical importer uses `lib/sqlite.ts`; it does not use the runtime PostgreSQL connection.

To provision a **new, empty server target** from an imported SQLite file, configure `DATABASE_ADMIN_URL`, ensure `DATABASE_URL` is absent, and run `npm run migrate:postgres`. This is a one-time provisioning tool, not an incremental schema migration command. It refuses existing role/database names, non-empty targets and an already configured runtime URL. After a provisioning attempt that rolled back its data transaction, `STAPP_RESUME_CREDENTIALS` may point to the private credentials file from that attempt; it only resumes into an empty matching target.

Rollback requires both the previous SQLite-backed code and its database/configuration, not just removing `DATABASE_URL`. Before any rollback, reconcile new PostgreSQL writes made after cutover; restoring the old snapshot alone would discard them.

Validation after cutover: all 7,623 records still match SQLite after integration checks; all invoice totals and 541 report-row calculations match; 28 authenticated route requests succeed; PostgreSQL commit/rollback and foreign-key checks pass; production build, TypeScript and lint pass. Next.js reports no compilation or runtime errors.
