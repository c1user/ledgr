import express from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { postJournalEntry } from "../services/ledger.js";

const router = express.Router();
router.use(requireAuth);

// ── POST /api/inventory/receive ──────────────────────────────
// Adds stock; optionally creates a purchase (expense) transaction
router.post("/receive", async (req, res) => {
  const { businessId, userId } = req.user;
  const {
    productId, quantity, unitCost, notes,
    createTransaction, accountId, date, categoryId,
  } = req.body;

  if (!productId) return res.status(400).json({ error: "productId is required" });
  const qty = parseFloat(quantity);
  if (!qty || qty <= 0) return res.status(400).json({ error: "quantity must be greater than 0" });
  const cost = parseFloat(unitCost) || 0;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const productRes = await client.query(
      "SELECT id, name, qty_on_hand, unit_cost, valuation_method FROM products WHERE id = $1 AND business_id = $2",
      [productId, businessId],
    );
    if (productRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Product not found" });
    }
    const product = productRes.rows[0];

    let transactionId = null;
    if (createTransaction && accountId && date) {
      const totalAmount = qty * cost;

      // The purchase must post through the double-entry ledger like any other
      // expense: DR the chosen expense (COA) account, CR the funding account's
      // ledger twin. No direct balance mutation — balances derive from the ledger.
      const acctRes = await client.query(
        `SELECT id, coa_account_id FROM accounts WHERE id = $1 AND business_id = $2`,
        [accountId, businessId],
      );
      if (acctRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Funding account not found" });
      }
      if (!acctRes.rows[0].coa_account_id) {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({ error: "Funding account has no linked ledger account" });
      }
      if (!categoryId) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "An expense category is required to record the purchase",
        });
      }
      const catRes = await client.query(
        `SELECT id FROM chart_of_accounts
         WHERE id = $1 AND business_id = $2 AND account_type = 'expense'
           AND is_active = TRUE`,
        [categoryId, businessId],
      );
      if (catRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({ error: "Category must be an active expense account" });
      }

      const txRes = await client.query(
        `INSERT INTO transactions
           (business_id, account_id, created_by, date, merchant, total_amount, type, is_split, notes, product_id, qty)
         VALUES ($1, $2, $3, $4, $5, $6, 'expense', false, $7, $8, $9) RETURNING id`,
        [businessId, accountId, userId, date, product.name, totalAmount, notes || null, productId, qty],
      );
      transactionId = txRes.rows[0].id;

      await postJournalEntry(client, {
        businessId,
        date,
        description: `Inventory purchase: ${product.name}`,
        sourceType: "transaction",
        sourceId: transactionId,
        createdBy: userId,
        lines: [
          { accountId: categoryId, debit: totalAmount },
          { accountId: acctRes.rows[0].coa_account_id, credit: totalAmount },
        ],
      });
    }

    await client.query(
      `INSERT INTO inventory_movements
         (business_id, product_id, movement_type, quantity, unit_cost, transaction_id, notes)
       VALUES ($1, $2, 'receive', $3, $4, $5, $6)`,
      [businessId, productId, qty, cost, transactionId, notes || null],
    );

    // Update qty and weighted-average cost (FIFO just records movements; avg updates unit_cost)
    const oldQty = parseFloat(product.qty_on_hand);
    const oldCost = parseFloat(product.unit_cost);
    let newUnitCost = oldCost;
    if (product.valuation_method === "avg") {
      const newQty = oldQty + qty;
      newUnitCost = newQty > 0 ? (oldQty * oldCost + qty * cost) / newQty : cost;
    } else if (cost > 0) {
      newUnitCost = cost;
    }

    const updatedProduct = await client.query(
      "UPDATE products SET qty_on_hand = qty_on_hand + $1, unit_cost = $2 WHERE id = $3 AND business_id = $4 RETURNING *",
      [qty, newUnitCost, productId, businessId],
    );

    await client.query("COMMIT");
    return res.status(201).json({ product: updatedProduct.rows[0], transactionId });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Receive inventory error:", err);
    return res.status(500).json({ error: "Failed to receive inventory" });
  } finally {
    client.release();
  }
});

// ── POST /api/inventory/adjust ───────────────────────────────
// Manual +/- quantity adjustment with a reason
router.post("/adjust", async (req, res) => {
  const { businessId } = req.user;
  const { productId, quantity, notes } = req.body;

  if (!productId) return res.status(400).json({ error: "productId is required" });
  const delta = parseFloat(quantity);
  if (!delta || isNaN(delta)) return res.status(400).json({ error: "quantity must be non-zero" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const productRes = await client.query(
      "SELECT id, qty_on_hand, unit_cost FROM products WHERE id = $1 AND business_id = $2",
      [productId, businessId],
    );
    if (productRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Product not found" });
    }
    const product = productRes.rows[0];

    if (parseFloat(product.qty_on_hand) + delta < 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Adjustment would result in negative stock" });
    }

    await client.query(
      `INSERT INTO inventory_movements
         (business_id, product_id, movement_type, quantity, unit_cost, notes)
       VALUES ($1, $2, 'adjustment', $3, $4, $5)`,
      [businessId, productId, delta, product.unit_cost, notes || null],
    );

    const updatedProduct = await client.query(
      "UPDATE products SET qty_on_hand = qty_on_hand + $1 WHERE id = $2 AND business_id = $3 RETURNING *",
      [delta, productId, businessId],
    );

    await client.query("COMMIT");
    return res.status(201).json(updatedProduct.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Adjust inventory error:", err);
    return res.status(500).json({ error: "Failed to adjust inventory" });
  } finally {
    client.release();
  }
});

// ── GET /api/inventory/valuation ─────────────────────────────
// Returns stock value per product; FIFO computed from movement history
router.get("/valuation", async (req, res) => {
  const { businessId } = req.user;
  try {
    const productsRes = await pool.query(
      `SELECT p.id, p.name, p.sku, p.qty_on_hand, p.unit_cost, p.valuation_method,
              c.name_key AS category_name_key, c.name AS category_name
       FROM products p
       LEFT JOIN chart_of_accounts c ON c.id = p.category_id
       WHERE p.business_id = $1 AND p.is_active = TRUE
       ORDER BY p.name ASC`,
      [businessId],
    );

    const fifoIds = productsRes.rows
      .filter((p) => p.valuation_method === "fifo")
      .map((p) => p.id);

    let movementsByProduct = {};
    if (fifoIds.length > 0) {
      const movRes = await pool.query(
        `SELECT product_id, movement_type, quantity, unit_cost, created_at
         FROM inventory_movements
         WHERE product_id = ANY($1) AND business_id = $2
         ORDER BY product_id, created_at ASC`,
        [fifoIds, businessId],
      );
      for (const m of movRes.rows) {
        if (!movementsByProduct[m.product_id]) movementsByProduct[m.product_id] = [];
        movementsByProduct[m.product_id].push(m);
      }
    }

    const rows = productsRes.rows.map((p) => {
      const qty = parseFloat(p.qty_on_hand);
      let stockValue;

      if (p.valuation_method === "avg") {
        stockValue = qty * parseFloat(p.unit_cost);
      } else {
        // FIFO: consume layers oldest-first; remaining layers = current value
        const layers = [];
        for (const m of movementsByProduct[p.id] || []) {
          const mQty = parseFloat(m.quantity);
          if (m.movement_type === "receive" || m.movement_type === "return") {
            layers.push({ qty: mQty, cost: parseFloat(m.unit_cost) || 0 });
          } else {
            let toConsume = Math.abs(mQty);
            while (toConsume > 0 && layers.length > 0) {
              if (layers[0].qty <= toConsume) {
                toConsume -= layers[0].qty;
                layers.shift();
              } else {
                layers[0].qty -= toConsume;
                toConsume = 0;
              }
            }
          }
        }
        stockValue = layers.reduce((sum, l) => sum + l.qty * l.cost, 0);
      }

      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        category_name: p.category_name,
        qty_on_hand: qty,
        unit_cost: parseFloat(p.unit_cost),
        valuation_method: p.valuation_method,
        stock_value: parseFloat(stockValue.toFixed(2)),
      };
    });

    const total_value = parseFloat(
      rows.reduce((s, r) => s + r.stock_value, 0).toFixed(2),
    );

    return res.json({ products: rows, total_value });
  } catch (err) {
    console.error("Valuation error:", err);
    return res.status(500).json({ error: "Failed to compute valuation" });
  }
});

export default router;
