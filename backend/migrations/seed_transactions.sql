-- ============================================================
--  LEDGR — Test Data Seed: 20 Realistic Transactions
--  Compatible with: PostgreSQL + uuid-ossp extension
--  Safe to run on a development/staging database only.
--
--  Pre-requisites (already exist in your DB — do NOT re-insert):
--    business_id : 82825bfe-5b17-41f6-a247-58ff12fd1902  (Acabe Studio)
--    user_id     : 9279ec42-0fe3-4366-904e-539c0a25b8a0  (stevenvalen10@gmail.com)
--    account_id  : 6565119a-e443-4852-ba81-190938101e3e  (Popular Personal — cash)
--
--  OWASP Top 10 (Web) Mitigations Applied:
--  A01 - Broken Access Control     : All rows scoped to the existing
--        business_id — no cross-tenant references.
--  A02 - Cryptographic Failures    : No secrets or PII seeded here.
--  A03 - Injection                 : All values are literal constants —
--        no dynamic SQL or string concatenation.
--  A04 - Insecure Design           : Respects every CHECK constraint
--        (type IN ('income','expense'), total_amount > 0).
--  A05 - Security Misconfiguration : Creates NO new roles or permissions.
--  A06 - Vulnerable Components     : No new extensions used.
--  A07 - Auth Failures             : No credentials seeded.
--  A08 - Software/Data Integrity   : Wrapped in BEGIN/COMMIT —
--        all-or-nothing; no partial corrupt state.
--  A09 - Logging/Monitoring        : created_at timestamps are realistic
--        so log-based anomaly detection is not confused.
--  A10 - SSRF                      : No external URLs in seed data.
--
--  OWASP Top 10 for LLM Applications Mitigations Applied:
--  LLM01 - Prompt Injection        : notes/merchant fields contain only
--          plain business text — no instruction-like strings that could
--          hijack the AI assistant feature.
--  LLM02 - Insecure Output Handling: amounts/dates use typed columns
--          (NUMERIC, DATE) — not free text.
--  LLM03 - Training Data Poisoning : Neutral, realistic language only —
--          no adversarial text patterns.
--  LLM04 - Model DoS               : Notes are short; no large strings
--          that could bloat AI context windows.
--  LLM06 - Sensitive Info Disclosure: No real SSNs, tax IDs, or card
--          numbers embedded in any field.
--  LLM08 - Excessive Agency        : Seed grants no new DB permissions.
--  LLM09 - Overreliance            : Comments document intent so
--          developers don't blindly trust AI-generated figures.
-- ============================================================

BEGIN;

-- ============================================================
--  Categories — scoped to Acabe Studio's business_id.
--  ON CONFLICT DO NOTHING makes this re-runnable safely.
-- ============================================================

INSERT INTO categories (id, business_id, name, type, color, is_system, parent_id)
VALUES
  ('44444444-acab-0000-0000-000000000001', '82825bfe-5b17-41f6-a247-58ff12fd1902', 'Client Revenue',          'income',  '#00C896', TRUE, NULL),
  ('44444444-acab-0000-0000-000000000002', '82825bfe-5b17-41f6-a247-58ff12fd1902', 'Freelance Income',        'income',  '#4F8EF7', TRUE, NULL),
  ('44444444-acab-0000-0000-000000000003', '82825bfe-5b17-41f6-a247-58ff12fd1902', 'Software & Subscriptions','expense', '#4FC3F7', TRUE, NULL),
  ('44444444-acab-0000-0000-000000000004', '82825bfe-5b17-41f6-a247-58ff12fd1902', 'Equipment & Gear',        'expense', '#F7C948', TRUE, NULL),
  ('44444444-acab-0000-0000-000000000005', '82825bfe-5b17-41f6-a247-58ff12fd1902', 'Marketing & Ads',         'expense', '#A259FF', TRUE, NULL),
  ('44444444-acab-0000-0000-000000000006', '82825bfe-5b17-41f6-a247-58ff12fd1902', 'Utilities',               'expense', '#F7934C', TRUE, NULL),
  ('44444444-acab-0000-0000-000000000007', '82825bfe-5b17-41f6-a247-58ff12fd1902', 'Office & Supplies',       'expense', '#81C784', TRUE, NULL),
  ('44444444-acab-0000-0000-000000000008', '82825bfe-5b17-41f6-a247-58ff12fd1902', 'Professional Services',   'expense', '#E85C5C', TRUE, NULL)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
--  20 Transactions — all referencing:
--    business_id : 82825bfe-5b17-41f6-a247-58ff12fd1902
--    account_id  : 6565119a-e443-4852-ba81-190938101e3e  (Popular Personal — cash)
--    created_by  : 9279ec42-0fe3-4366-904e-539c0a25b8a0  (stevenvalen10@gmail.com)
--
--  Merchant/notes are scoped to a creative studio context
--  (Acabe Studio) to match the actual business.
--
--  Security notes:
--  - plaid_tx_id uses "test_tx_" prefix — cannot match real Plaid IDs.
--  - No SQL keywords, template literals, or prompt-like text in notes.
--  - All amounts > 0 (satisfies CHECK constraint).
-- ============================================================

INSERT INTO transactions
  (id, business_id, account_id, created_by, date, merchant, total_amount, type, is_split, receipt_id, plaid_tx_id, notes, created_at)
VALUES

-- ── INCOME ──────────────────────────────────────────────────

(
  'bbbbbbbb-acab-0000-0000-000000000001',
  '82825bfe-5b17-41f6-a247-58ff12fd1902',
  '6565119a-e443-4852-ba81-190938101e3e',
  '9279ec42-0fe3-4366-904e-539c0a25b8a0',
  '2026-01-08',
  'Natura PR',
  3200.00,
  'income',
  FALSE, NULL, 'test_tx_001',
  'Brand identity package — logo, color palette, style guide',
  '2026-01-08 10:15:00+00'
),
(
  'bbbbbbbb-acab-0000-0000-000000000002',
  '82825bfe-5b17-41f6-a247-58ff12fd1902',
  '6565119a-e443-4852-ba81-190938101e3e',
  '9279ec42-0fe3-4366-904e-539c0a25b8a0',
  '2026-01-15',
  'Colmado El Bohío',
  850.00,
  'income',
  FALSE, NULL, 'test_tx_002',
  'Social media content pack — 12 posts + stories',
  '2026-01-15 14:30:00+00'
),
(
  'bbbbbbbb-acab-0000-0000-000000000003',
  '82825bfe-5b17-41f6-a247-58ff12fd1902',
  '6565119a-e443-4852-ba81-190938101e3e',
  '9279ec42-0fe3-4366-904e-539c0a25b8a0',
  '2026-01-22',
  'Upwork — Client Payout',
  1450.00,
  'income',
  FALSE, NULL, 'test_tx_003',
  'Freelance UX project — mobile app wireframes (final milestone)',
  '2026-01-22 09:00:00+00'
),
(
  'bbbbbbbb-acab-0000-0000-000000000004',
  '82825bfe-5b17-41f6-a247-58ff12fd1902',
  '6565119a-e443-4852-ba81-190938101e3e',
  '9279ec42-0fe3-4366-904e-539c0a25b8a0',
  '2026-02-03',
  'Rincón Surf Co.',
  2600.00,
  'income',
  FALSE, NULL, 'test_tx_004',
  'Website redesign — landing page + e-commerce integration',
  '2026-02-03 11:45:00+00'
),
(
  'bbbbbbbb-acab-0000-0000-000000000005',
  '82825bfe-5b17-41f6-a247-58ff12fd1902',
  '6565119a-e443-4852-ba81-190938101e3e',
  '9279ec42-0fe3-4366-904e-539c0a25b8a0',
  '2026-02-17',
  'Fundación Arte Vivo',
  5000.00,
  'income',
  FALSE, NULL, 'test_tx_005',
  'Annual report design and print-ready PDF — Invoice #2026-011',
  '2026-02-17 13:00:00+00'
),
(
  'bbbbbbbb-acab-0000-0000-000000000006',
  '82825bfe-5b17-41f6-a247-58ff12fd1902',
  '6565119a-e443-4852-ba81-190938101e3e',
  '9279ec42-0fe3-4366-904e-539c0a25b8a0',
  '2026-03-04',
  'Café Lucuma',
  1100.00,
  'income',
  FALSE, NULL, 'test_tx_006',
  'Menu redesign and packaging mockups',
  '2026-03-04 10:20:00+00'
),
(
  'bbbbbbbb-acab-0000-0000-000000000007',
  '82825bfe-5b17-41f6-a247-58ff12fd1902',
  '6565119a-e443-4852-ba81-190938101e3e',
  '9279ec42-0fe3-4366-904e-539c0a25b8a0',
  '2026-03-18',
  'Upwork — Client Payout',
  975.00,
  'income',
  FALSE, NULL, 'test_tx_007',
  'Freelance illustration — 5 editorial pieces',
  '2026-03-18 16:10:00+00'
),
(
  'bbbbbbbb-acab-0000-0000-000000000008',
  '82825bfe-5b17-41f6-a247-58ff12fd1902',
  '6565119a-e443-4852-ba81-190938101e3e',
  '9279ec42-0fe3-4366-904e-539c0a25b8a0',
  '2026-04-02',
  'MedicinaHoy PR',
  4200.00,
  'income',
  FALSE, NULL, 'test_tx_008',
  'Full rebrand — logo, business cards, email signature kit',
  '2026-04-02 09:30:00+00'
),

-- ── EXPENSES ────────────────────────────────────────────────

(
  'bbbbbbbb-acab-0000-0000-000000000009',
  '82825bfe-5b17-41f6-a247-58ff12fd1902',
  '6565119a-e443-4852-ba81-190938101e3e',
  '9279ec42-0fe3-4366-904e-539c0a25b8a0',
  '2026-01-05',
  'Adobe Creative Cloud',
  59.99,
  'expense',
  FALSE, NULL, 'test_tx_009',
  'Monthly Creative Cloud subscription — Jan 2026',
  '2026-01-05 08:00:00+00'
),
(
  'bbbbbbbb-acab-0000-0000-000000000010',
  '82825bfe-5b17-41f6-a247-58ff12fd1902',
  '6565119a-e443-4852-ba81-190938101e3e',
  '9279ec42-0fe3-4366-904e-539c0a25b8a0',
  '2026-01-12',
  'B&H Photo Video',
  340.00,
  'expense',
  FALSE, NULL, 'test_tx_010',
  'Wacom stylus replacement + screen calibration tool',
  '2026-01-12 14:50:00+00'
),
(
  'bbbbbbbb-acab-0000-0000-000000000011',
  '82825bfe-5b17-41f6-a247-58ff12fd1902',
  '6565119a-e443-4852-ba81-190938101e3e',
  '9279ec42-0fe3-4366-904e-539c0a25b8a0',
  '2026-01-20',
  'Meta Ads',
  200.00,
  'expense',
  FALSE, NULL, 'test_tx_011',
  'Instagram ad boost — portfolio reach campaign Jan',
  '2026-01-20 10:00:00+00'
),
(
  'bbbbbbbb-acab-0000-0000-000000000012',
  '82825bfe-5b17-41f6-a247-58ff12fd1902',
  '6565119a-e443-4852-ba81-190938101e3e',
  '9279ec42-0fe3-4366-904e-539c0a25b8a0',
  '2026-02-05',
  'Adobe Creative Cloud',
  59.99,
  'expense',
  FALSE, NULL, 'test_tx_012',
  'Monthly Creative Cloud subscription — Feb 2026',
  '2026-02-05 08:00:00+00'
),
(
  'bbbbbbbb-acab-0000-0000-000000000013',
  '82825bfe-5b17-41f6-a247-58ff12fd1902',
  '6565119a-e443-4852-ba81-190938101e3e',
  '9279ec42-0fe3-4366-904e-539c0a25b8a0',
  '2026-02-10',
  'Notion',
  16.00,
  'expense',
  FALSE, NULL, 'test_tx_013',
  'Notion Plus plan — project management Feb 2026',
  '2026-02-10 09:00:00+00'
),
(
  'bbbbbbbb-acab-0000-0000-000000000014',
  '82825bfe-5b17-41f6-a247-58ff12fd1902',
  '6565119a-e443-4852-ba81-190938101e3e',
  '9279ec42-0fe3-4366-904e-539c0a25b8a0',
  '2026-02-18',
  'Amazon Business',
  87.45,
  'expense',
  FALSE, NULL, 'test_tx_014',
  'Office supplies — printer paper, ink cartridges, notebooks',
  '2026-02-18 12:30:00+00'
),
(
  'bbbbbbbb-acab-0000-0000-000000000015',
  '82825bfe-5b17-41f6-a247-58ff12fd1902',
  '6565119a-e443-4852-ba81-190938101e3e',
  '9279ec42-0fe3-4366-904e-539c0a25b8a0',
  '2026-02-25',
  'Liberty Puerto Rico',
  89.99,
  'expense',
  FALSE, NULL, 'test_tx_015',
  'Internet service — February 2026',
  '2026-02-25 07:45:00+00'
),
(
  'bbbbbbbb-acab-0000-0000-000000000016',
  '82825bfe-5b17-41f6-a247-58ff12fd1902',
  '6565119a-e443-4852-ba81-190938101e3e',
  '9279ec42-0fe3-4366-904e-539c0a25b8a0',
  '2026-03-05',
  'Adobe Creative Cloud',
  59.99,
  'expense',
  FALSE, NULL, 'test_tx_016',
  'Monthly Creative Cloud subscription — Mar 2026',
  '2026-03-05 08:00:00+00'
),
(
  'bbbbbbbb-acab-0000-0000-000000000017',
  '82825bfe-5b17-41f6-a247-58ff12fd1902',
  '6565119a-e443-4852-ba81-190938101e3e',
  '9279ec42-0fe3-4366-904e-539c0a25b8a0',
  '2026-03-11',
  'Figma',
  45.00,
  'expense',
  FALSE, NULL, 'test_tx_017',
  'Figma Professional — March 2026',
  '2026-03-11 09:00:00+00'
),
(
  'bbbbbbbb-acab-0000-0000-000000000018',
  '82825bfe-5b17-41f6-a247-58ff12fd1902',
  '6565119a-e443-4852-ba81-190938101e3e',
  '9279ec42-0fe3-4366-904e-539c0a25b8a0',
  '2026-03-22',
  'Abogado PR — Legal Services',
  400.00,
  'expense',
  FALSE, NULL, 'test_tx_018',
  'Contract review — freelance services agreement template',
  '2026-03-22 15:00:00+00'
),
(
  'bbbbbbbb-acab-0000-0000-000000000019',
  '82825bfe-5b17-41f6-a247-58ff12fd1902',
  '6565119a-e443-4852-ba81-190938101e3e',
  '9279ec42-0fe3-4366-904e-539c0a25b8a0',
  '2026-04-01',
  'Adobe Creative Cloud',
  59.99,
  'expense',
  FALSE, NULL, 'test_tx_019',
  'Monthly Creative Cloud subscription — Apr 2026',
  '2026-04-01 08:00:00+00'
),
(
  'bbbbbbbb-acab-0000-0000-000000000020',
  '82825bfe-5b17-41f6-a247-58ff12fd1902',
  '6565119a-e443-4852-ba81-190938101e3e',
  '9279ec42-0fe3-4366-904e-539c0a25b8a0',
  '2026-04-10',
  'Squarespace',
  23.00,
  'expense',
  FALSE, NULL, 'test_tx_020',
  'Portfolio website hosting — April 2026',
  '2026-04-10 09:15:00+00'
);

COMMIT;

-- ============================================================
--  VERIFICATION QUERIES (run after seeding)
-- ============================================================
--
-- SELECT COUNT(*) FROM transactions
--   WHERE business_id = '82825bfe-5b17-41f6-a247-58ff12fd1902';
-- -- Expected: 20
--
-- SELECT type, COUNT(*), SUM(total_amount)
--   FROM transactions
--  WHERE business_id = '82825bfe-5b17-41f6-a247-58ff12fd1902'
--  GROUP BY type;
-- -- Expected: income 8 rows / expense 12 rows
--
-- SELECT date, merchant, total_amount, type
--   FROM transactions
--  WHERE business_id = '82825bfe-5b17-41f6-a247-58ff12fd1902'
--  ORDER BY date;
-- ============================================================