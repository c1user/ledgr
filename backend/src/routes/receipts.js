import express from "express";
import multer from "multer";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { uuidParam } from "../middleware/validateUuid.js";
import {
  uploadReceiptToS3,
  getReceiptSignedUrl,
  deleteReceiptFromS3,
} from "../services/s3.js";
import { extractReceiptData } from "../services/claude.js";
import { getPlan } from "../middleware/entitlements.js";
import { LIMITS } from "../config/entitlements.js";
import { uploadLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

// Multer config — store in memory, not disk
// Max file size: 10MB
// Allowed types: JPEG, PNG, PDF, WEBP
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      const err = new Error("Only JPEG, PNG, WEBP, and PDF files are allowed");
      // Tag the rejection so handleUpload can tell it apart from Multer's
      // own limit errors and from unexpected failures.
      err.code = "UNSUPPORTED_TYPE";
      cb(err);
    }
  },
});

// Wrap multer so its errors become clean 4xx responses instead of falling
// through to the global handler as a 500 "Something went wrong". Text
// fields (e.g. an optional `idempotencyKey`) land in req.body untouched.
const uploadSingle = upload.single("receipt");
function handleUpload(req, res, next) {
  uploadSingle(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          error: "File is larger than 10 MB",
          code: "FILE_TOO_LARGE",
          limitBytes: MAX_UPLOAD_BYTES,
        });
      }
      return res.status(400).json({ error: err.message, code: "UPLOAD_ERROR" });
    }

    if (err.code === "UNSUPPORTED_TYPE") {
      return res.status(415).json({
        error: err.message,
        code: "UNSUPPORTED_TYPE",
        allowed: ALLOWED_MIME_TYPES,
      });
    }

    return next(err);
  });
}

// All routes require authentication
router.use(requireAuth);
router.param("id", uuidParam("Receipt"));

// ── POST /api/receipts/upload ─────────────────────────────────
// Upload a receipt image, run AI extraction, save to DB.
// uploadLimiter runs BEFORE multer so rejected uploads (wrong type, too
// large) count against the per-user hourly budget too.
router.post("/upload", uploadLimiter, handleUpload, async (req, res) => {
  const { businessId, userId } = req.user;

  // `idempotencyKey` is an optional multipart text field. It is accepted
  // (multer puts it in req.body) but not acted on yet.

  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  try {
    // 0. Metered feature: Starter caps AI receipt scans per calendar month.
    //    Checked BEFORE the S3 upload and Claude call so no cost is incurred.
    const plan = await getPlan(businessId);
    const monthlyLimit = LIMITS[plan]?.aiReceiptsPerMonth ?? null;
    if (monthlyLimit !== null) {
      const used = await pool.query(
        `SELECT COUNT(*)::INT AS count
           FROM receipts
          WHERE business_id = $1
            AND created_at >= DATE_TRUNC('month', NOW())`,
        [businessId],
      );
      if (used.rows[0].count >= monthlyLimit) {
        return res.status(403).json({
          error: `Monthly receipt scan limit reached (${monthlyLimit}/month on the ${plan} plan)`,
          code: "UPGRADE_REQUIRED",
          feature: "ai_receipts",
          plan,
          requiredPlan: "professional",
          limit: monthlyLimit,
          used: used.rows[0].count,
        });
      }
    }

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
// Get all receipts for the business.
// Optional: ?status=pending|reviewed|linked, ?limit=N (1..100),
// ?offset=N (>= 0), ?include=url (adds signed_url per row). With no
// params every row is returned, exactly as before — except a receipt
// referenced by several transactions now appears once (the join keeps
// the most recent linked transaction per receipt).
const MAX_LIST_LIMIT = 100;
const INT_RE = /^\d+$/;

router.get("/", async (req, res) => {
  const { businessId } = req.user;
  const { status, limit, offset, include } = req.query;

  let limitN = null;
  if (limit !== undefined) {
    if (!INT_RE.test(String(limit)) || Number(limit) < 1) {
      return res.status(400).json({
        error: `limit must be an integer between 1 and ${MAX_LIST_LIMIT}`,
      });
    }
    limitN = Math.min(Number(limit), MAX_LIST_LIMIT);
  }

  let offsetN = null;
  if (offset !== undefined) {
    if (!INT_RE.test(String(offset))) {
      return res.status(400).json({
        error: "offset must be an integer greater than or equal to 0",
      });
    }
    offsetN = Number(offset);
  }

  const includes = String(include ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const withUrl = includes.includes("url");

  try {
    // One row per receipt. The tenant's linked transactions are reduced to
    // the newest per receipt in a single pass and hash-joined; a per-row
    // LATERAL lookup would rescan the tenant's transactions once per
    // receipt (transactions.receipt_id has no index, and the web app loads
    // this list unbounded on every Dashboard visit).
    let query = `
      SELECT
        r.*,
        u.name AS uploaded_by_name,
        t.id AS transaction_id,
        t.merchant AS transaction_merchant
      FROM receipts r
      LEFT JOIN users u ON u.id = r.uploaded_by
      LEFT JOIN (
        SELECT DISTINCT ON (t.receipt_id) t.receipt_id, t.id, t.merchant
          FROM transactions t
         WHERE t.business_id = $1 AND t.receipt_id IS NOT NULL
         ORDER BY t.receipt_id, t.created_at DESC
      ) t ON t.receipt_id = r.id
      WHERE r.business_id = $1
    `;

    const params = [businessId];

    if (status) {
      params.push(status);
      query += ` AND r.status = $${params.length}`;
    }

    query += ` ORDER BY r.created_at DESC`;

    if (limitN !== null) {
      params.push(limitN);
      query += ` LIMIT $${params.length}`;
    }
    if (offsetN !== null) {
      params.push(offsetN);
      query += ` OFFSET $${params.length}`;
    }

    const result = await pool.query(query, params);

    if (!withUrl) {
      return res.json(result.rows);
    }

    const rows = await Promise.all(
      result.rows.map(async (row) => ({
        ...row,
        signed_url: await getReceiptSignedUrl(row.s3_key),
      })),
    );
    return res.json(rows);
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
    // Same linked-transaction columns as the list (newest reference wins),
    // so a detail view can show "Linked to …" without scanning transactions.
    const result = await pool.query(
      `SELECT r.*, u.name AS uploaded_by_name,
              t.id AS transaction_id, t.merchant AS transaction_merchant
       FROM receipts r
       LEFT JOIN users u ON u.id = r.uploaded_by
       LEFT JOIN LATERAL (
         SELECT t.id, t.merchant
           FROM transactions t
          WHERE t.receipt_id = r.id AND t.business_id = r.business_id
          ORDER BY t.created_at DESC
          LIMIT 1
       ) t ON TRUE
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
// Mark a receipt as reviewed and optionally correct AI data.
// A receipt that is already linked to a transaction stays linked —
// reviewing it must never demote it back to "reviewed".
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
    status         = CASE WHEN status = 'linked' THEN 'linked' ELSE 'reviewed' END
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
// Link a receipt to an existing transaction. Idempotent: re-linking to
// the same transaction is a no-op 200; linking an already-linked receipt
// to a different transaction is refused with 409 RECEIPT_LINKED — as long
// as a transaction of this business still references it. A receipt left
// 'linked' with nothing pointing at it (rows from before DELETE
// /transactions/:id released receipts) is simply linked again. When the
// target transaction already carried a different receipt, that receipt is
// released (status back to 'reviewed') so it does not stay 'linked' with
// nothing referencing it.
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

    // Verify receipt belongs to this business — locked so two concurrent
    // link calls on the same receipt serialize on the status check below.
    const receiptCheck = await client.query(
      "SELECT * FROM receipts WHERE id = $1 AND business_id = $2 FOR UPDATE",
      [id, businessId],
    );
    if (receiptCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Receipt not found" });
    }
    const receipt = receiptCheck.rows[0];

    // Verify transaction belongs to this business
    const txCheck = await client.query(
      "SELECT * FROM transactions WHERE id = $1 AND business_id = $2 FOR UPDATE",
      [transactionId, businessId],
    );
    if (txCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Transaction not found" });
    }
    const transaction = txCheck.rows[0];

    if (receipt.status === "linked") {
      if (transaction.receipt_id === id) {
        // Already linked to exactly this transaction — nothing to do.
        await client.query("COMMIT");
        return res.json({ message: "Receipt linked to transaction" });
      }
      // Refuse only while another transaction of this business references
      // the receipt; a dangling 'linked' row falls through and is re-linked
      // cleanly. Own statement, after the lock — see POST /api/transactions
      // for why this is not a sub-select of the locking SELECT.
      const ref = await client.query(
        `SELECT EXISTS (
           SELECT 1 FROM transactions
            WHERE receipt_id = $1 AND business_id = $2
         ) AS referenced`,
        [id, businessId],
      );
      if (ref.rows[0].referenced) {
        await client.query("ROLLBACK");
        return res
          .status(409)
          .json({ error: "Receipt already linked", code: "RECEIPT_LINKED" });
      }
    }

    // Link receipt to transaction
    await client.query(
      "UPDATE transactions SET receipt_id = $1 WHERE id = $2 AND business_id = $3",
      [id, transactionId, businessId],
    );

    // Mark receipt as linked
    await client.query(
      "UPDATE receipts SET status = 'linked' WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );

    // The transaction may already have carried another receipt (the web
    // app's picker lists every transaction). That receipt just lost its
    // reference, so release it — left 'linked' it could never be re-linked,
    // booked or deleted again. Skipped while a legacy row still points at it.
    const replaced = transaction.receipt_id;
    if (replaced && replaced !== id) {
      await client.query(
        `UPDATE receipts SET status = 'reviewed'
          WHERE id = $1 AND business_id = $2 AND status = 'linked'
            AND NOT EXISTS (
              SELECT 1 FROM transactions
               WHERE receipt_id = $1 AND business_id = $2
            )`,
        [replaced, businessId],
      );
    }

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

    // A receipt that a transaction of this business still references cannot
    // be deleted. 'linked' alone is not proof: rows written before DELETE
    // /transactions/:id released receipts can carry the status with nothing
    // pointing at them — those are deletable like any reviewed receipt.
    if (receipt.status === "linked") {
      const ref = await pool.query(
        `SELECT EXISTS (
           SELECT 1 FROM transactions
            WHERE receipt_id = $1 AND business_id = $2
         ) AS referenced`,
        [id, businessId],
      );
      if (ref.rows[0].referenced) {
        return res.status(400).json({
          error:
            "Cannot delete a receipt that is linked to a transaction. Unlink it first.",
        });
      }
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
