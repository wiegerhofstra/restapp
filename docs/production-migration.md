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

## Original mappings (before the standard-ledger correction below)

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

## Original import reconciliation

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

## Standard debit/credit correction — 17 October 2026

The original Rails conversion preserved its display calculations but incorrectly put both bank receipts and payments on the debit side. The shared adapter in `lib/legacy-ledger.ts` now maps the reviewed source chart to conventional bookkeeping: bank receipts debit assets, payments credit assets, purchases debit expenses and recoverable VAT, and sales credit revenue and VAT payable. VAT accounts are reclassified as assets/liabilities; the reverse-charge input account no longer uses an inversion flag. VAT settlement/refund accounts retain their separate identities.

The correction identifies original rows by exact membership and column comparison against `data/backups/stapp-before-postgres-2026-10-17T10-14-07-537Z.db`. It changes 2,889 of the 4,577 legacy lines and ten account definitions, preserving raw source amounts. The two source refunds on transactions 1017 and 1135 have guarded sign corrections supported by their equal incoming bank lines. New bank transaction 1535 and all reconciliation links remain unchanged.

All 541 legacy report definitions now use ledger debit/credit amounts. Net debit/credit selections include refunds; bank movement reports and reports explicitly listing both directions retain gross selections. Four report totals change: Jaaromzet 2015 by +€40, Jaaromzet 2023 by +€286, Jaaromzet 2025 by +€50, and Omzetbelasting 2026 K3 by −€4.49 (the newly posted input VAT). The historical importer uses this same mapping for future fresh imports.

The conversion reduces unbalanced transactions from 32 to six. These remaining source discrepancies need accounting review; no balancing entries are invented:

| Transaction | Description | Debit minus credit |
| --- | --- | ---: |
| 135 | Belastingdienst Kleine ondernemings regeling | −€1,292.00 |
| 219 | Voorschot | €150.00 |
| 263 | TransIP F0000.2015.0018.6070 | −€0.40 |
| 330 | Voorschot Netwerk instalatie ZAM | €2,500.00 |
| 537 | Factuur 120 WAX-10 | €2.36 |
| 565 | Correctie factuur waxle | −€2.36 |

Run `npm run migrate:standard-ledger -- --source <original-snapshot.db>` for a dry run. Add `--apply` only for the reviewed correction. Apply takes the bank advisory lock and write locks, creates a consistent full PostgreSQL archive with `pg_dump`, and writes before/after records and reconciliation details in a private `data/backups/standard-ledger-<timestamp>/` directory. Changes, constraint updates, and the migration marker commit together. It verifies the entire affected tables against the plan and all linked bank amounts; a second run makes no changes. `npm run test:standard-ledger` checks conversion, refunds, VAT, reports, preservation of new data, rollback, and restoration of reconciliation protection.

Recovery: use `pg_restore` on `before.dump` into a separate database, verify it, then switch application configuration during a maintenance window. Restore the matching pre-correction code as well, because its matcher/reporting conventions differ. Reconcile any writes since the backup before switching; never overwrite the active database blindly.

Applied backup/audit directory: `data/backups/standard-ledger-2026-10-17T11-14-22.642Z/`. The archive is readable by `pg_restore`; all 27 linked bank entries were verified, and the complete bank-entry/audit tables and transaction 1535's lines match the pre-correction backup exactly. Reapplying exits without changes. Migration tests, bank tests, lint, TypeScript, production build and 34 authenticated route checks pass. Browser checks confirm legacy transaction 1531 now credits the bank, transaction 1535 remains balanced, and report 68 includes €79.11 input VAT. Next.js reports no runtime errors.

## Calendar-date correction — 17 October 2026

The original Rails importer let `pg` decode PostgreSQL `DATE` as a JavaScript Date at local midnight, then truncated `toISOString()`. In Europe/Amsterdam this shifted calendar dates back one day in both winter and summer. `scripts/lib/calendar-dates.mjs` now supplies a connection-specific PostgreSQL DATE decoder that retains validated `YYYY-MM-DD` strings, rejects accidental Date objects, and performs due-date arithmetic in UTC. Timestamp decoding is unchanged.

The live Rails source and its former SSH tunnel were unavailable. Historical correction therefore reconstructs the inverse of the reproduced importer bug using exact row membership in `stapp-before-postgres-2026-10-17T10-14-07-537Z.db`, with creation-identity checks and comparisons of each current date against that saved import snapshot. This is reconstruction from the imported snapshot, not a new comparison against the original Rails database. Any date edited since the snapshot is preserved and listed for review; rows added afterward are excluded.

Applied `2026-10-legacy-calendar-dates-v1`: 2,359 date fields on 1,522 original transactions, 242 invoices (issue, derived due and non-null payment dates), and 62 reports. No date fields required skipping. All 12 newer transactions, ledger lines, statement dates, bank links, review history, and preset audit records were verified unchanged. The 29 already-linked historical transactions keep their links. All 62 report totals remain unchanged; Q3 2026 now runs July 1–September 30. All 14 pending candidate matches now have the same calendar date as the statement (10 are strong suggestions; four still need review for other matching evidence).

The full consistent PostgreSQL backup, before/after records, source hash, field-by-field changes and commit record are in `data/backups/calendar-dates-2026-10-17T15-38-56.924Z/`. The archive was verified readable with `pg_restore`. Apply uses bank and table write locks, temporarily disables only the reconciled-transaction protection trigger inside the transaction, verifies the entire planned result, restores protection, and commits a migration marker. Repeating the command makes no changes.

Commands: `npm run migrate:dates -- --source <original-import-snapshot.db>` produces a dry run; `--apply` performs the backed-up correction. Use only a snapshot containing the affected original Rails import, never a current or corrected snapshot. `npm run test:dates` covers four process timezones, actual PostgreSQL DATE decoding, DST/leap/year boundaries, null dates, preservation of edited/new records, atomic rollback, bank protection and repeat application. Lint and browser verification pass.
