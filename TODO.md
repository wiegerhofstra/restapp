# Stapp improvement checklist

Based on the application review of 17 October 2026. Completed tasks are checked below. Prioritize accounting correctness and lifecycle safeguards after the private-data exposure fix.

- [x] **1. Critical — Prevent private data in anonymous responses.** Completed 18 October 2026. All 35 private pages and the workspace layout await the shared `requireUser()` guard before private queries or rendering. The production regression suite reproduces the original failure against the old build and verifies anonymous HTML, RSC navigation and prefetch, expired/revoked sessions, authenticated access, exports, and first-run setup against synthetic data in a disposable schema. Development response checks and authenticated browser navigation also passed. Run `npm run build` followed by `npm run test:auth-pages` to repeat the production verification.
  Sources: `app/(app)/layout.tsx`, private page entry points, `lib/auth.ts`, `scripts/tests/auth-pages.mjs`.

- [ ] **2. High — Unify invoice calculations and rounding.** Use one calculation policy across invoice lists, previews, dashboard totals, and reports. PostgreSQL integer division currently truncates values where previews round them. At review time, 77 of 242 invoices differed between calculations, with a total absolute difference of €1.44. Cover fractional quantities, tax rates, and negative credit lines in regression tests.
  Sources: `app/(app)/invoices/page.tsx`, `app/(app)/invoices/[id]/preview/page.tsx`, `app/(app)/page.tsx`, `lib/income-tax/service.ts`.

- [ ] **3. High — Correct cancelled-invoice handling.** Standardize the invoice status vocabulary: the database and UI use `void`, while VAT suggestions and part of annual invoice selection check `cancelled`. Ensure cancelled invoices receive the appropriate review treatment and test every supported status in both tax modules. The current manual-review gate must remain intact.
  Sources: `lib/vat/service.ts`, `lib/income-tax/service.ts`, `app/(app)/invoices/invoice-form.tsx`.

- [ ] **4. High — Validate money and other form inputs consistently.** Replace the permissive money parser with exact decimal-to-cent parsing, reusing the stricter preset implementation where appropriate. Reject unsupported input with field errors instead of converting it to zero; `1.234,56` currently becomes zero. Validate dates, quantities, tax rates, safe integer ranges, IDs, and posting-account eligibility on the server. Preserve valid negative amounts for workflows that support credits and refunds.
  Sources: `lib/db.ts`, `lib/presets/calculation.ts`, `app/actions.ts`.

- [ ] **5. High — Preserve issued invoices and their original details.** Add an explicit issuing step that freezes invoice number, lines, totals, and customer/company details. Prevent unrestricted editing or deletion of issued invoices; record corrections separately with an audit trail. Verify that later address or settings changes do not alter historical invoice output.
  Sources: `app/actions.ts`, `app/(app)/invoices/[id]/page.tsx`, `app/(app)/invoices/[id]/preview/page.tsx`.

- [ ] **6. High — Separate draft and posted bookkeeping.** Introduce a draft/posted lifecycle and require balanced lines before posting. Keep incomplete records distinct from posted totals and reports. Preserve known historical exceptions explicitly instead of silently rewriting them. At review time there were six unbalanced and three empty transactions. Extend audit history and correction workflows to manual transactions while preserving bank reconciliation protections.
  Sources: `app/actions.ts`, `app/(app)/transactions/[id]/page.tsx`, account/report queries, `scripts/lib/migrate-bank.mjs`.

- [ ] **7. High — Patch dependency findings.** Update affected dependencies to compatible patched releases and rerun build, runtime, integration, and dependency checks. The review-time production audit flagged `next`, `sharp`, and `source-map-js` with one critical and two high package-level ratings. Assess advisory reachability separately: no `next/og` usage matching the critical ImageResponse advisory was found in this app.
  Sources: `package.json`, `package-lock.json`; [Next.js advisory](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j), [sharp advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w), [source-map-js advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).

- [ ] **8. Medium — Normalize time-entry timestamps.** Interpret submitted local times using an explicit timezone and store instants consistently, preferably as PostgreSQL `timestamptz`. Resolve the current mix of offset-free manual entries and UTC timer timestamps. Validate end times and test daylight-saving transitions, server timezone differences, and agreement between dashboard and time-list totals. Plan migration of existing timestamp formats explicitly.
  Sources: `app/(app)/time/time-form.tsx`, `app/actions.ts`, `lib/format.ts`, `app/(app)/page.tsx`.

- [ ] **9. Medium — Handle concurrent edits and duplicate submissions.** Allocate invoice numbers atomically instead of relying on `MAX(invoice_number) + 1`. Add version checks to older edit forms and prevent duplicate creates or line additions. Return useful conflict messages and test concurrent requests and stale tabs. Reuse the supplier and preset modules' concurrency patterns.
  Sources: `app/actions.ts`, `lib/suppliers/service.ts`, `lib/presets/service.ts`.

- [ ] **10. Medium — Standardize form feedback.** Add inline validation errors, preserved input after failure, pending states, and clear save confirmation to customer, project, invoice, settings, and manual bookkeeping forms. Ensure feedback is accessible and that errors do not force users to re-enter an entire form.
  Sources: `app/actions.ts`, legacy form components, newer bank/supplier/tax forms as examples.

- [ ] **11. Medium — Make currency behavior consistent.** Enforce EUR throughout the current EUR-only workflow, or explicitly design full multi-currency support with currencies on records and conversion rules. Prevent a settings change from merely relabeling stored amounts inconsistently across screens. Test invoice previews, lists, dashboard totals, reports, and bank imports together.
  Sources: `lib/format.ts`, `app/(app)/settings/page.tsx`, `app/(app)/invoices/[id]/preview/page.tsx`, `lib/bank/camt.ts`.

- [ ] **12. Medium — Reduce full-history loading and processing.** Add server-side pagination and filtering to unbounded lists. Narrow bank candidates by account, amount, and date, and reduce repeated entry loads. Restrict tax queries where safe while preserving cross-period reviews, deleted-source evidence, and cumulative opening balances. Benchmark with larger datasets before and after changes.
  Sources: `lib/bank/service.ts`, `lib/bank/matching.ts`, `lib/vat/service.ts`, `lib/income-tax/service.ts`, list pages.

- [ ] **13. Medium — Fix mobile information loss and keyboard navigation.** Keep account balances visible on mobile; all 32 balances were hidden at the tested mobile width. Make the closed sidebar inert, manage focus when opening/closing it, support Escape, and expose current-page state. Verify keyboard and screen-reader behavior; the closed sidebar currently leaves 12 offscreen controls focusable.
  Sources: `app/globals.css`, `components/app-shell.tsx`, `app/(app)/accounts/page.tsx`.

- [ ] **14. Medium — Broaden regression coverage and automate checks.** Add focused tests for anonymous response contents, invoice arithmetic and lifecycle, cancelled status, manual posting validation, timestamp handling, concurrent edits, and mobile keyboard navigation. Provide an aggregate verification command and CI with an isolated database. Retain existing reconciliation, supplier-rule, migration, and tax-snapshot coverage.
  Sources: `scripts/tests/`, `package.json`; no repository CI configuration was present at review time.

- [ ] **15. Medium — Support reproducible installation on an empty database.** Add a PostgreSQL baseline migration and an ordered migration runner, independent of an existing SQLite snapshot. Test a fresh installation through first-user setup. Document the supported Node version, environment configuration, and migration order. Preserve the existing legacy-import workflow separately.
  Sources: `README.md`, `scripts/migrate-to-postgres.mjs`, `scripts/lib/`, `lib/sqlite.ts`, `package.json`.

- [ ] **16. Lower — Simplify maintenance and document operations.** Format densely compressed source files, centralize domain types and repeated calculations, and separate substantial queries from rendering. Document and verify scheduled backups, restore procedures, deployment migrations, and error monitoring. Migration backups already exist; ongoing backup and monitoring systems outside the repository were not verified.
  Sources: page and service modules, `lib/db.ts`, `docs/production-migration.md`, `README.md`.

- [ ] **17. Product — Connect invoices and payments.** Support explicit invoice/payment links, partial payments, and reviewable duplicate-VAT prevention. Keep matching suggestions subject to confirmation where evidence is ambiguous.

- [ ] **18. Product — Attach source documents.** Allow invoices, receipts, and other evidence to be attached to transactions and tax reviews, with authenticated access and durable references from saved review history.

- [ ] **19. Product — Generate invoice drafts from billable time.** Select billable entries, generate draft lines, and retain links that prevent billing the same work twice. Define how edits, cancellations, and credits affect those links.

- [ ] **20. Product — Improve search and filters.** Add relevant date, customer, project, and status filters to invoices, time entries, customers, and projects. Preserve filters in URLs and coordinate with server-side pagination.

- [ ] **21. Product — Make the dashboard actionable.** Surface unbalanced and empty transactions, pending bank entries, and outstanding reviews with direct links. Show individual problem counts because a single net ledger difference can conceal offsetting errors.

- [ ] **22. Product — Add account recovery and optional stronger authentication.** Provide a secure recovery flow and consider MFA or passkeys. Introduce roles if the workspace expands beyond equally trusted users; preserve the current shared-workspace model unless that scope changes.

Review baseline: lint, TypeScript, production build, and nine isolated integration suites passed; 27 authenticated page requests succeeded. Those results do not cover all defects above. Recheck each task with targeted verification before marking it complete.

Preserve existing safeguards throughout this work: transactional imports, ambiguity-aware matching, reconciled-ledger protection, stale-review detection, immutable tax snapshots, and isolated integration tests.
