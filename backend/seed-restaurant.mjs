/**
 * seed-restaurant.mjs — one-shot demo seeder: "El Fogón Criollo", a Santurce
 * restaurant with two years of books (Aug 2024 – Jul 2026).
 *
 * Everything goes through the real HTTP API so the ledger, audit trail, and
 * validations behave exactly as they would for a live user. Paced under the
 * 200 req/min general limiter. The pg pool is used ONLY for read-side helpers
 * (reconciliation math) and one cosmetic update at the end.
 *
 * The cost structure targets a believable small-restaurant P&L:
 * ~31% food cost, ~30% payroll (incl. employer burden), card + delivery
 * platform fees, and a ~10% net margin.
 *
 * Run:  node seed-restaurant.mjs
 * Rerun after a partial failure: close the business first
 * (DELETE /api/business) — the script is not idempotent.
 */

import "dotenv/config";
import pool from "./src/config/db.js";

const API = "http://localhost:5000/api";
const EMAIL = "fogon@ledgr.test";
const PASSWORD = "FogonCriollo2026!";
const BIZ_NAME = "El Fogón Criollo";

let TOKEN = "";
let calls = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  calls++;
  if (calls % 150 === 0) console.log(`  … ${calls} API calls`);
  await sleep(370); // ~160/min, under the 200/min limiter
  const res = await fetch(API + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${data.error || JSON.stringify(data)}`);
  }
  return data;
}

// Deterministic PRNG so reruns produce the same books.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260728);
const between = (lo, hi) => lo + rnd() * (hi - lo);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const round2 = (n) => Math.round(n * 100) / 100;

const iso = (d) => d.toISOString().slice(0, 10);
const day = (y, m, dd) => new Date(Date.UTC(y, m - 1, dd));
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const lastOfMonth = (y, m) => iso(addDays(day(m === 12 ? y + 1 : y, (m % 12) + 1, 1), -1));

const START = day(2024, 8, 1);
const END = day(2026, 7, 27);

// Mirrors SIGNED_SUM in routes/reconciliations.js.
async function signedSum(accountId, from, to) {
  const r = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN type = 'income'
              THEN total_amount - COALESCE(withholding_amount, 0)
              ELSE -(total_amount - COALESCE(withholding_amount, 0)) END), 0) AS s
     FROM transactions
     WHERE account_id = $1 AND date >= $2 AND date <= $3`,
    [accountId, from, to],
  );
  return parseFloat(r.rows[0].s);
}

// ── main ─────────────────────────────────────────────────────
async function main() {
  console.log("Registering", BIZ_NAME, "…");
  const reg = await api("POST", "/auth/register", {
    businessName: BIZ_NAME,
    email: EMAIL,
    password: PASSWORD,
    taxId: "66-0891234",
    currency: "USD",
    consent: true,
  });
  TOKEN = reg.token;

  await api("PUT", "/business/plan", { plan: "premium" });
  await api("PUT", "/business", {
    name: BIZ_NAME,
    taxId: "66-0891234",
    address: "1552 Calle Loíza",
    city: "San Juan",
    state: "PR",
    zip: "00911",
  });

  // ── Accounts ──────────────────────────────────────────────
  const checking = await api("POST", "/accounts", {
    name: "Banco Popular Checking",
    type: "current",
    currentBalance: 12000,
  });
  const cashReg = await api("POST", "/accounts", {
    name: "Caja registradora",
    type: "cash",
    currentBalance: 750,
  });
  const checkingId = checking.id || checking.account?.id;
  const cashId = cashReg.id || cashReg.account?.id;
  if (!checkingId || !cashId) throw new Error("account ids missing");

  // ── Chart of accounts: find seeded, create restaurant-specific ─
  const coaResp = await api("GET", "/chart-of-accounts");
  const flat = [];
  (function collect(x) {
    if (Array.isArray(x)) return x.forEach(collect);
    if (x && typeof x === "object") {
      if (x.id && x.account_type && (x.name || x.name_key)) flat.push(x);
      Object.values(x).forEach(collect);
    }
  })(coaResp);
  const findCoa = (type, ...needles) =>
    flat.find(
      (a) =>
        a.account_type === type &&
        needles.some((n) =>
          `${a.name || ""} ${a.name_key || ""}`.toLowerCase().includes(n),
        ),
    );
  async function ensureCoa(type, code, name, ...needles) {
    const hit = findCoa(type, ...needles);
    if (hit) return hit.id;
    const made = await api("POST", "/chart-of-accounts", {
      name,
      accountType: type,
      code,
    });
    return made.id;
  }

  const CAT = {
    foodSales: await ensureCoa("revenue", "4110", "Food Sales", "food sales"),
    bevSales: await ensureCoa("revenue", "4120", "Beverage Sales", "beverage sales"),
    catering: await ensureCoa("revenue", "4130", "Catering Income", "catering"),
    food: await ensureCoa("expense", "5110", "Food & Ingredients", "food & ingredients", "cost_of_goods", "cost of goods"),
    beverages: await ensureCoa("expense", "5120", "Beverage Purchases", "beverage purchases"),
    supplies: await ensureCoa("expense", "5210", "Restaurant Supplies", "supplies"),
    wages: await ensureCoa("expense", "5310", "Wages & Payroll", "payroll", "salaries", "wages"),
    rent: await ensureCoa("expense", "5410", "Rent", "rent"),
    utilities: await ensureCoa("expense", "5420", "Utilities", "utilities"),
    insurance: await ensureCoa("expense", "5430", "Insurance", "insurance"),
    marketing: await ensureCoa("expense", "5440", "Marketing", "marketing", "advertising"),
    repairs: await ensureCoa("expense", "5450", "Repairs & Maintenance", "repairs", "maintenance"),
    cardFees: await ensureCoa("expense", "5460", "Bank & Card Fees", "bank & card", "card fees", "bank fees"),
    delivery: await ensureCoa("expense", "5470", "Delivery Platform Fees", "delivery platform"),
    cleaning: await ensureCoa("expense", "5480", "Cleaning & Sanitation", "cleaning", "sanitation"),
    professional: await ensureCoa("expense", "5490", "Professional Services", "professional"),
  };

  // ── Vendors ───────────────────────────────────────────────
  const vendors = {};
  for (const [key, v] of Object.entries({
    borinquen: { name: "Distribuidora Borinquen", city: "Bayamón" },
    produce: { name: "Productos del País SA", city: "Caguas" },
    cerveza: { name: "Cervecera del Caribe Dist.", city: "San Juan" },
    landlord: { name: "Inversiones Santurce LLC", city: "San Juan" },
    luma: { name: "LUMA Energy", city: "San Juan" },
    aaa: { name: "AAA Acueductos", city: "San Juan" },
    internet: { name: "Liberty Business", city: "San Juan" },
    gas: { name: "Empire Gas PR", city: "Guaynabo" },
    seguro: { name: "MAPFRE Seguros", city: "San Juan" },
    depot: { name: "Restaurant Depot Caguas", city: "Caguas" },
    publicidad: { name: "Publicidad Isla Media", city: "San Juan" },
    procesadora: { name: "Isla Card Processing", city: "San Juan" },
    pideya: { name: "PideYa Delivery", city: "San Juan" },
    ambientales: { name: "Servicios Ambientales CRB", city: "Cataño" },
    cpa: {
      name: "Contabilidad Méndez CPA",
      city: "San Juan",
      ein: "66-0654321",
      is_1099_eligible: true,
    },
    torres: {
      name: "Refrigeración Torres",
      city: "Carolina",
      ein: "66-0712345",
      is_1099_eligible: true,
    },
  })) {
    const made = await api("POST", "/vendors", { state: "PR", ...v });
    vendors[key] = made.id || made.vendor?.id;
  }

  // ── Clients (catering) ────────────────────────────────────
  const clientIds = [];
  for (const c of [
    { name: "Oficina Legal Rivera & Asoc.", billing_email: "admin@riveralegal.test", payment_terms_days: 30 },
    { name: "Colegio San Ignacio", billing_email: "eventos@csi.test", payment_terms_days: 30 },
    { name: "Bodas y Eventos Karla", billing_email: "karla@bodaskarla.test", payment_terms_days: 15 },
    { name: "Laboratorios Coquí Inc.", billing_email: "compras@labcoqui.test", payment_terms_days: 45 },
    { name: "Cooperativa de Ahorro Santurce", billing_email: "actividades@coopsanturce.test", payment_terms_days: 30 },
  ]) {
    const made = await api("POST", "/clients", { city: "San Juan", state: "PR", ...c });
    clientIds.push(made.id || made.client?.id);
  }

  // ── Employees (all hourly — typical for a small restaurant) ─
  const employees = [];
  for (const e of [
    { name: "Carmen Delgado", payRate: 18.5, ssnLast4: "4821", startDate: "2023-03-01" }, // head cook
    { name: "Luis Ortiz", payRate: 14.0, ssnLast4: "9034", startDate: "2023-11-15" }, // cook
    { name: "Wanda Cruz", payRate: 12.0, ssnLast4: "5518", startDate: "2024-02-01" }, // prep cook
    { name: "María Fernández", payRate: 10.5, ssnLast4: "2277", startDate: "2024-01-10" }, // server
    { name: "Pedro Colón", payRate: 10.5, ssnLast4: "6612", startDate: "2024-05-20" }, // server
    { name: "Yolanda Nieves", payRate: 10.5, ssnLast4: "8103", startDate: "2024-06-15" }, // server
    { name: "Ana Vázquez", payRate: 11.25, ssnLast4: "3390", startDate: "2024-06-01" }, // cashier
    { name: "Jorge Meléndez", payRate: 10.5, ssnLast4: "7845", startDate: "2024-07-01" }, // dishwasher
    { name: "Ramón Soto", payRate: 10.5, ssnLast4: "1264", startDate: "2024-07-15" }, // porter
  ]) {
    const made = await api("POST", "/employees", {
      name: e.name,
      ssnLast4: e.ssnLast4,
      payType: "hourly",
      payRate: e.payRate,
      payFrequency: "biweekly",
      prStateTaxRate: 0.04, // fraction, not percent — 4% PR withholding
      startDate: e.startDate,
    });
    employees.push({ id: made.id || made.employee?.id, ...e });
  }

  // ── Transactions: two years, chronological ────────────────
  console.log("Seeding two years of transactions (this is the long part) …");
  const txn = (body) => api("POST", "/transactions", body);

  const monthMult = { 1: 0.9, 7: 1.05, 9: 0.85, 10: 0.92, 11: 1.08, 12: 1.25 };
  let salesCount = 0;
  let expenseCount = 0;
  const monthCardSales = {}; // "YYYY-M" → card (checking) sales, drives fees

  for (let d = new Date(START); d <= END; d = addDays(d, 1)) {
    const dow = d.getUTCDay(); // 0=Sun … 6=Sat
    const date = iso(d);
    const m = d.getUTCMonth() + 1;
    const ym = `${d.getUTCFullYear()}-${m}`;
    const year2 = d >= day(2025, 8, 1) ? 1.09 : 1;
    const season = (monthMult[m] || 1) * year2;

    // Daily sales — closed Mondays.
    if (dow !== 1) {
      const base = { 0: 1750, 2: 1200, 3: 1250, 4: 1350, 5: 2100, 6: 2350 }[dow];
      const total = round2(base * season * between(0.82, 1.18) + between(0, 0.99));
      const foodPct = between(0.76, 0.82);
      const food = round2(total * foodPct);
      const bev = round2(total - food);
      await txn({
        accountId: checkingId,
        date,
        merchant: "Ventas del día",
        totalAmount: total,
        type: "income",
        splits: [
          { categoryId: CAT.foodSales, amount: food },
          { categoryId: CAT.bevSales, amount: bev },
        ],
      });
      monthCardSales[ym] = (monthCardSales[ym] || 0) + total;
      salesCount++;
    }

    // Weekly cash-register sales, deposited Sundays.
    if (dow === 0) {
      const total = round2(between(750, 1500) * season);
      const food = round2(total * 0.8);
      await txn({
        accountId: cashId,
        date,
        merchant: "Ventas en efectivo — semana",
        totalAmount: total,
        type: "income",
        splits: [
          { categoryId: CAT.foodSales, amount: food },
          { categoryId: CAT.bevSales, amount: round2(total - food) },
        ],
      });
      salesCount++;
    }

    // Suppliers: food distributor Tue & Fri, produce Wed, beverages Thu.
    if (dow === 2 || dow === 5) {
      await txn({
        accountId: checkingId, date, merchant: "Distribuidora Borinquen",
        totalAmount: round2(between(1000, 2100) * year2), type: "expense",
        categoryId: CAT.food, vendorId: vendors.borinquen,
      });
      expenseCount++;
    }
    if (dow === 3) {
      await txn({
        accountId: checkingId, date, merchant: "Productos del País",
        totalAmount: round2(between(320, 680) * year2), type: "expense",
        categoryId: CAT.food, vendorId: vendors.produce,
      });
      expenseCount++;
    }
    if (dow === 4) {
      await txn({
        accountId: checkingId, date, merchant: "Cervecera del Caribe",
        totalAmount: round2(between(420, 780) * year2), type: "expense",
        categoryId: CAT.beverages, vendorId: vendors.cerveza,
      });
      expenseCount++;
    }

    const dd = d.getUTCDate();
    // Monthly bills.
    if (dd === 1) {
      await txn({
        accountId: checkingId, date, merchant: "Renta local — Calle Loíza",
        totalAmount: 3400, type: "expense",
        categoryId: CAT.rent, vendorId: vendors.landlord,
      });
      expenseCount++;
    }
    if (dd === 3) {
      await txn({
        accountId: checkingId, date, merchant: "Servicios Ambientales — recogido y fumigación",
        totalAmount: round2(between(580, 720)), type: "expense",
        categoryId: CAT.cleaning, vendorId: vendors.ambientales,
      });
      expenseCount++;
    }
    if (dd === 5) {
      // Electricity: heavier Jun–Sep (air conditioning season).
      const ac = m >= 6 && m <= 9 ? 1.25 : 1;
      await txn({
        accountId: checkingId, date, merchant: "LUMA Energy",
        totalAmount: round2(between(780, 1150) * ac), type: "expense",
        categoryId: CAT.utilities, vendorId: vendors.luma,
      });
      await txn({
        accountId: checkingId, date, merchant: "AAA Acueductos",
        totalAmount: round2(between(210, 320)), type: "expense",
        categoryId: CAT.utilities, vendorId: vendors.aaa,
      });
      expenseCount += 2;
    }
    if (dd === 8) {
      await txn({
        accountId: checkingId, date, merchant: "Liberty Business",
        totalAmount: 109.99, type: "expense",
        categoryId: CAT.utilities, vendorId: vendors.internet,
      });
      await txn({
        accountId: checkingId, date, merchant: "Empire Gas — propano",
        totalAmount: round2(between(260, 450)), type: "expense",
        categoryId: CAT.utilities, vendorId: vendors.gas,
      });
      expenseCount += 2;
    }
    if (dd === 12) {
      await txn({
        accountId: checkingId, date, merchant: "Restaurant Depot",
        totalAmount: round2(between(180, 520)), type: "expense",
        categoryId: CAT.supplies, vendorId: vendors.depot,
      });
      expenseCount++;
    }
    // Quarterly insurance (Feb/May/Aug/Nov on the 15th).
    if (dd === 15 && [2, 5, 8, 11].includes(m)) {
      await txn({
        accountId: checkingId, date, merchant: "MAPFRE — póliza comercial",
        totalAmount: 1950, type: "expense",
        categoryId: CAT.insurance, vendorId: vendors.seguro,
      });
      expenseCount++;
    }
    // Monthly CPA retainer — professional services, 10% withholding.
    if (dd === 28) {
      await txn({
        accountId: checkingId, date, merchant: "Contabilidad Méndez CPA",
        totalAmount: 400, type: "expense",
        categoryId: CAT.professional, vendorId: vendors.cpa,
        withholdingAmount: 40,
      });
      expenseCount++;
    }
    // Marketing every ~6 weeks (on the 20th of even months).
    if (dd === 20 && m % 2 === 0) {
      await txn({
        accountId: checkingId, date, merchant: "Publicidad Isla Media",
        totalAmount: round2(between(150, 800)), type: "expense",
        categoryId: CAT.marketing, vendorId: vendors.publicidad,
      });
      expenseCount++;
    }
  }

  // Month-end fees driven by that month's actual card sales.
  for (const [ym, sales] of Object.entries(monthCardSales)) {
    const [y, m] = ym.split("-").map(Number);
    const date = lastOfMonth(y, m);
    if (new Date(date) > END) continue;
    await txn({
      accountId: checkingId, date, merchant: "Isla Card Processing — cargos del mes",
      totalAmount: round2(sales * between(0.024, 0.028)), type: "expense",
      categoryId: CAT.cardFees, vendorId: vendors.procesadora,
    });
    await txn({
      accountId: checkingId, date, merchant: "PideYa — comisiones plataforma",
      totalAmount: round2(sales * between(0.028, 0.038)), type: "expense",
      categoryId: CAT.delivery, vendorId: vendors.pideya,
    });
    expenseCount += 2;
  }

  // Payroll expense hits the books every other Friday (gross + employer burden).
  const paydays = [];
  for (let d = day(2024, 8, 9); d <= END; d = addDays(d, 14)) paydays.push(new Date(d));
  for (const d of paydays) {
    const year2 = d >= day(2025, 8, 1) ? 1.05 : 1;
    await txn({
      accountId: checkingId,
      date: iso(d),
      merchant: "Nómina quincenal",
      totalAmount: round2(between(6700, 7600) * year2),
      type: "expense",
      categoryId: CAT.wages,
    });
    expenseCount++;
  }

  // Refrigeration/AC service visits with 10% professional-services
  // withholding — feeds the Hacienda 480.6SP screen.
  for (const [y, m, dd, amt] of [
    [2024, 9, 18, 850], [2025, 1, 22, 480], [2025, 6, 10, 1900],
    [2025, 11, 4, 620], [2026, 3, 17, 540], [2026, 6, 25, 1150],
  ]) {
    await txn({
      accountId: checkingId,
      date: iso(day(y, m, dd)),
      merchant: "Refrigeración Torres — servicio",
      totalAmount: amt,
      type: "expense",
      categoryId: CAT.repairs,
      vendorId: vendors.torres,
      withholdingAmount: round2(amt * 0.1),
    });
    expenseCount++;
  }
  console.log(`  sales txns: ${salesCount}, expense txns: ${expenseCount}`);

  // ── Catering invoices ─────────────────────────────────────
  console.log("Seeding catering invoices …");
  const menus = [
    (n) => [
      { description: `Catering — almuerzo corporativo (${n} personas)`, quantity: n, unitPrice: round2(between(14, 22)) },
      { description: "Estación de café y postres", quantity: 1, unitPrice: round2(between(120, 260)) },
    ],
    (n) => [
      { description: `Buffet criollo — evento (${n} personas)`, quantity: n, unitPrice: round2(between(18, 28)) },
      { description: "Personal de servicio (4 hrs)", quantity: 2, unitPrice: 140 },
    ],
    (n) => [
      { description: `Bandejas familiares — actividad (${n} personas)`, quantity: n, unitPrice: round2(between(11, 16)) },
    ],
  ];
  let invoiceCount = 0;
  let paidCount = 0;
  for (let d = day(2024, 8, 21); d <= END; d = addDays(d, Math.round(between(19, 32)))) {
    const issueDate = iso(d);
    const dueDate = iso(addDays(d, 30));
    const people = Math.round(between(20, 90));
    const inv = await api("POST", "/invoices", {
      clientId: pick(clientIds),
      issueDate,
      dueDate,
      taxType: "ivu",
      taxRate: 11.5,
      incomeAccountId: CAT.catering,
      language: "es",
      lineItems: pick(menus)(people),
    });
    invoiceCount++;
    const invId = inv.id || inv.invoice?.id;
    const ageDays = (END - d) / 86400000;
    if (ageDays < 12) continue; // newest stays a draft
    await api("POST", `/invoices/${invId}/send`, {});
    if (ageDays < 45) continue; // recent ones stay sent (one will read overdue)
    await api("POST", `/invoices/${invId}/pay`, {
      accountId: checkingId,
      paidDate: iso(addDays(d, Math.round(between(8, 38)))),
    });
    paidCount++;
  }
  console.log(`  invoices: ${invoiceCount} (${paidCount} paid)`);

  // ── Payroll runs (biweekly, finalized) ────────────────────
  // Fenced: a late shape surprise must not abort the seeded books.
  console.log("Seeding payroll runs …");
  try {
    let runCount = 0;
    for (const payday of paydays) {
      const periodEnd = iso(addDays(payday, -1));
      const periodStart = iso(addDays(payday, -14));
      const hoursWorked = {};
      for (const e of employees) {
        const fullTime = e.payRate >= 12 ? between(72, 80) : between(38, 62);
        hoursWorked[e.id] = Math.round(fullTime);
      }
      const run = await api("POST", "/payroll", { periodStart, periodEnd, hoursWorked });
      const runId = run.id || run.run?.id;
      await api("PUT", `/payroll/${runId}/finalize`, {});
      runCount++;
    }
    console.log(`  payroll runs: ${runCount}`);
  } catch (e) {
    console.log("  (payroll seeding stopped:", e.message + ")");
  }

  // ── Budget for the current month ──────────────────────────
  try {
    await api("PUT", "/budgets", {
      period: "2026-07",
      lines: [
        { categoryId: CAT.food, amount: 16500 },
        { categoryId: CAT.beverages, amount: 2800 },
        { categoryId: CAT.wages, amount: 16000 },
        { categoryId: CAT.rent, amount: 3400 },
        { categoryId: CAT.utilities, amount: 2600 },
        { categoryId: CAT.cardFees, amount: 1300 },
        { categoryId: CAT.delivery, amount: 1800 },
        { categoryId: CAT.supplies, amount: 600 },
        { categoryId: CAT.cleaning, amount: 700 },
        { categoryId: CAT.marketing, amount: 500 },
      ],
    });
  } catch (e) {
    console.log("  (budget skipped:", e.message + ")");
  }

  // ── Recurring templates (next occurrences are upcoming) ───
  try {
    for (const r of [
      { merchant: "Renta local — Calle Loíza", amount: 3400, frequency: "monthly", startDate: "2026-08-01", categoryId: CAT.rent },
      { merchant: "Liberty Business", amount: 109.99, frequency: "monthly", startDate: "2026-08-08", categoryId: CAT.utilities },
      { merchant: "MAPFRE — póliza comercial", amount: 1950, frequency: "quarterly", startDate: "2026-08-15", categoryId: CAT.insurance },
    ]) {
      await api("POST", "/recurring", { type: "expense", accountId: checkingId, ...r });
    }
  } catch (e) {
    console.log("  (recurring skipped:", e.message + ")");
  }

  // ── One completed bank reconciliation (June 2026) ─────────
  console.log("Reconciling June 2026 …");
  try {
    const startBal = round2(12000 + (await signedSum(checkingId, "2000-01-01", "2026-05-31")));
    const juneDelta = round2(await signedSum(checkingId, "2026-06-01", "2026-06-30"));
    const juneIds = (
      await pool.query(
        "SELECT id FROM transactions WHERE account_id = $1 AND date >= '2026-06-01' AND date <= '2026-06-30'",
        [checkingId],
      )
    ).rows.map((r) => r.id);

    const recon = await api("POST", "/reconciliations", {
      accountId: checkingId,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
      statementStartBalance: startBal,
      statementEndBalance: round2(startBal + juneDelta),
    });
    const reconId = recon.id || recon.reconciliation?.id;
    await api("PUT", `/reconciliations/${reconId}/transactions`, { add: juneIds });
    await api("POST", `/reconciliations/${reconId}/complete`, {});
    console.log(`  June reconciled: ${juneIds.length} transactions locked`);
  } catch (e) {
    console.log("  (reconciliation skipped:", e.message + ")");
  }

  // Cosmetic: demo owner counts as verified (no SMTP to click a link).
  await pool.query(
    "UPDATE users SET email_verified = true, verify_token = NULL WHERE email = $1",
    [EMAIL],
  );

  const total = await signedSum(checkingId, "2000-01-01", "2027-01-01");
  console.log("DONE.");
  console.log(`  API calls: ${calls}`);
  console.log(`  Final checking balance: $${round2(12000 + total).toFixed(2)}`);
  await pool.end();
}

main().catch(async (e) => {
  console.error("SEED FAILED:", e.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
