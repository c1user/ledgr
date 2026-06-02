import express from "express";
import multer from "multer";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import {
  uploadReceiptToS3,
  getReceiptSignedUrl,
  deleteReceiptFromS3,
} from "../services/s3.js";
import { extractReceiptData } from "../services/claude.js";

const router = express.Router();

// Multer config — store in memory, not disk
// Max file size: 10MB
// Allowed types: JPEG, PNG, PDF, WEBP
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG, WEBP, and PDF files are allowed"));
    }
  },
});

// All routes require authentication
router.use(requireAuth);

// ── POST /api/receipts/upload ─────────────────────────────────
// Upload a receipt image, run AI extraction, save to DB
router.post("/upload", upload.single("receipt"), async (req, res) => {
  const { businessId, userId } = req.user;

  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  try {
    // 1. Upload image to S3
    const s3Key = await uploadReceiptToS3(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
    );

    // 2. Extract data with Claude AI
    let aiData = {
      merchant: null,
      date: null,
      total: null,
      lineItems: [],
      confidence: 0,
    };

    // Only run AI extraction on images, not PDFs
    if (req.file.mimetype !== "application/pdf") {
      try {
        aiData = await extractReceiptData(req.file.buffer, req.file.mimetype);
      } catch (aiErr) {
        // AI extraction failed but we still save the receipt
        console.error("AI extraction failed:", aiErr.message);
      }
    }

    // 3. Save receipt to database
    const result = await pool.query(
      `INSERT INTO receipts
        (business_id, uploaded_by, s3_key, original_filename,
         ai_merchant, ai_date, ai_total, ai_line_items, ai_confidence, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
       RETURNING *`,
      [
        businessId,
        userId,
        s3Key,
        req.file.originalname,
        aiData.merchant,
        aiData.date,
        aiData.total,
        JSON.stringify(aiData.lineItems),
        aiData.confidence,
      ],
    );

    const receipt = result.rows[0];

    // 4. Generate a signed URL so the frontend can display the image
    const signedUrl = await getReceiptSignedUrl(s3Key);

    return res.status(201).json({
      ...receipt,
      signed_url: signedUrl,
    });
  } catch (err) {
    console.error("Upload receipt error:", err);
    return res.status(500).json({ error: "Failed to upload receipt" });
  }
});

// ── GET /api/receipts ─────────────────────────────────────────
// Get all receipts for the business
router.get("/", async (req, res) => {
  const { businessId } = req.user;
  const { status } = req.query; // optional: pending | reviewed | linked

  try {
    let query = `
      SELECT
        r.*,
        u.name AS uploaded_by_name,
        t.id AS transaction_id,
        t.merchant AS transaction_merchant
      FROM receipts r
      LEFT JOIN users u ON u.id = r.uploaded_by
      LEFT JOIN transactions t ON t.receipt_id = r.id
      WHERE r.business_id = $1
    `;

    const params = [businessId];

    if (status) {
      query += ` AND r.status = $2`;
      params.push(status);
    }

    query += ` ORDER BY r.created_at DESC`;

    const result = await pool.query(query, params);

    return res.json(result.rows);
  } catch (err) {
    console.error("Get receipts error:", err);
    return res.status(500).json({ error: "Failed to fetch receipts" });
  }
});

// ── GET /api/receipts/:id ─────────────────────────────────────
// Get a single receipt with a fresh signed URL
router.get("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT r.*, u.name AS uploaded_by_name
       FROM receipts r
       LEFT JOIN users u ON u.id = r.uploaded_by
       WHERE r.id = $1 AND r.business_id = $2`,
      [id, businessId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Receipt not found" });
    }

    const receipt = result.rows[0];

    // Generate fresh signed URL
    const signedUrl = await getReceiptSignedUrl(receipt.s3_key);

    return res.json({
      ...receipt,
      signed_url: signedUrl,
    });
  } catch (err) {
    console.error("Get receipt error:", err);
    return res.status(500).json({ error: "Failed to fetch receipt" });
  }
});

// ── PUT /api/receipts/:id/review ──────────────────────────────
// Mark a receipt as reviewed and optionally correct AI data
router.put("/:id/review", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;
  const { merchant, date, total, lineItems } = req.body;

  try {
    const existing = await pool.query(
      "SELECT * FROM receipts WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Receipt not found" });
    }

    const result = await pool.query(
      `UPDATE receipts SET
    ai_merchant    = COALESCE($1, ai_merchant),
    ai_date        = COALESCE($2, ai_date),
    ai_total       = COALESCE($3, ai_total),
    ai_line_items  = COALESCE($4, ai_line_items),
    status         = 'reviewed'
   WHERE id = $5 AND business_id = $6
   RETURNING *`,
      [
        merchant || null,
        date || null,
        total || null,
        lineItems ? JSON.stringify(lineItems) : null,
        id,
        businessId,
      ],
    );

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Review receipt error:", err);
    return res.status(500).json({ error: "Failed to review receipt" });
  }
});

// ── PUT /api/receipts/:id/link ────────────────────────────────
// Link a receipt to an existing transaction
router.put("/:id/link", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;
  const { transactionId } = req.body;

  if (!transactionId) {
    return res.status(400).json({ error: "transactionId is required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Verify receipt belongs to this business
    const receiptCheck = await client.query(
      "SELECT * FROM receipts WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );
    if (receiptCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Receipt not found" });
    }

    // Verify transaction belongs to this business
    const txCheck = await client.query(
      "SELECT * FROM transactions WHERE id = $1 AND business_id = $2",
      [transactionId, businessId],
    );
    if (txCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Transaction not found" });
    }

    // Link receipt to transaction
    await client.query(
      "UPDATE transactions SET receipt_id = $1 WHERE id = $2",
      [id, transactionId],
    );

    // Mark receipt as linked
    await client.query("UPDATE receipts SET status = 'linked' WHERE id = $1", [
      id,
    ]);

    await client.query("COMMIT");

    return res.json({ message: "Receipt linked to transaction" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Link receipt error:", err);
    return res.status(500).json({ error: "Failed to link receipt" });
  } finally {
    client.release();
  }
});

// ── DELETE /api/receipts/:id ──────────────────────────────────
// Delete a receipt — removes from S3 and database
router.delete("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;

  try {
    const existing = await pool.query(
      "SELECT * FROM receipts WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Receipt not found" });
    }

    const receipt = existing.rows[0];

    // Check if receipt is linked to a transaction
    if (receipt.status === "linked") {
      return res.status(400).json({
        error:
          "Cannot delete a receipt that is linked to a transaction. Unlink it first.",
      });
    }

    // Delete from S3
    await deleteReceiptFromS3(receipt.s3_key);

    // Delete from database
    await pool.query(
      "DELETE FROM receipts WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );

    return res.json({ message: "Receipt deleted" });
  } catch (err) {
    console.error("Delete receipt error:", err);
    return res.status(500).json({ error: "Failed to delete receipt" });
  }
});

export default router;
