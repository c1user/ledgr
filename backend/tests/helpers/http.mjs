/**
 * tests/helpers/http.mjs — HTTP integration harness (§1.5).
 *
 * Boots the REAL app (src/app.js: helmet, CORS, rate limits, audit trail,
 * plan gates — everything) on an ephemeral port, registers a throwaway
 * business through the real /api/auth/register, and tears it down through
 * the real close-business endpoint, so multi-tenant scoping and entitlement
 * gates are exercised exactly as production would.
 *
 * DB-dependent by nature: suites should try createTestBusiness() and
 * t.skip() when the database is unreachable (same convention as
 * ledger.test.mjs).
 */

import "dotenv/config";
import crypto from "node:crypto";

export const TEST_PASSWORD = "HttpHarness#2026!x";

/** Boot src/app.js on an ephemeral port. */
export async function startTestServer() {
  const { default: app } = await import("../../src/app.js");
  const server = app.listen(0);
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * Minimal fetch wrapper. Returns { status, headers, json, text } — json is
 * null when the body isn't JSON (downloads).
 */
export async function api(base, path, opts = {}) {
  const { method = "GET", token, body } = opts;
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body (CSV/PDF/fixed-width download) */
  }
  return { status: res.status, headers: res.headers, json, text };
}

/**
 * Register a throwaway business (unique email) through the real signup
 * flow — COA + payroll rules seeded exactly like production. Optionally
 * bump the plan (owner-only instant switch; Stripe isn't built yet).
 * Returns { token, businessId, businessName, email, destroy() }.
 */
export async function createTestBusiness(base, { plan } = {}) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const businessName = `HTTP Harness ${suffix}`;
  const email = `http-${suffix}@test.ledgr.local`;

  const reg = await api(base, "/api/auth/register", {
    method: "POST",
    body: {
      businessName,
      email,
      password: TEST_PASSWORD,
      consent: true,
    },
  });
  if (reg.status !== 201) {
    throw new Error(
      `test registration failed (${reg.status}): ${reg.json?.error || reg.text}`,
    );
  }
  const token = reg.json.token;

  if (plan && plan !== reg.json.business.plan) {
    const up = await api(base, "/api/business/plan", {
      method: "PUT",
      token,
      body: { plan },
    });
    if (up.status !== 200) {
      throw new Error(`plan bump failed (${up.status})`);
    }
  }

  return {
    token,
    businessId: reg.json.business.id,
    businessName,
    email,
    // Tear down through the real close-business flow: password + exact
    // name confirmation, full purge via businessData.js.
    destroy: async () => {
      const del = await api(base, "/api/business", {
        method: "DELETE",
        token,
        body: { password: TEST_PASSWORD, confirmName: businessName },
      });
      if (del.status !== 200) {
        console.error(
          `test-business cleanup failed (${del.status}): ${del.json?.error || ""} — orphaned: ${businessName}`,
        );
      }
    },
  };
}
