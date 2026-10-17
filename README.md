# Stapp

A modern Next.js port of the original Rails business administration app. It covers customers, projects, double-entry transactions, a chart of accounts, invoices, time tracking, reports and company settings.

## Run locally

```bash
npm install
npm run migrate:auth
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
