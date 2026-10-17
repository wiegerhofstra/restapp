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
    CREATE OR REPLACE FUNCTION protect_vat_history() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'VAT review and submission history is append-only.'; END $$;
    DROP TRIGGER IF EXISTS vat_reviews_immutable ON vat_reviews;
    CREATE TRIGGER vat_reviews_immutable BEFORE UPDATE OR DELETE ON vat_reviews FOR EACH ROW EXECUTE FUNCTION protect_vat_history();
    DROP TRIGGER IF EXISTS vat_snapshots_immutable ON vat_snapshots;
    CREATE TRIGGER vat_snapshots_immutable BEFORE UPDATE OR DELETE ON vat_snapshots FOR EACH ROW EXECUTE FUNCTION protect_vat_history();
  `);
}
