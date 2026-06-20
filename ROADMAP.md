# Build Roadmap — Feature Specs

Ordered by the resequenced build order (dependency-correct, foundation-first).
Old phase numbers shown in parentheses for cross-reference.

**Status convention:**
- **Locked** — spec is firm, build against it.
- **Provisional** — directional only. Revise when you reach it; earlier features will reshape these.

---

## FOUNDATION
*Nothing else is correct until these three exist. Build as one unit before touching anything below.*

---

### 1. Chart of accounts — Locked *(was #4)*

**What it does**
Replaces the flat `categories` list with a real double-entry account structure: Assets, Liabilities, Equity, Revenue, Expense. Each account has a type, a normal balance (debit/credit), and an optional parent for sub-accounts. **Decision made:** this is a dedicated `chart_of_accounts` table, not extra columns on `categories`. Double-entry (#2) depends on a clean account table that `journal_entry_lines` can reference; overloading `categories` would fight that model. The existing `categories` rows get migrated into this table as Revenue/Expense accounts, and the i18n debt is fixed in the same pass by seeding accounts with translation keys instead of hardcoded English strings.

**Frontend work**
- New `/chart-of-accounts` route and nav item
- Tree-view UI (collapsible parent/child rows)
- Account type filter (Assets / Liabilities / Equity / Revenue / Expense)
- Running balance column per account
- Import standard COA templates (basic service business, retail)
- Account names render from i18n keys (en/es), not stored English strings

**Backend work**
- Migration: create `chart_of_accounts`; migrate existing `categories` rows into it; update `auth.js` seed logic to insert accounts with i18n keys
- `GET /api/chart-of-accounts` — tree-structured response
- Enforce parent/child type consistency (an expense account can't parent an asset)
- Enforce normal-balance correctness per type (assets/expenses = debit, liabilities/equity/revenue = credit)

**Schema changes**
- NEW TABLE: `chart_of_accounts (id, business_id, code TEXT, name_key TEXT, account_type ENUM(asset|liability|equity|revenue|expense), normal_balance ENUM(debit|credit), parent_id UUID nullable FK, is_active BOOL, created_at)`
- Migrate and then drop the standalone `categories` table (or keep as a thin tagging layer if you want category tags separate from ledger accounts — decide during build)

**Dependencies & blocking**
- Depends on: None — self-contained. Build first.
- Blocks: Double-entry (#2), Budgeting (#14), and COGS account mapping in Inventory (#17)

---

### 2. Double-entry + journal entries — Locked *(was #22)*

**What it does**
Converts the ledger from single-entry (a signed `total_amount` + `type` enum on `transactions`) to true double-entry: every transaction posts matching debit and credit lines across accounts, and the accounting equation holds after every entry. This is a data-model migration, not an additive feature. Doing it now — while data is erasable — means every feature built afterward posts balanced journal lines from birth, with zero retrofit. Doing it later means rewriting every write path you've already shipped.

**Frontend work**
- Journal entry view: debit/credit columns per line
- Manual journal entry form for accountant adjustments (depreciation, accruals)
- Trial balance report (sum of debits must equal sum of credits) — doubles as your build verification
- Existing transaction create/edit forms updated to show the resulting debit/credit posting

**Backend work**
- Migration: `transactions` becomes a header; new `journal_entry_lines` hold the actual debit/credit postings against `chart_of_accounts`
- Rewrite every existing write path (manual transactions, payroll runs) to post balanced journal lines instead of a single signed amount
- Validation: reject any entry where total debits ≠ total credits
- A posting helper/service that all future features call, so invoicing/inventory/etc. never write raw amounts

**Schema changes**
- NEW TABLE: `journal_entries (id, business_id, date, description, source_type TEXT, source_id UUID, created_by UUID FK, created_at)`
- NEW TABLE: `journal_entry_lines (id, journal_entry_id FK, account_id FK → chart_of_accounts, debit NUMERIC(12,2) DEFAULT 0, credit NUMERIC(12,2) DEFAULT 0, CHECK (debit = 0 OR credit = 0))`
- `transactions` repurposed as a header record linking to its journal entry (or fully replaced — decide during migration since data is erasable)

**Dependencies & blocking**
- Depends on: Chart of accounts (#1) — hard prerequisite
- Blocks: Balance sheet (#3), and every ledger-writing feature that follows posts through this

---

### 3. Balance sheet — Locked *(was #23)*

**What it does**
Assets = Liabilities + Equity, as of a point in time. Mathematically impossible from a single-entry ledger — which is exactly why it belongs here. Built immediately after double-entry, it's your proof the migration is correct: if the balance sheet balances, your posting logic is sound. If it doesn't, you've found the bug before stacking 17 features on a broken ledger.

**Frontend work**
- Balance sheet report: Assets, Liabilities, Equity sections with subtotals
- As-of-date picker
- Drill-down from a line item to its underlying journal entries

**Backend work**
- `GET /api/reports/balance-sheet?asOf=YYYY-MM-DD` — sums `journal_entry_lines` by account type, filtered to the date

**Schema changes**
- None — pure query layer over journal entries from #2

**Dependencies & blocking**
- Depends on: Double-entry (#2) — hard blocker
- Blocks: Nothing — capstone report (and verification harness)

---

## CORE ENTITIES & LEDGER FEATURES
*Standalone records and the features that write transactions. Each posts journal lines through #2.*

---

### 4. Vendor management — Locked *(was #7)*

**What it does**
A vendor/payee directory transactions reference instead of a free-text merchant field. Stores name, EIN/SSN, address, contact info, and a 1099-eligible flag. When an eligible vendor crosses $600 in a tax year, the system can flag them. Without structured payee data, 1099 reporting is impossible.

**Frontend work**
- New `/vendors` route — table with search and 1099-status filter
- Vendor detail drawer: edit info, see all transactions, see YTD paid
- Vendor dropdown on the transaction form (replaces free-text merchant for vendor payments)
- 1099 report view: eligible vendors over the $600 threshold

**Backend work**
- Full CRUD: `/api/vendors`
- `GET /api/vendors/:id/transactions` — scoped by `business_id`
- `GET /api/vendors/1099-report?year=` — aggregates payments per eligible vendor
- Optional backfill: match existing merchant strings to vendor records

**Schema changes**
- NEW TABLE: `vendors (id, business_id, name, ein TEXT, address TEXT, city, state, zip, email, phone, is_1099_eligible BOOL, created_at)`
- ALTER `transactions`: add `vendor_id UUID nullable FK → vendors(id)`

**Dependencies & blocking**
- Depends on: None — standalone
- Blocks: 1099 filing prep (#15)

---

### 5. Client / customer management — Locked *(was #13)*

**What it does**
The receivable-side mirror of vendors: who you bill. Stores billing contact, address, payment terms, and tax-exempt status. Without it, invoicing has no structured recipient and AR aging has nothing to group by.

**Frontend work**
- New `/clients` route — table with search and active/inactive filter
- Client detail drawer: contact info, billing address, payment terms, linked invoices
- Client picker on the invoice creation form

**Backend work**
- Full CRUD: `/api/clients`
- `GET /api/clients/:id/invoices` — history plus outstanding balance

**Schema changes**
- NEW TABLE: `clients (id, business_id, name, billing_email, billing_address, city, state, zip, payment_terms_days INT DEFAULT 30, tax_exempt BOOL, notes TEXT, created_at)`

**Dependencies & blocking**
- Depends on: None — standalone
- Blocks: Invoicing (#10)

---

### 6. Auto-categorization rules — Locked *(was #5)*

**What it does**
User-defined rules that auto-assign an account/category when a transaction's merchant or description matches a pattern. Rules run in priority order on create and on import. Two matching modes: exact match and contains/regex. Build this before Plaid and before real transaction volume — retrofitting rule-matching onto a pile of existing transactions is painful, and bank import without it is a manual triage queue.

**Frontend work**
- Rule builder: condition (merchant contains / equals) + action (assign account)
- Priority ordering (drag to reorder)
- Test a rule against existing transactions before saving
- Badge on transactions showing auto-categorized vs manual

**Backend work**
- CRUD: `/api/rules`
- Rule engine middleware — runs on `POST /api/transactions` and the future Plaid webhook
- Match logic: case-insensitive contains, optional regex flag
- Conflict resolution: highest-priority matching rule wins

**Schema changes**
- NEW TABLE: `categorization_rules (id, business_id, priority INT, match_type ENUM(contains|equals|regex), pattern TEXT, account_id UUID FK, is_active BOOL, created_at)`

**Dependencies & blocking**
- Depends on: Chart of accounts (#1) for the target account
- Blocks: Plaid (#19) — strongly recommended before it

---

### 7. Recurring transactions — Locked *(was #6)*

**What it does**
Template transactions that auto-generate on a schedule (rent, SaaS, loan payments). User defines the template once; the system generates the real transaction on the due date and posts its journal lines through #2. Needs either a background job or a "generate pending" endpoint the frontend triggers.

**Frontend work**
- "Make recurring" toggle on the transaction form
- Recurring tab showing upcoming and past generated entries
- Pause / skip / end-date controls per rule
- Visual indicator on auto-generated transactions

**Backend work**
- `POST /api/recurring` — create template
- `GET /api/recurring` — list with next-due dates
- `POST /api/recurring/:id/generate` — manual trigger (or cron job)
- Next-date logic from frequency + `last_generated`

**Schema changes**
- NEW TABLE: `recurring_transactions (id, business_id, account_id, debit_account_id, credit_account_id, merchant, amount, frequency ENUM(daily|weekly|monthly|quarterly|yearly), start_date DATE, end_date DATE nullable, last_generated DATE, next_due DATE, is_active BOOL, notes TEXT)`

**Dependencies & blocking**
- Depends on: Double-entry (#2) so generated entries post correctly
- Blocks: Nothing directly; improves Budgeting (#14) accuracy

---

### 8. Project / job tracking — Locked *(was #10)*

**What it does**
Tag transactions and time entries to a project or job. Each project has a budget, status, and client. Revenue and expenses tagged to a project give per-job P&L — core for service businesses, contractors, agencies. Prerequisite for time tracking, since time entries belong to a project.

**Frontend work**
- New `/projects` route — list with status, budget, actual-cost columns
- Project detail: income vs expense breakdown, attached transactions, time logged
- Optional project tag on the transaction form
- Project P&L mini-report

**Backend work**
- Full CRUD: `/api/projects`
- `GET /api/projects/:id/summary` — aggregates transactions tagged to the project
- `PATCH /api/transactions/:id` to add/remove `project_id`

**Schema changes**
- NEW TABLE: `projects (id, business_id, name, client_id UUID nullable FK, status ENUM(active|completed|archived), budget NUMERIC(12,2), start_date DATE, end_date DATE, notes TEXT, created_at)`
- ALTER `transactions`: add `project_id UUID nullable FK → projects(id)`

**Dependencies & blocking**
- Depends on: None standalone (links to Clients #5 if available)
- Blocks: Time tracking (#9)

---

### 9. Time tracking — Locked *(was #11)*

**What it does**
Log billable and non-billable hours against projects. Time entries feed project cost reports and (later) invoices. Hourly employees' timesheets here can feed payroll, cutting double-entry of hours.

**Frontend work**
- Time entry form: project, date, hours, description, billable toggle
- Running timer widget (start/stop, auto-round to 15 min)
- Timesheet view: weekly grid per user/employee
- Export timesheet to CSV for payroll or invoicing

**Backend work**
- Full CRUD: `/api/time-entries`
- `GET /api/time-entries?project_id=&user_id=&week=` — filtered list
- `GET /api/projects/:id/hours` — billable vs non-billable totals
- Link to payroll: hourly time entries → `hours_worked` on payslips

**Schema changes**
- NEW TABLE: `time_entries (id, business_id, user_id UUID FK, project_id UUID FK, date DATE, hours NUMERIC(6,2), description TEXT, is_billable BOOL, hourly_rate NUMERIC(10,2) nullable, created_at)`

**Dependencies & blocking**
- Depends on: Projects (#8) — hard prerequisite
- Blocks: Future invoicing of logged time

---

## INVOICING & CUSTOMER-FACING
*Your strongest PR market differentiation. Build the cluster together.*

---

### 10. Invoicing — Locked *(was #14)*

**What it does**
Create, send, and track invoices against a client. Line items, due dates, status (draft/sent/paid/overdue/void), PDF generation. The real cost here is email infrastructure — SES/SendGrid/Postmark plus SPF/DKIM/deliverability setup — not the CRUD. A paid invoice should post journal lines (debit AR or cash, credit revenue) through #2.

**Frontend work**
- Invoice builder: line items, tax, totals, due date
- Invoice list with status filter
- PDF preview before send
- Send confirmation + resend/void actions

**Backend work**
- Full CRUD: `/api/invoices`
- `POST /api/invoices/:id/send` — generate PDF, email client, mark `status='sent'`
- Email service integration with bounce/complaint handling
- Mark invoices overdue when `due_date` passes unpaid (cron or trigger)
- On payment, post the journal entry through #2

**Schema changes**
- NEW TABLE: `invoices (id, business_id, client_id UUID FK, invoice_number TEXT, issue_date DATE, due_date DATE, status ENUM(draft|sent|paid|overdue|void), subtotal NUMERIC(12,2), tax_total NUMERIC(12,2), total NUMERIC(12,2), notes TEXT, created_at)`
- NEW TABLE: `invoice_line_items (id, invoice_id UUID FK, description TEXT, quantity NUMERIC(10,2), unit_price NUMERIC(10,2), total NUMERIC(12,2))`

**Dependencies & blocking**
- Depends on: Clients (#5)
- Blocks: IVU template (#11), AI invoice creation (#12), AR view (#13)

---

### 11. Invoice with IVU + Spanish template — Locked *(was #15)*

**What it does**
Puerto Rico's IVU sales tax (11.5% combined state + municipal) must be itemized separately — generic US sales-tax logic won't match what Hacienda expects. Adds a Spanish-language invoice template and an IVU-specific tax line. A genuine differentiator: most US invoicing tools get PR's tax wrong or skip it.

**Frontend work**
- Template toggle: English / Spanish on invoice settings
- IVU rate field (defaults 11.5%, editable per municipality if needed)
- PDF shows IVU as its own line, not folded into a generic "tax" row

**Backend work**
- Extend invoice tax calc to support a named tax type (`ivu`) vs generic `tax_rate`
- Locale-aware PDF rendering — reuse the existing `en.json`/`es.json` i18n strings

**Schema changes**
- ALTER `invoices`: add `tax_type VARCHAR(20) DEFAULT 'generic'`, add `language CHAR(2) DEFAULT 'en'`

**Dependencies & blocking**
- Depends on: Invoicing (#10)
- Blocks: Nothing — pure differentiator

---

### 12. AI invoice creation — Provisional *(was #17)*

**What it does**
User describes an invoice in natural language ("bill Acme for 10 hours consulting at $150/hr") and Claude drafts line items and totals for review before save. A new LLM-facing surface — apply the same LLM01/LLM02 hardening already in `ai.js`: never let the model write to invoices directly, always return structured JSON for human confirmation, and scope any client/amount data pulled into the prompt by `business_id`. *(Provisional: the exact prompt and field mapping depend on the invoicing data model you finalize in #10.)*

**Frontend work**
- Natural-language input box on the invoice creation screen
- AI-drafted line items shown as editable rows before save — never auto-submit
- Confidence/uncertainty indicator on extracted amounts

**Backend work**
- `POST /api/invoices/ai-draft` — same prompt-injection guards as `ai.js`
- Schema validation on AI output before returning (reuse the `validateReceiptData` pattern)
- Rate limit identical to `aiChatLimiter`

**Schema changes**
- None — feeds the existing invoice tables

**Dependencies & blocking**
- Depends on: Invoicing (#10)
- Blocks: Nothing

---

### 13. Accounts receivable view — Provisional *(was #16)*

**What it does**
Aggregate reporting over invoices: who owes you what, how overdue, total AR exposure. Read-heavy — no new write paths, just a dashboard and aging buckets (current, 30, 60, 90+ days). *(Provisional: bucket logic and grouping depend on the final invoice/payment schema from #10.)*

**Frontend work**
- AR dashboard: total outstanding, aging buckets, by-client breakdown
- Overdue invoice list with days-late column
- Click-through to client detail or invoice

**Backend work**
- `GET /api/reports/ar-aging` — buckets invoices by days overdue
- `GET /api/reports/ar-summary` — total outstanding by client

**Schema changes**
- None — pure query layer over invoices

**Dependencies & blocking**
- Depends on: Invoicing (#10)
- Blocks: Nothing

---

## REPORTING, TAX & HEAVY BUILD
*Aggregation layers plus the cost- and speculation-gated items. Last on purpose.*

---

### 14. Budgeting — Provisional *(was #8)*

**What it does**
Monthly or annual budget targets per account, tracked against actuals in real time, with variance alerts. Read-only and blocks nothing, so it waits until after the revenue features. Most useful at the account-type level, which is why it needs chart of accounts.

**Frontend work**
- Budget setup: monthly amounts per account
- Budget vs actual dashboard widget (progress bars)
- Variance summary: over/under by account this month
- Copy last month's budget as a starting point

**Backend work**
- `POST/PUT /api/budgets` — upsert a budget line per account per period
- `GET /api/budgets/summary?month=YYYY-MM` — joins budget vs actual from journal lines
- Optional rollover of unused budget

**Schema changes**
- NEW TABLE: `budgets (id, business_id, account_id UUID FK, period DATE (first of month), amount NUMERIC(12,2), rollover BOOL, created_at)`

**Dependencies & blocking**
- Depends on: Chart of accounts (#1)
- Blocks: Nothing

---

### 15. 1099 filing prep — Provisional *(was #18)*

**What it does**
Generates 1099-NEC data for `is_1099_eligible` vendors paid $600+ in the tax year. This is prep, not e-filing — output is a CSV/PDF the owner hands to an accountant or uploads to a filing service. Full IRS e-file is a much larger separate project. *(Provisional: column layout depends on the filing service/format you target.)*

**Frontend work**
- 1099 report page: filter by tax year, show eligible vendors over threshold
- Export to CSV in IRS-compatible column layout
- Flag vendors missing required EIN/address before export

**Backend work**
- `GET /api/reports/1099?year=` — sums vendor payments, filters by threshold + eligibility
- Block export if a vendor record is missing required fields

**Schema changes**
- None — uses Vendors (#4) + `transactions.vendor_id`

**Dependencies & blocking**
- Depends on: Vendor management (#4)
- Blocks: Hacienda export (#16)

---

### 16. Hacienda-ready annual export — Provisional *(was #19)*

**What it does**
Puerto Rico's Departamento de Hacienda has annual reporting formats distinct from IRS federal forms (e.g. informative returns for services rendered). Your strongest differentiation against QuickBooks/Wave for PR clients — and the one place where a wrong format has real compliance consequences for users. **Research the current published Hacienda form specs before building; do not build against assumed structure.** *(Provisional by nature — the spec is gated on form research, not code.)*

**Frontend work**
- Annual export page: tax-year selector, business-level summary
- Preview before download
- Clear disclaimer: prep data, not a filed return — the user's accountant verifies

**Backend work**
- `GET /api/reports/hacienda-annual?year=` — aggregates income, expenses, payroll, and 1099 vendor totals into the required layout
- Export in whatever format the current Hacienda informative-return spec requires (verify against published forms first)

**Schema changes**
- None — aggregation over existing tables

**Dependencies & blocking**
- Depends on: 1099 prep (#15); payroll already exists
- Blocks: Nothing

---

### 17. Inventory — Provisional *(was #12)*

**What it does**
Tracks stock of physical products: quantities, reorder points, COGS, purchase orders. Valuation method (FIFO vs average cost) directly affects P&L. Selling a product auto-posts a COGS journal entry through #2. The heaviest single feature in the roadmap and it blocks nothing else here — which is why it's late. Don't let it stall the tax/invoicing wins. *(Provisional: COGS posting and valuation details depend on how #2 settled.)*

**Frontend work**
- New `/inventory` route — product list with qty, value, reorder status
- Product detail: stock history, cost history, linked transactions
- Receive-stock form (auto-creates a purchase transaction)
- Reorder alerts: nav badge when items fall below reorder point
- Valuation report: total stock value by FIFO or average cost

**Backend work**
- Full CRUD: `/api/products`
- `POST /api/inventory/receive` — add stock, record purchase cost
- `POST /api/inventory/adjust` — manual adjustment with reason
- `GET /api/inventory/valuation` — FIFO or average-cost calculation
- Auto-COGS on sale: hook into transaction posting when a `product_id` is set

**Schema changes**
- NEW TABLE: `products (id, business_id, name, sku TEXT, description, unit_cost NUMERIC(10,2), sell_price NUMERIC(10,2), qty_on_hand NUMERIC(10,3), reorder_point NUMERIC(10,3), valuation_method ENUM(fifo|avg), cogs_account_id UUID FK, is_active BOOL, created_at)`
- NEW TABLE: `inventory_movements (id, product_id UUID FK, movement_type ENUM(receive|sale|adjustment|return), quantity NUMERIC(10,3), unit_cost NUMERIC(10,2), transaction_id UUID nullable FK, notes TEXT, created_at)`
- ALTER `transactions`: add `product_id UUID nullable FK`, add `qty NUMERIC(10,3) nullable`

**Dependencies & blocking**
- Depends on: Chart of accounts (#1) for COGS account mapping
- Blocks: Future invoicing line-items from inventory, purchase orders

---

### 18. Multi-currency — Cut candidate *(was #9)*

**What it does**
Support transactions in currencies other than the base currency: store original amount + currency + exchange rate, convert to base for reporting. **Recommendation: do not build until a real user needs it.** PR runs on USD and the target market is local small businesses — this serves businesses with foreign suppliers/customers, likely a rounding error of your users. If you do build it, the upside of having double-entry early is that currency lives cleanly on the journal line. *(Listed for completeness; treat as deferred indefinitely.)*

**Frontend work**
- Currency selector per transaction (defaults to base currency)
- Exchange rate field — auto-filled from API, editable override
- Dashboard totals in base currency with an FX indicator
- FX gain/loss line in P&L

**Backend work**
- `GET /api/fx-rates?base=&date=` — proxy to an external provider (Open Exchange Rates, ECB)
- Rate caching by date (historical rates don't change retroactively)
- Conversion in all reporting queries

**Schema changes**
- ALTER `journal_entry_lines`: add `original_currency CHAR(3)`, `original_amount NUMERIC(12,2)`, `exchange_rate NUMERIC(12,6)`
- NEW TABLE: `fx_rate_cache (base CHAR(3), target CHAR(3), rate_date DATE, rate NUMERIC(12,6), PRIMARY KEY (base, target, rate_date))`

**Dependencies & blocking**
- Depends on: None blocking
- Blocks: Nothing

---

### 19. Plaid full integration — Pricing-gated *(was #20)*

**What it does**
Bank-feed sync: link accounts, pull transactions automatically, dedupe against manual entries. **Sequenced by a business decision, not engineering.** Plaid's production tier carries a recurring monthly floor cost that exists whether or not a single user connects a bank. Confirm your subscription pricing covers it before writing integration code — otherwise you're choosing between eating the cost or awkwardly paywalling a feature users already expect.

**Frontend work**
- Plaid Link UI flow — connect bank account
- Sync status indicator, manual re-sync button
- Imported-transaction review queue (pairs with auto-cat rules #6)

**Backend work**
- Plaid Link token exchange + webhook receiver
- Sync job: pull new transactions, run through auto-cat rules, flag duplicates against manual entries
- Account balance sync

**Schema changes**
- NEW TABLE: `plaid_items (id, business_id, access_token_encrypted, item_id, institution_name, status, created_at)`
- `transactions.plaid_tx_id` already exists — this was planned for

**Dependencies & blocking**
- Depends on: Auto-cat rules (#6) should exist first, or import becomes manual triage
- Blocks: Bank reconciliation (#20)

---

### 20. Bank reconciliation — Provisional *(was #21)*

**What it does**
Match imported bank transactions against manual entries, and let users lock a statement period as reconciled once the balance ties out. The workflow that catches double entries, missed transactions, and sync errors. Only build if Plaid clears the pricing gate. *(Provisional: depends on the Plaid sync shape from #19.)*

**Frontend work**
- Reconciliation screen: side-by-side bank feed vs ledger, match/unmatch
- Mark period reconciled — locks transactions in that range from edits
- Discrepancy report when balances don't tie out

**Backend work**
- `POST /api/reconciliation/match` — link a Plaid transaction to a manual entry
- `POST /api/reconciliation/close-period` — lock a date range
- Reconciliation status check against account balance

**Schema changes**
- NEW TABLE: `reconciliations (id, account_id UUID FK, period_end DATE, statement_balance NUMERIC(12,2), is_closed BOOL, closed_at TIMESTAMPTZ)`
- ALTER `transactions`: add `is_reconciled BOOL DEFAULT FALSE`

**Dependencies & blocking**
- Depends on: Plaid (#19)
- Blocks: Nothing

---

## Build-order summary

| # | Feature | Status | Depends on |
|---|---------|--------|-----------|
| 1 | Chart of accounts | Locked | — |
| 2 | Double-entry + journal entries | Locked | #1 |
| 3 | Balance sheet | Locked | #2 |
| 4 | Vendor management | Locked | — |
| 5 | Client management | Locked | — |
| 6 | Auto-categorization rules | Locked | #1 |
| 7 | Recurring transactions | Locked | #2 |
| 8 | Project / job tracking | Locked | — |
| 9 | Time tracking | Locked | #8 |
| 10 | Invoicing | Locked | #5 |
| 11 | IVU + Spanish template | Locked | #10 |
| 12 | AI invoice creation | Provisional | #10 |
| 13 | Accounts receivable view | Provisional | #10 |
| 14 | Budgeting | Provisional | #1 |
| 15 | 1099 filing prep | Provisional | #4 |
| 16 | Hacienda annual export | Provisional | #15 |
| 17 | Inventory | Provisional | #1 |
| 18 | Multi-currency | Cut candidate | — |
| 19 | Plaid integration | Pricing-gated | #6 |
| 20 | Bank reconciliation | Provisional | #19 |

**The one rule that de-risks the whole sequence:** build 1–3 as a single unit before anything else. Once the balance sheet balances, the remaining 17 features are additive on a validated ledger.
