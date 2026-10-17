# Stapp

A modern Next.js port of the original Rails business administration app. It covers customers, projects, double-entry transactions, a chart of accounts, invoices, time tracking, reports and company settings.

## Run locally

```bash
npm install
npm run migrate:auth
npm run migrate:bank
npm run migrate:presets
npm run dev
```

Open `http://localhost:3000`. Application data is stored in PostgreSQL, configured by `DATABASE_URL` in `.env.local`. The imported SQLite data has been migrated to the dedicated `restapp` database; existing login hashes were preserved.

Useful checks:

```bash
npm run lint
npm run build
```

The runtime requires `DATABASE_URL`, `BETTER_AUTH_URL` and `BETTER_AUTH_SECRET`. Use `.env.example` as a reference without replacing an existing `.env.local`. Generate a secret with `openssl rand -base64 32`. `DATABASE_ADMIN_URL` is used only by the provisioning/migration script, never by application queries. The runtime does not create or modify the schema automatically.

## Authentication

Email/password authentication uses [Better Auth's Next.js integration](https://better-auth.com/docs/integrations/next), mounted at `/api/auth/[...all]`. The existing login screen uses the React client; server components and mutations validate database sessions through `currentUser()`.

- Run `npm run migrate:auth` before starting/restarting the app. It creates separate `auth_*` tables and copies legacy user IDs, names, emails and bcrypt hashes in a transaction. Existing passwords continue to work. Legacy tables remain intact; old session cookies are no longer accepted, so users must sign in again.
- The migration is repeatable and records the legacy import once, so it never resets a subsequently changed password. Import legacy data before running this migration.
- Public sign-up is disabled. On an empty auth database, `/setup` creates the first administrator, with a database lock preventing competing setup requests from creating extra accounts. All accounts retain the existing shared-workspace access model.
- New passwords use Better Auth's scrypt hashing; imported bcrypt passwords remain supported. Password whitespace is preserved.
- Sessions last 30 days and use signed HTTP-only cookies. Login requests use PostgreSQL-backed rate limiting. Keep the database and secret private.
- For deployment, set `BETTER_AUTH_URL` to the exact public HTTPS origin and use a unique, stable `BETTER_AUTH_SECRET` of at least 32 characters. The reverse proxy must overwrite forwarded client-IP headers with trustworthy values for per-client rate limiting. Without a resolvable IP, Better Auth uses a shared rate-limit bucket.
- OAuth and email delivery (verification/password reset) are not configured.

Run `npm run test:auth` against a development PostgreSQL database. It uses and removes an isolated schema to verify migration, password compatibility, origin checks, closed registration, session expiry/revocation, rate limiting and concurrent first-run setup.

## Bank statement imports

Open **Bank imports** (`/bank`) and upload an ING CAMT.053 XML statement, choosing the bank's posting asset account. The IBAN-to-ledger mapping is retained. Run `npm run migrate:bank` once before using this feature; it adds import/reconciliation tables and protects reconciled ledger records from edits. It does not rewrite existing accounting data.

The workflow is deliberately reviewed before posting:

1. Import validates EUR amounts, booked status, stable bank references, and opening balance + movements = closing balance. Original XML and statement balances remain in the database for traceability. Uploading does not create accounting transactions.
2. Review suggested matches to existing transactions. Matching requires the same bank account, signed amount, and dates within seven days. Strong suggestions additionally require reference evidence within three days or a shared description on the same day, one candidate, no competing bank entries, and a balanced existing transaction. Select suggestions and confirm them together, or review a payment individually.
3. Check other possible matches individually. Existing imbalances are shown and require acknowledgement; linking never changes ledger lines. The review page also offers exact-amount transactions outside the date window.
4. For a new payment, choose a project if needed and allocate its amount to ledger accounts. Split net amount and VAT explicitly; negative allocations support offsetting lines such as reverse-charge VAT. The app includes the bank line and atomically posts a balanced transaction only when you click **Post transaction**. Possible existing matches require acknowledgement before creating another transaction.
5. Processed payments link back to the ledger. **Correct this match → Unlink transaction** returns a payment to review, retaining the accounting transaction. Unlink before editing or deleting reconciled transactions. Review actions are recorded in an audit history.

Repeated files and overlapping periods reuse existing bank entries and preserve review decisions. Stable entry references are scoped to the IBAN; a changed amount or booking date under the same reference rejects the entire upload. Matching uses bank debits minus credits: money received debits the bank asset account; money paid credits it. Reports use the same ledger amounts, including VAT and refunds. Original `source_in_cents`/`source_out_cents` remain archival evidence only after the standard-ledger migration.

For a database containing the earlier legacy conversion, run `npm run migrate:standard-ledger -- --source <original-pre-PostgreSQL-snapshot.db>` to review the correction plan, then add `--apply` to apply it. It verifies original rows against the snapshot, creates a full PostgreSQL backup, updates the legacy lines/account types/report definitions atomically, and checks all bank links. New transactions and reconciliation decisions are preserved. A migration marker prevents repeat application. See [the migration record](docs/production-migration.md) for the mapping and known source imbalances. `npm run test:standard-ledger` verifies conversion, reports, rollback, and reconciled-ledger protection in an isolated schema.

Supported scope: EUR CAMT.053.001.02, .03 and .08, up to 5 MB and 10,000 entries, one IBAN per file (multiple statements allowed). A grouped bank booking stays **one** bank entry; its underlying details are displayed for review and never imported again as additional movements. Post or link the batch total once, with ledger allocations as needed. Matching one batch to several existing transactions is not supported yet. Files missing stable references or booked opening/closing balances are rejected. Bank fetching and invoice-status updates are not part of this workflow.

Run `npm run test:bank` to check parsing, reconciliation, ambiguous matches, duplicate/overlapping imports, atomic posting, concurrent submissions, ledger protection and undo. Integration fixtures use a disposable PostgreSQL schema, removed afterwards. The private XML in `import/` is optionally validated when present and is never copied into test fixtures or committed.

## Legacy calendar dates

The original Rails import shifted date-only values back one day when converting Amsterdam midnight to UTC. The importer now decodes PostgreSQL `DATE` as a calendar string. The historical correction is recorded in [the migration record](docs/production-migration.md): it restores original transaction, invoice and report dates while preserving newer transactions and edited date fields.

`npm run migrate:dates -- --source <original-import-snapshot.db>` previews the reconstruction; `--apply` backs up and applies it atomically. Use the original affected import snapshot only. The applied migration is repeat-safe. `npm run test:dates` checks timezone handling, correction scope and rollback.

## Posting presets

Open **Settings → Posting presets** (`/settings/presets`) to create, edit or deactivate supplier presets and manage separate recognition rules. Run `npm run migrate:presets` before using them. The migration adds preset/rule/application tables and seeds Netcup, Google Apps (21% reverse charge) and TransIP (Hosting with 21% input VAT) when the matching posting accounts exist. Re-running it preserves edits and does not rewrite transactions.

During bank review, specific counterparty-name, description, or exact-IBAN rules suggest presets. Conflicting matches remain choices; batches or entries with source warnings receive no suggestion. Applying a preset fills editable allocations using the statement amount, with a debit/credit preview. The bank amount and account remain fixed, existing-transaction matching stays available, and only **Post transaction** writes the ledger. Refunds reverse the entries and require explicit acknowledgement. VAT on supplier invoices is split from the gross bank amount; reverse-charge VAT creates equal input/output VAT lines.

For an empty manual transaction, choose the bank account, payment/refund, amount, and whether it is net or total, then apply a preset and review **Post preset entries**. Existing lines are never silently overwritten or appended by presets. Both workflows use the same integer-cent calculation and verify balanced allocations on the server. Editing a preset invalidates older open drafts; refresh and apply it again. An application snapshot retains the original preset settings, generated allocations, reviewed allocations, direction, and actor. Later preset edits leave previous postings and snapshots unchanged.

Run `npm run test:presets` for rounding, gross/net calculations, reverse charge, supplier rules, refunds, repeatable migrations, concurrent posting, stale drafts, ledger protection, and snapshot preservation. Integration records live in a disposable PostgreSQL schema.

## Data and security

- The legacy importer (`import:postgres`) reads the old PostgreSQL source in a read-only transaction and writes a local SQLite file. It is retained for historical imports.
- The new `migrate:postgres` command provisions a dedicated role/database and copies the imported SQLite database into PostgreSQL, verifying every value before configuring `DATABASE_URL`. It refuses to overwrite an existing target.
- Money is stored as integer cents and invoice quantities as thousandths, avoiding floating-point drift.
- Better Auth manages passwords and sessions; see the authentication setup above.
- PostgreSQL foreign keys, unique constraints and checks are enforced. Multi-statement writes use a single connection and a transaction.
- Private migration backups, credentials and reconciliation reports are in `data/backups/`, ignored by git.

## Production-data migration

The new schema is deliberately not a byte-for-byte copy of Rails. See [docs/production-migration.md](docs/production-migration.md) for the completed mapping, reconciliation results and importer usage.

## PostgreSQL verification

```bash
npm run test:postgres
# Also check authenticated routes against the running dev server:
STAPP_TEST_BASE_URL=http://localhost:3000 npm run test:postgres
```

The integration check creates temporary test records and, when checking routes, a temporary Better Auth account and session, then removes them. Run it against a development database.

## Quarterly Dutch VAT returns

Run `npm run migrate:vat` before using **Reports → Quarterly VAT return**. Existing reports also link to the quarter containing their start date. `/reports/vat` opens the most recently completed quarter. The migration adds review and frozen-copy tables; it does not change ledger entries or mark historical items as reviewed.

1. Import and process bank entries, then open the quarter. The worksheet shows rubrieken 1a–5b, exact cents and whole-euro declaration values. Click a rubriek for its evidence or a number to copy the unformatted integer.
2. Review each source. The current legacy VAT account names suggest domestic input/output VAT and EU reverse charge; these are **unverified suggestions**, not supplier-country evidence. Confirm from source documents, edit tax dates independently of bank dates, split treatments/rates, and set deductible percentages. Reverse charges feed both output and deductible VAT. Credit notes use negative amounts. Remove all VAT lines and record a reason for non-VAT movements, transfers, VAT settlements or duplicate invoice payments.
3. Issued invoices appear even when unpaid. Both invoices and ledger transactions require explicit review: include a supply once, and exclude the matching payment with the invoice reference. Duplicate prevention here is a review responsibility, not an automatic invoice/payment matcher. Unrecorded purchase invoices and special adjustments require bookkeeping entries; the completeness check calls these out.
4. Resolve pending bank entries, unbalanced postings, missing classifications and stale reviews. Changing a source invalidates its review. A deleted reviewed source stays visible until its removal is explicitly acknowledged by excluding it with a reason. Save a reviewed copy after checking completeness.
5. Transfer the figures to Mijn Belastingdienst Zakelijk yourself. Return to the live worksheet, enter the submission receipt/reference and choose **Record completed submission**. This does not send a declaration. Reviewed/submitted copies freeze the figures, source postings, VAT dates, review notes and actor. Later changes are flagged without rewriting those copies.
6. Download CSV (rubrics plus evidence) or PDF from the live worksheet or a saved copy. Live exports are labelled draft. Export routes require login and are not cached. Review history and copies are append-only in PostgreSQL.

Declaration rounding is favourable after aggregation per field: signed output VAT and taxable bases round down (floor), while deductible VAT in 5b rounds up (ceiling). Thus negative output VAT becomes more negative and negative deductible VAT becomes less negative. Exact whole euros stay unchanged. 5a sums the rounded output fields, then 5b is subtracted. Tax is never recalculated from rounded bases. New saved copies record the rounding policy; older copies retain their original nearest-euro figures and explanation. Deduction percentages are applied in integer cents per reviewed VAT line. Rubriek 5b is the deductible total; it must not receive reverse-charge VAT a second time. The source amount is not changed when a VAT classification/date is reviewed. No automatic ICP, OSS, suppletie, payment execution or scheme-specific calculation is included.

The implementation follows the [2026 Belastingdienst return explanation](https://download.belastingdienst.nl/belastingdienst/docs/toelichting_bij_btw_aangifte_ob0731t63fd.pdf) and [invoice-system timing guidance](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/btw_aangifte_doen_en_betalen/bereken_het_bedrag/hoe_berekent_u_het_btw_bedrag/factuurstelsel). Invoice dates and supply dates can differ; the reviewer chooses the appropriate date.

`npm run test:vat` exercises calculations, review/submission gates, stale/concurrent changes, immutable snapshots, period moves, unpaid invoices, deletion and export generation in an isolated PostgreSQL schema. Add `STAPP_TEST_BASE_URL=http://localhost:3000` to check anonymous export rejection.
