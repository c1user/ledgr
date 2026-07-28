# ROADMAP V3 — Production readiness

The account-lifecycle, support, trust/legal, and communication features a
public SaaS is expected to have but Abaco currently lacks. (Billing/Stripe is
tracked separately and deliberately excluded here.)

**Why this order.** The sequence is chosen so difficulty *drops* as we go:
one "boring" foundation — real, generic email — makes five later features
collapse to near-zero. Credential/login changes are clustered so the login
flow is designed once instead of patched three times. The reusable token +
email pattern from password reset is then reused by verification. Destructive
work (account/business deletion) and the most complex work (2FA) are deferred
until the surrounding surface is stable. The two features the product owner
called out — a support/report link and forgot-password — are front-loaded
(Phases 2 and 3).

Reuse notes: the `users` table already has an `invite_token` / `invite_expires_at`
pattern (from multi-user invites) that reset + verification can copy; the
email service (`backend/src/services/email.js`) already sends real SMTP when
configured; there's an existing `/settings` (BusinessProfile) area to sit
personal-account settings alongside.

## Phase 1 — Email foundation  *(do first; unblocks most of the rest)*

- [x] **1. Generic mail sender.** Refactor `email.js` from bespoke per-message
      functions (invoice, invite) into a `sendMail({ to, subject, text, html })`
      helper + a small shared template/layout. Port the existing senders onto
      it. Keep the offline dev-capture fallback.
      Done: `sendMail()` core with shared footer; invoice + invite senders
      ported (signatures unchanged); fallback mode exposes the composed
      message for tests — 5 composition tests in tests/email.test.mjs.
- [ ] **2. Real provider + deliverability.** Configure a provider (SES /
      Postmark / SendGrid) via env and confirm SPF/DKIM so mail actually lands.
      Code-side ready — `.env.example` documents the SMTP_* / EMAIL_FROM /
      APP_URL vars. Remaining work is external: create the provider account
      and set SPF/DKIM DNS records (owner action, no code).
- [x] **3. Welcome email on signup** — the first consumer of the new sender,
      proving the path end to end. Fire-and-forget after registration
      commits (mail can never fail a signup); EN/ES, language passed from
      the register form.

*Difficulty: low. Dependencies: none. Every email-based item below assumes this.*

## Phase 2 — Support & help  *(fast, high-visibility; owner's example)*

- [x] **4. Report a problem / Contact support.** In-app form → backend endpoint
      → emails support with auto-attached context (user, business, plan, current
      page, app version). Persist rows in a `support_requests` table for a trail.
      Done: migration 023 + POST /api/support (no plan gate — support works on
      every tier; row persists even if the email fails) + the user's address
      as reply-to so support answers land directly. SUPPORT_EMAIL env.
- [ ] **5. Help / FAQ / feedback / status links** in a small Help menu.
      Partially done: header "?" menu ships with Contact support / Report a
      problem / Send feedback (all → the support modal with category preset).
      FAQ and status-page links intentionally NOT added yet — they need real
      destinations to exist first (a docs page and a status service are owner
      decisions); dead links are worse than none.

*Difficulty: low once Phase 1 exists (a `mailto:` stopgap needs nothing).
Dependency: Phase 1 for the form-to-email version.*

## Phase 3 — Forgot / reset password  *(owner's example; public flow)*

- [x] **6. Password reset.** Public "forgot password" page → tokened email link
      → "set new password" page. Reuses the `invite_token` + expiry pattern
      already on `users`, so it's mostly assembly on proven infrastructure.
      Done: migration 024 (separate reset_token columns so a reset never
      clobbers a pending invite); anti-enumeration (identical 200 whether
      the account exists or not); 1-hour single-use tokens; register's
      password policy enforced; successful reset logs the user straight in.
      "Forgot password?" link on the login page.

*Difficulty: low–medium. Dependencies: Phase 1 (email). Public flow — needs no
settings area, so it can ship before the logged-in security work.*

## Phase 4 — Legal pages  *(static; no backend; needed before public signups)*

- [x] **7. Terms of Service + Privacy Policy** public pages with footer links.
      (An app holding EINs, SSNs for withholding, and balances needs these.)
      ✅ Bilingual DRAFT templates in `frontend/src/legal/{terms,privacy}.js`,
      rendered by shared `pages/LegalPage.jsx` at public `/terms` + `/privacy`
      (lazy routes); "Terms · Privacy" footer links on Login and Register.
      Visible DRAFT badge until counsel reviews — then flip `DRAFT = false`
      in LegalPage.jsx. Privacy discloses EIN/SSN data, S3 storage, Anthropic
      AI processing, email provider, no selling, retention, and user rights.

*Difficulty: trivial. Dependencies: none. Placed just before Phase 5 so the
signup consent checkbox has pages to link to.*

## Phase 5 — Account security & signup hardening  *(touch registration once)*

- [x] **8. My Account / Security area** — hosts the items below, the personal
      counterpart to the existing business `/settings` and Team pages.
      ✅ `pages/Account.jsx` at `/account`: profile summary, verification
      status badge + resend, change-password card. Reached via the sidebar
      user block (now a link) and the command palette.
- [x] **9. Change password while logged in** — no email needed; verifies the
      current password and sets a new hash. Good warm-up; lands the area.
      ✅ POST /auth/change-password (bcrypt-verifies current, register's
      policy, clears any pending reset token). Wrong current password
      returns 400 — not 401, which the axios interceptor reads as an
      expired session and would log the user out mid-form.
- [x] **10. Email verification on signup** — `verified` flag + tokened link,
      reusing Phase 3's token+email infrastructure. Decide soft-nudge vs.
      hard-gate. ✅ Migration 025: email_verified + verify_token
      (24h, single-use, separate column from invite/reset tokens) +
      consented_at; existing users grandfathered verified. Decided
      SOFT-NUDGE: dismissible banner in AppLayout until verified, resend
      from /account. Public `/verify-email` page consumes the link;
      reset-password and accept-invite also mark verified (emailed link
      proves the inbox).
- [x] **11. Signup consent** — "I agree to Terms & Privacy" checkbox +
      `consented_at`. Bundled with #10 so registration is edited once.
      ✅ Register requires consent === true (strict boolean, 400 otherwise);
      checkbox links to /terms + /privacy; timestamp stored on the user row.

*Difficulty: medium. Dependencies: Phase 1 (email), Phase 3 (token pattern),
Phase 4 (pages to consent to).*

## Phase 6 — Data rights  *(export before delete; delete is destructive → late)*

- [x] **12. Export all my data** — one download (JSON/zip) of the business's
      records. Non-destructive, and forces a clean enumeration of every table a
      business owns — which #13 then reuses.
      ✅ GET /api/business/export (owner-only) → one JSON attachment with the
      business row + every owned table; user secret columns stripped. The
      map lives in services/businessData.js and tests/businessData.test.mjs
      compares it to the live schema — a new table can't be forgotten
      silently.
- [x] **13. Delete account / close business** — self-service erasure with strong
      confirmation and complete cascade teardown. Fixes the known
      orphaned-opening-balance-entry class of bug in the process.
      ✅ DELETE /api/business (owner-only): requires the owner's password AND
      the exact business name; child-first teardown of all 25 tables in one
      transaction. Settings page gained an owner-only "Export your data" +
      "Close this business" danger zone (typed-name + password modal, logout
      on success). Account hard-delete now also removes the opening-balance
      journal entry, its lines, and the account's ledger COA row — the
      orphan bug is fixed.

*Difficulty: medium. Dependencies: do #12 first (it produces the data map #13
needs); benefits from the auth phase being stable.*

## Phase 7 — Advanced security & sessions  *(isolated on purpose)*

- [x] **14. Two-factor authentication** — TOTP + backup codes, opt-in from the
      security area. Kept out of Phase 5 because it's markedly more complex and
      higher-risk; worth its own isolated change to the login flow.
      ✅ RFC 6238 TOTP implemented in services/totp.js (node:crypto only,
      pinned to the RFC 4226 test vectors in tests). Enable flow on
      /account: password → QR (qrcode pkg) + manual key → verify code →
      8 single-use backup codes shown once (SHA-256 digests stored).
      Login becomes two-step for 2FA accounts via a 5-minute MFA token;
      backup codes work at login and are consumed. Disable requires
      password + code. Pending secrets never half-enable 2FA.
- [x] **15. Session improvements** — a token version so "sign out of all
      devices" works; clearer "session expired / you were logged out" messaging.
      ✅ users.token_version embedded in every JWT and checked by
      requireAuth (also kills tokens of deleted users); bumped on
      password change/reset, 2FA enable/disable, and the new "Sign out of
      all devices" button on /account. Change-password returns a fresh
      token so the current session survives. The 401 interceptor now only
      fires when a token was actually sent (failed logins keep their
      inline error) and lands on /login?expired=1, which shows "Your
      session expired — please sign in again."

*Difficulty: 2FA high, sessions medium. Dependency: stable auth from Phase 5.*

## Phase 8 — Notifications depth  *(needs email foundation + real event types)*

- [ ] **16. Notification preferences + unsubscribe** — per-user toggles and
      unsubscribe tokens (legally paired with any recurring mail).
- [ ] **17. Broaden transactional emails** (invoice paid, reconciliation locked,
      invite accepted, etc.).
- [ ] **18. In-app notification center** — bell with read/unread. Biggest of the
      group; last, because it needs the events and prefs to already exist.

## Phase 9 — Onboarding & polish

- [ ] **19. First-run onboarding / product tour** — extends the existing
      dashboard getting-started checklist.
- [ ] **20. Cookie/consent banner** — only once analytics are added; pairs with
      the privacy policy.
