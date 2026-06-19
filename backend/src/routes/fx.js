import express from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);

// Frankfurter is a free, open-source ECB-backed exchange rate API (no auth required).
// Rates are based on the European Central Bank's daily reference rates.
const FRANKFURTER = "https://api.frankfurter.app";

// GET /api/fx-rates?base=EUR&target=USD&date=YYYY-MM-DD
// Returns: { base, target, date, rate } where rate = "1 {base} = {rate} {target}"
// so that: total_amount_in_base = original_amount * rate
router.get("/", async (req, res) => {
  const { base, target, date } = req.query;

  if (!base || !target) {
    return res
      .status(400)
      .json({ error: "base and target query params are required" });
  }

  const baseCur = base.toUpperCase().trim();
  const targetCur = target.toUpperCase().trim();

  // Same currency — rate is always exactly 1
  if (baseCur === targetCur) {
    return res.json({ base: baseCur, target: targetCur, date: date || null, rate: 1 });
  }

  const rateDate = date || new Date().toISOString().slice(0, 10);

  try {
    // Check the cache first
    const cached = await pool.query(
      "SELECT rate FROM fx_rate_cache WHERE base = $1 AND target = $2 AND rate_date = $3",
      [baseCur, targetCur, rateDate],
    );
    if (cached.rows.length > 0) {
      return res.json({
        base: baseCur,
        target: targetCur,
        date: rateDate,
        rate: parseFloat(cached.rows[0].rate),
      });
    }

    // Fetch from Frankfurter — ?from=EUR&to=USD on a specific date
    const apiUrl = `${FRANKFURTER}/${rateDate}?from=${baseCur}&to=${targetCur}`;
    const response = await fetch(apiUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const msg = body?.message || `HTTP ${response.status}`;
      console.warn(`[fx] Frankfurter error: ${msg}`);
      // Weekends / holidays: Frankfurter redirects to nearest business day.
      // A 404 means the currency pair is unsupported.
      if (response.status === 404) {
        return res.status(404).json({
          error: `No rate available for ${baseCur}/${targetCur} — enter manually`,
        });
      }
      return res
        .status(502)
        .json({ error: "Exchange rate provider unavailable — enter rate manually" });
    }

    const data = await response.json();

    if (!data.rates || data.rates[targetCur] == null) {
      return res.status(404).json({
        error: `Rate not found for ${baseCur}/${targetCur} — enter manually`,
      });
    }

    const rate = data.rates[targetCur];
    // Frankfurter may return a different date (e.g., Friday for a Saturday request)
    const actualDate = data.date || rateDate;

    // Cache both the requested date and the actual date (non-blocking)
    const insertSql = `
      INSERT INTO fx_rate_cache (base, target, rate_date, rate)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT DO NOTHING
    `;
    pool.query(insertSql, [baseCur, targetCur, rateDate, rate]).catch(() => {});
    if (actualDate !== rateDate) {
      pool.query(insertSql, [baseCur, targetCur, actualDate, rate]).catch(() => {});
    }

    return res.json({ base: baseCur, target: targetCur, date: actualDate, rate });
  } catch (err) {
    console.error("[fx] Rate fetch error:", err.message);
    return res
      .status(500)
      .json({ error: "Failed to fetch exchange rate — enter manually" });
  }
});

export default router;
