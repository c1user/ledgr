# ROADMAP V4 — Production launch & multi-platform

Everything between today's dev setup and real users running Abaco as a
downloadable desktop app and an Apple/Google store app. Feature work is done
(V1–V3); this roadmap is packaging, infrastructure, billing, and compliance.

**The one architectural fact that shapes everything:** Abaco is a
client-server app. The Express API + PostgreSQL + S3 + Anthropic backend must
run on a server **no matter which client ships**. The desktop and mobile
"apps" are shells around the same frontend, talking to that hosted API.
Nothing in Phases 4–6 can even be tested until Phase 1 exists.

**On the "do I still need a web version?" question — yes, keep it.** Three
reasons, in order of force:
1. Every email the app sends — team invites, password resets, email
   verification, unsubscribe links — points at a **web URL** (`APP_URL`).
   Without a web deployment those flows dead-end, and replacing them with
   native deep links is significant extra work on every platform.
2. The marginal cost is ~zero: the frontend is already built and the backend
   must be hosted anyway. The web app is a static folder on the same infra.
3. It's the escape hatch while store reviews are pending, when a store build
   is broken, and for users on Chromebooks/Linux/work machines. The PWA
   (already built) even gives them an "installed app" feel for free.

**Why this order.** Infrastructure first (everything depends on a hosted
API); billing second (the app stores need to know the monetization story
before review, and testers can exercise it); web launch third (it's the
cheapest client and validates production end-to-end); desktop fourth (no
gatekeeper, fast iteration); mobile last (store review cycles have the
longest lead times and the most requirements).

---

## Phase 0 — Owner accounts & decisions  *(no code; start these NOW — some have lead times)*

- [ ] **0.1 Domain name** (~$12/yr) — needed by email (SPF/DKIM), APP_URL,
      CORS, deep links, store listings. Everything downstream references it.
- [ ] **0.2 GitHub (or GitLab) repo** — hosting platforms and CI deploy from
      it; also your off-machine backup of the code.
- [ ] **0.3 Hosting accounts** — backend host (Render/Railway/Fly/a VPS),
      managed PostgreSQL (Neon/Supabase/host-provided), and a static host
      for the web frontend (Cloudflare Pages/Netlify/Vercel). Budget
      $0–25/mo to start.
- [ ] **0.4 Email provider** + SPF/DKIM/DMARC DNS on the domain
      (SES/Postmark/Resend; free tiers cover a beta).
- [ ] **0.5 Stripe account** — activation + identity verification can take
      days; start early.
- [ ] **0.6 Apple Developer Program** — $99/yr, required for the iOS app AND
      for signing/notarizing the macOS desktop build. Enrollment can take
      days.
- [ ] **0.7 Google Play Console** — $25 one-time. NOTE: new personal
      accounts must run a closed test with ~12 testers for 14 days before
      production access — this is the single longest lead-time item; start
      it as soon as an Android build exists.
- [ ] **0.8 Windows code signing** — unsigned installers trigger SmartScreen
      warnings that will scare testers. Cheapest sane route: Azure Trusted
      Signing (~$10/mo). Classic OV/EV certs run $100–400/yr.
- [ ] **0.9 Legal sign-off** — counsel review of Terms/Privacy (then flip
      `DRAFT = false` in LegalPage.jsx). Stores REQUIRE a live privacy
      policy URL.
- [ ] **0.10 Support inbox** (SUPPORT_EMAIL) + decide FAQ/status page.
- [ ] **0.11 Product decisions** — final app name/branding check ("Abaco"
      availability in both stores), pricing for the three tiers, free-trial
      policy, whether the demo accounts exist in production (recommend: no;
      use a "demo mode" seed per request instead).

## Phase 1 — Production backend & infrastructure  *(everything depends on this)*

- [ ] **1.1 Config hygiene** — remove the hardcoded
      `http://localhost:5000/api` in `frontend/src/lib/api.js` (env-driven
      `VITE_API_URL`, default `/api` relative); audit every URL/origin
      assumption (CORS_ORIGIN, APP_URL) into env.
- [ ] **1.2 Complete the migrations story** — generate the missing DDL
      migration for the ledger tables (`chart_of_accounts`,
      `journal_entries`, `journal_entry_lines`, the
      `account_ledger_balances` view live only in the dev DB today), and
      replace the one-file `npm run migrate` with a real runner that tracks
      applied migrations (a `schema_migrations` table). A fresh database
      must reach the current schema with one command — this is also your
      disaster-recovery story.
- [ ] **1.3 Deploy backend + database** — provision prod Postgres (SSL),
      run migrations, deploy the API with all secrets (fresh JWT_SECRET,
      ANTHROPIC_API_KEY, AWS keys, SMTP), point a subdomain at it
      (`api.yourdomain.com`), verify /health.
- [ ] **1.4 Production S3 bucket** — separate from dev, private ACLs,
      lifecycle rules; new IAM user scoped to just that bucket.
- [ ] **1.5 Automated DB backups** — daily snapshots + a tested restore.
      Accounting data is the product; this is non-negotiable before real
      books exist.
- [ ] **1.6 Error monitoring & logging** — Sentry (free tier) on backend +
      frontend; structured request logging; an uptime monitor on /health.
- [ ] **1.7 Wire email for real** — SMTP env vars in prod, send test
      invite/reset/verification emails to a real inbox, confirm they land
      (not spam).
- [ ] **1.8 CI** — GitHub Actions running the backend test suite + frontend
      lint/build on every push (the pre-commit hook's checks, enforced
      server-side), auto-deploy on main.
- [ ] **1.9 Security pass for exposure** — helmet/CSP re-check against the
      real domain, rate limits sanity-check under production traffic
      patterns, dependency audit (`npm audit`), and rotate any secret that
      ever lived in dev.

## Phase 2 — Billing (Stripe)  *(the last big feature; gates real launch)*

- [ ] **2.1 Stripe products/prices** for Starter/Professional/Premium
      (monthly + yearly), tax settings for PR IVU on SaaS (counsel/CPA
      question).
- [ ] **2.2 Checkout + customer portal** — subscribe/upgrade/downgrade/cancel
      via Stripe-hosted pages (fastest, PCI-free); `businesses` gains
      stripe_customer_id/subscription_id/status columns.
- [ ] **2.3 Webhooks → entitlements** — subscription events set
      `businesses.plan`; grace period on failed payments; the existing
      entitlement gates then enforce everything automatically.
- [ ] **2.4 Free-trial policy** — recommend 30 days of Premium on signup,
      then pick-a-plan; the Plans page swaps its instant switcher for
      Stripe flows.
- [ ] **2.5 Dunning & billing emails** — payment failed / card expiring
      (Stripe can send these; enable and brand them).
- [ ] **2.6 The Apple question (decide now, build in Phase 6)** — Apple
      takes 15–30% of digital subscriptions sold *inside* iOS apps and
      requires their In-App Purchase system. The pragmatic pattern for
      B2B SaaS: the iOS app is **sign-in only** (no purchase, no pricing
      links) and subscriptions are bought on the web. Decide this policy
      now — it determines Phase 6 scope (native IAP integration is weeks of
      extra work and 15–30% margin).

## Phase 3 — Web production launch  *(cheapest client; validates everything)*

- [ ] **3.1 Deploy frontend** to the static host under the real domain,
      pointed at the prod API; verify the full email loop (register →
      verify → invite → reset) end-to-end in production.
- [ ] **3.2 PWA check on prod** — manifest/service-worker over HTTPS on the
      real domain; installability on desktop + Android.
- [ ] **3.3 Seed policy** — no demo accounts in prod (or a controlled one
      with a rotating password); disable/level-gate anything dev-only.
- [ ] **3.4 Soft-launch to your testers** on production infra — this
      replaces the tunnel/free-host testing plan with the real thing.

## Phase 4 — Desktop downloadable (Tauri)  *(no gatekeepers; ship first)*

- [ ] **4.1 Tauri shell** around the built frontend calling the hosted API;
      window sizing/menus/icons; external links open in the OS browser.
- [ ] **4.2 Desktop niceties** — file save dialogs for PDF/CSV/JSON exports
      (today they "download"), optional system-tray/notification hooks into
      the existing notification bell.
- [ ] **4.3 Auto-update** — Tauri updater against a manifest you host;
      without it every release is a manual re-download.
- [ ] **4.4 Code signing** — Windows via Azure Trusted Signing (0.8), macOS
      signing + notarization via the Apple Developer account (0.6);
      unsigned builds are effectively unshippable to normal users.
- [ ] **4.5 Installers + download page** — .msi/.exe and .dmg on a
      /download page of the website. (Microsoft Store / Mac App Store
      listings are optional extras later — they add sandboxing and review
      requirements; direct download is the fast path.)
- [ ] **4.6 Deep-link handling** — register an `abaco://` protocol so email
      links can open the desktop app when installed (fallback stays web).

## Phase 5 — Mobile store apps (Capacitor)  *(longest lead times; start store admin early)*

- [ ] **5.1 Capacitor wrap** of the existing frontend (iOS + Android
      projects), pointed at the prod API; safe-area/status-bar/keyboard
      handling.
- [ ] **5.2 Mobile UX audit** — the app is responsive, but store-quality
      needs a pass on the dense tables (Transactions, Payroll), modals on
      small screens, and touch targets. Budget real time here; this is
      what separates "wrapped website" rejections from approvals.
- [ ] **5.3 Native camera receipt capture** — replace the file input with
      the Capacitor camera plugin; this is the single biggest mobile win
      for a bookkeeping app (snap the receipt at the register).
- [ ] **5.4 Deep links** (iOS Universal Links + Android App Links) so
      invite/reset/verification emails open the app when installed.
- [ ] **5.5 Push notifications (optional, can ship v1.1)** — FCM/APNs wired
      to the existing notification events; the in-app bell already covers
      the need at launch.
- [ ] **5.6 Store compliance package** — privacy policy URL (0.9), Apple
      privacy "nutrition labels" + Google Data Safety form (the Privacy
      Policy already discloses everything — transcribe it), account
      deletion requirement (✔ already built — close business), sign-in
      policy per the 2.6 decision, screenshots/descriptions in EN + ES.
- [ ] **5.7 Beta channels** — TestFlight (iOS) + Play closed testing
      (Android; satisfies the 14-day/12-tester requirement from 0.7) using
      your test group.
- [ ] **5.8 Store submissions** — expect at least one rejection round each;
      Apple commonly pushes back on wrapped apps (5.2 is the mitigation)
      and on anything smelling like external purchases (2.6).

## Phase 6 — Launch & operate

- [ ] **6.1 Launch checklist** — DRAFT flags off, demo data out, backups
      verified, monitoring alerting to your inbox, support inbox monitored,
      status page decision.
- [ ] **6.2 Post-launch ops rhythm** — weekly dependency updates, DB
      restore drill once, error-budget review of Sentry.
- [ ] **6.3 Analytics decision** — if you add product analytics now, this
      is the moment the deferred cookie banner (V3 item 20) becomes
      required. Recommend a privacy-light option (self-hosted or
      cookie-less) to keep the banner unnecessary.
- [ ] **6.4 Deferred features, post-launch** — Plaid bank feeds, Apple IAP
      (if 2.6 decided against sign-in-only), Microsoft/Mac App Store
      listings, marketing site.

---

**Cost floor to launch all three platforms:** domain ~$12/yr · hosting
$0–25/mo · Apple $99/yr · Google $25 once · Windows signing ~$10/mo ·
Stripe (per-transaction only) · SMTP/Sentry free tiers. Roughly **$250 for
year one** plus per-use Anthropic/S3 costs.

**Critical path:** 0.1→1.3→3.1 makes the product real; 0.7's 14-day Android
test and 0.6's enrollment are the clocks to start first; everything in
Phase 4 can proceed in parallel with Phase 5's store admin.
