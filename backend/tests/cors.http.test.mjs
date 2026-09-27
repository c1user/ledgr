/**
 * tests/cors.http.test.mjs — CORS_ORIGIN accepts a comma-separated list.
 *
 * The native shells (Capacitor mobile, Tauri desktop) load the UI from a
 * webview origin that is NOT the website origin, so production must allow
 * several origins at once. This boots the real app with a multi-origin
 * CORS_ORIGIN and checks the preflight/echo behaviour against /health
 * (no auth, no DB needed).
 *
 * CORS_ORIGIN is read when src/app.js is first imported, so it is set here
 * BEFORE the harness imports the app (node --test runs each file in its own
 * process; dotenv never overrides an already-set variable).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.CORS_ORIGIN =
  "http://localhost:5173, capacitor://localhost,https://localhost,http://tauri.localhost";

const { startTestServer } = await import("./helpers/http.mjs");

let srv = null;
test.before(async () => {
  srv = await startTestServer();
});
test.after(async () => {
  if (srv) await srv.close();
});

const preflight = (origin) =>
  fetch(`${srv.base}/health`, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization",
    },
  });

test("every listed origin is echoed back (spaces around commas tolerated)", async () => {
  for (const origin of [
    "http://localhost:5173",
    "capacitor://localhost",
    "https://localhost",
    "http://tauri.localhost",
  ]) {
    const res = await preflight(origin);
    assert.equal(res.status, 204, `preflight status for ${origin}`);
    assert.equal(
      res.headers.get("access-control-allow-origin"),
      origin,
      `allow-origin for ${origin}`,
    );
    assert.equal(res.headers.get("access-control-allow-credentials"), "true");
    assert.match(
      res.headers.get("access-control-allow-headers") || "",
      /authorization/i,
    );
  }
});

test("an origin that is not listed gets no allow-origin header", async () => {
  const res = await preflight("https://evil.example");
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("a simple GET from a listed origin carries the echo too", async () => {
  const res = await fetch(`${srv.base}/health`, {
    headers: { Origin: "capacitor://localhost" },
  });
  assert.equal(res.status, 200);
  assert.equal(
    res.headers.get("access-control-allow-origin"),
    "capacitor://localhost",
  );
});
