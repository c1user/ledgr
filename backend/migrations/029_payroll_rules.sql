-- ============================================================
--  029 — Payroll rules engine (ROADMAP-V5 · Phase 1)
--  Run with: psql $DATABASE_URL -f migrations/029_payroll_rules.sql
--  Then backfill existing businesses:
--    node scripts/seed-payroll-rules.mjs
--
--  Tax rules are DATA, never code. Every rate, table, wage base, cap,
--  and due date the payroll engine will ever use lives here as a
--  versioned, append-only record. New value = new row; a version is
--  selected by (business_id, rule_type, jurisdiction, pay date).
--
--  Rules are PER BUSINESS, following the same pattern as the chart of
--  accounts (coaSeed.js): the placeholder template lives in
--  services/payrollRulesSeed.js, is seeded at registration, and is
--  backfilled for existing businesses by the script above. Per-business
--  scoping is what keeps one tenant from ever editing another tenant's
--  tax data — the app deliberately has no global-admin concept. It also
--  means employer-specific values (SUTA experience rate, CFSE premium)
--  are just ordinary versions of that business's rule, not a special
--  override mechanism.
--
--  verification_status is the safety core of the whole module:
--    - Rows seed as UNVERIFIED with PLAUSIBLE PLACEHOLDER payloads.
--      They are illustrative structure, NOT correct values.
--    - Only a human marks a row VERIFIED (routes enforce owner role;
--      nothing in the codebase ever auto-verifies).
--    - Production-mode payroll hard-fails on any UNVERIFIED rule;
--      sandbox mode watermarks every output
--      ("CÁLCULO NO VERIFICADO — SOLO PRUEBAS").
-- ============================================================

BEGIN;

-- Exclusion constraint below needs gist over scalar columns.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE payroll_rules (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  rule_type           TEXT NOT NULL,
  jurisdiction        TEXT NOT NULL DEFAULT 'PR',   -- 'PR' | 'US'
  payload             JSONB NOT NULL,
  effective_from      DATE NOT NULL,
  effective_to        DATE,                          -- NULL = open-ended
  source_citation     TEXT NOT NULL,                 -- official doc name + URL
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED'
                        CHECK (verification_status IN ('UNVERIFIED', 'VERIFIED')),
  verified_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  verified_at         TIMESTAMPTZ,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  -- VERIFIED rows must carry the attestation timestamp; UNVERIFIED must not.
  CHECK ((verification_status = 'VERIFIED') = (verified_at IS NOT NULL))
);

-- One applicable version per rule per date — two versions of the same
-- rule may never overlap in effective range, so resolution for a given
-- pay date is always unambiguous.
ALTER TABLE payroll_rules ADD CONSTRAINT payroll_rules_no_overlap
  EXCLUDE USING gist (
    business_id WITH =,
    rule_type WITH =,
    jurisdiction WITH =,
    daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
  );

CREATE INDEX idx_payroll_rules_lookup
  ON payroll_rules (business_id, rule_type, effective_from DESC);

-- ── Immutability of verified rules ───────────────────────────
-- Once a row is VERIFIED its identity and payload are frozen. Permitted
-- updates on a verified row: closing it out (effective_to, to supersede
-- with a new version), notes, and a human reverting the verification
-- itself (VERIFIED → UNVERIFIED clears the attestation). Payload fixes
-- happen as NEW rows, so payroll runs that snapshotted the old version
-- stay reproducible. DELETE of a verified row is refused outright.
CREATE OR REPLACE FUNCTION payroll_rules_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.verification_status = 'VERIFIED' THEN
      RAISE EXCEPTION 'Verified payroll rules cannot be deleted — supersede with a new version instead';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.verification_status = 'VERIFIED' THEN
    IF NEW.payload            IS DISTINCT FROM OLD.payload
       OR NEW.business_id     IS DISTINCT FROM OLD.business_id
       OR NEW.rule_type       IS DISTINCT FROM OLD.rule_type
       OR NEW.jurisdiction    IS DISTINCT FROM OLD.jurisdiction
       OR NEW.effective_from  IS DISTINCT FROM OLD.effective_from
       OR NEW.source_citation IS DISTINCT FROM OLD.source_citation THEN
      RAISE EXCEPTION 'Verified payroll rules are immutable — supersede with a new version instead';
    END IF;
  END IF;

  -- Reverting a verification clears the attestation columns.
  IF NEW.verification_status = 'UNVERIFIED' THEN
    NEW.verified_by := NULL;
    NEW.verified_at := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payroll_rules_guard
  BEFORE UPDATE OR DELETE ON payroll_rules
  FOR EACH ROW EXECUTE FUNCTION payroll_rules_guard();

-- ── Sandbox / production mode per employer ───────────────────
-- sandbox: runs allowed, every output watermarked.
-- production: run preflight hard-fails on any UNVERIFIED rule.
ALTER TABLE businesses
  ADD COLUMN payroll_mode TEXT NOT NULL DEFAULT 'sandbox'
    CHECK (payroll_mode IN ('sandbox', 'production'));

COMMIT;
