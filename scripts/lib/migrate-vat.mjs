export async function migrateVat(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS vat_reviews (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      source_kind text NOT NULL CHECK(source_kind IN ('transaction','invoice')),
      source_id bigint NOT NULL,
      source_hash text NOT NULL,
      source_snapshot jsonb NOT NULL,
      lines jsonb NOT NULL CHECK(jsonb_typeof(lines)='array'),
      note text NOT NULL,
      actor text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS vat_review_source ON vat_reviews(source_kind,source_id,id DESC);
    CREATE TABLE IF NOT EXISTS vat_snapshots (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      year integer NOT NULL CHECK(year BETWEEN 2000 AND 2100),
      quarter integer NOT NULL CHECK(quarter BETWEEN 1 AND 4),
      status text NOT NULL CHECK(status IN ('reviewed','submitted')),
      fingerprint text NOT NULL,
      payload jsonb NOT NULL,
      receipt text NOT NULL DEFAULT '',
      previous_id bigint REFERENCES vat_snapshots(id),
      actor text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS vat_snapshot_period ON vat_snapshots(year,quarter,id DESC);
    CREATE TABLE IF NOT EXISTS suppliers (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
      country text NOT NULL DEFAULT '', tax_number text NOT NULL DEFAULT '',
      active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS vat_supplier_rules (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      supplier_id bigint NOT NULL REFERENCES suppliers(id),
      active boolean NOT NULL, config jsonb NOT NULL,
      actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS vat_supplier_rules_latest ON vat_supplier_rules(supplier_id,id DESC);
    ALTER TABLE vat_supplier_rules ADD COLUMN IF NOT EXISTS rule_key text NOT NULL DEFAULT 'default';
    CREATE INDEX IF NOT EXISTS vat_supplier_rules_versions ON vat_supplier_rules(supplier_id,rule_key,id DESC);
    CREATE TABLE IF NOT EXISTS supplier_bank_rules (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      supplier_id bigint NOT NULL REFERENCES suppliers(id),
      field text NOT NULL CHECK(field IN ('iban','name','description')),
      pattern text NOT NULL, active boolean NOT NULL DEFAULT true,
      actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      disabled_by text, disabled_at timestamptz
    );
    CREATE UNIQUE INDEX IF NOT EXISTS supplier_bank_rules_active ON supplier_bank_rules(supplier_id,field,pattern) WHERE active;
    CREATE TABLE IF NOT EXISTS bank_supplier_links (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      entry_id bigint NOT NULL UNIQUE REFERENCES bank_entries(id),
      supplier_id bigint REFERENCES suppliers(id),
      mode text NOT NULL CHECK(mode IN ('automatic','manual')),
      status text NOT NULL CHECK(status IN ('matched','unmatched','ambiguous','batch','excluded')),
      evidence jsonb NOT NULL, version integer NOT NULL DEFAULT 1,
      actor text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS bank_supplier_links_supplier ON bank_supplier_links(supplier_id);
    CREATE TABLE IF NOT EXISTS bank_supplier_events (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      entry_id bigint NOT NULL REFERENCES bank_entries(id), supplier_id bigint REFERENCES suppliers(id),
      mode text NOT NULL, status text NOT NULL, evidence jsonb NOT NULL,
      actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE OR REPLACE FUNCTION protect_vat_history() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'VAT review and submission history is append-only.'; END $$;
    DROP TRIGGER IF EXISTS vat_reviews_immutable ON vat_reviews;
    CREATE TRIGGER vat_reviews_immutable BEFORE UPDATE OR DELETE ON vat_reviews FOR EACH ROW EXECUTE FUNCTION protect_vat_history();
    DROP TRIGGER IF EXISTS vat_snapshots_immutable ON vat_snapshots;
    CREATE TRIGGER vat_snapshots_immutable BEFORE UPDATE OR DELETE ON vat_snapshots FOR EACH ROW EXECUTE FUNCTION protect_vat_history();
    DROP TRIGGER IF EXISTS vat_supplier_rules_immutable ON vat_supplier_rules;
    CREATE TRIGGER vat_supplier_rules_immutable BEFORE UPDATE OR DELETE ON vat_supplier_rules FOR EACH ROW EXECUTE FUNCTION protect_vat_history();
    DROP TRIGGER IF EXISTS bank_supplier_events_immutable ON bank_supplier_events;
    CREATE TRIGGER bank_supplier_events_immutable BEFORE UPDATE OR DELETE ON bank_supplier_events FOR EACH ROW EXECUTE FUNCTION protect_vat_history();
  `);
}
