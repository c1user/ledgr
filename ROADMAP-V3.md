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

- [ ] **4. Report a problem / Contact support.** In-app form → backend endpoint
      → emails support with auto-attached context (user, business, plan, current
      page, app version). Persist rows in a `support_requests` table for a trail.
- [ ] **5. Help / FAQ / feedback / status links** in a small Help menu.

*Difficulty: low once Phase 1 exists (a `mailto:` stopgap needs nothing).
Dependency: Phase 1 for the form-to-email version.*

## Phase 3 — Forgot / reset password  *(owner's example; public flow)*

- [ ] **6. Password reset.** Public "forgot password" page → tokened email link
      → "set new password" page. Reuses the `invite_token` + expiry pattern
      already on `users`, so it's mostly assembly on proven infrastructure.

*Difficulty: low–medium. Dependencies: Phase 1 (email). Public flow — needs no
settings area, so it can ship before the logged-in security work.*

## Phase 4 — Legal pages  *(static; no backend; needed before public signups)*

- [ ] **7. Terms of Service + Privacy Policy** public pages with footer links.
      (An app holding EINs, SSNs for withholding, and balances needs these.)

*Difficulty: trivial. Dependencies: none. Placed just before Phase 5 so the
signup consent checkbox has pages to link to.*

## Phase 5 — Account security & signup hardening  *(touch registration once)*

- [ ] **8. My Account / Security area** — hosts the items below, the personal
      counterpart to the existing business `/settings` and Team pages.
- [ ] **9. Change password while logged in** — no email needed; verifies the
      current password and sets a new hash. Good warm-up; lands the area.
- [ ] **10. Email verification on signup** — `verified` flag + tokened link,
      reusing Phase 3's token+email infrastructure. Decide soft-nudge vs.
      hard-gate.
- [ ] **11. Signup consent** — "I agree to Terms & Privacy" checkbox +
      `consented_at`. Bundled with #10 so registration is edited once.

*Difficulty: medium. Dependencies: Phase 1 (email), Phase 3 (token pattern),
Phase 4 (pages to consent to).*

## Phase 6 — Data rights  *(export before delete; delete is destructive → late)*

- [ ] **12. Export all my data** — one download (JSON/zip) of the business's
      records. Non-destructive, and forces a clean enumeration of every table a
      business owns — which #13 then reuses.
- [ ] **13. Delete account / close business** — self-service erasure with strong
      confirmation and complete cascade teardown. Fixes the known
      orphaned-opening-balance-entry class of bug in the process.

*Difficulty: medium. Dependencies: do #12 first (it produces the data map #13
needs); benefits from the auth phase being stable.*

## Phase 7 — Advanced security & sessions  *(isolated on purpose)*

- [ ] **14. Two-factor authentication** — TOTP + backup codes, opt-in from the
      security area. Kept out of Phase 5 because it's markedly more complex and
      higher-risk; worth its own isolated change to the login flow.
- [ ] **15. Session improvements** — a token version so "sign out of all
      devices" works; clearer "session expired / you were logged out" messaging.

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
