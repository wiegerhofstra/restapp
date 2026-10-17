export async function migrateIncomeTax(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS income_tax_account_defaults (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      account_id bigint NOT NULL REFERENCES accounts(id),
      category text NOT NULL, partner_key text NOT NULL DEFAULT '',
      note text NOT NULL, actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS income_tax_configs (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      year integer NOT NULL CHECK(year BETWEEN 2000 AND 2100),
      payload jsonb NOT NULL,
      actor text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS income_tax_configs_year ON income_tax_configs(year,id DESC);
    CREATE TABLE IF NOT EXISTS income_tax_snapshots (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      year integer NOT NULL CHECK(year BETWEEN 2000 AND 2100),
      status text NOT NULL CHECK(status IN ('draft','reviewed')),
      fingerprint text NOT NULL, payload jsonb NOT NULL,
      actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS income_tax_snapshots_year ON income_tax_snapshots(year,id DESC);
    CREATE OR REPLACE FUNCTION protect_income_tax_history() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Income tax history is append-only.'; END $$;
    DROP TRIGGER IF EXISTS income_tax_defaults_immutable ON income_tax_account_defaults;
    CREATE TRIGGER income_tax_defaults_immutable BEFORE UPDATE OR DELETE ON income_tax_account_defaults FOR EACH ROW EXECUTE FUNCTION protect_income_tax_history();
    DROP TRIGGER IF EXISTS income_tax_configs_immutable ON income_tax_configs;
    CREATE TRIGGER income_tax_configs_immutable BEFORE UPDATE OR DELETE ON income_tax_configs FOR EACH ROW EXECUTE FUNCTION protect_income_tax_history();
    DROP TRIGGER IF EXISTS income_tax_snapshots_immutable ON income_tax_snapshots;
    CREATE TRIGGER income_tax_snapshots_immutable BEFORE UPDATE OR DELETE ON income_tax_snapshots FOR EACH ROW EXECUTE FUNCTION protect_income_tax_history();
  `);
}
