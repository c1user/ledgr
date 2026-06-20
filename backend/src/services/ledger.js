/**
 * services/ledger.js
 *
 * Item 2 (Double-entry) — the posting service.
 *
 * This is the SINGLE chokepoint through which every money movement
 * becomes ledger entries. Transactions, payroll, invoices, inventory
 * COGS — all of them call postJournalEntry(). Nothing writes
 * journal_entry_lines directly.
 *
 * The balance invariant (debits == credits) is enforced in THREE places,
 * deliberately redundant because a wrong ledger is worse than a crash:
 *   1. Here, in JS, before any DB write (fast, clear error).
 *   2. The CHECK constraints on journal_entry_lines (one side per line).
 *   3. The deferred constraint trigger at COMMIT (catches anything that
 *      bypasses this service).
 */

const EPSILON = 0.005; // half a cent — tolerance for float arithmetic

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Post a balanced journal entry.
 *
 * @param {import('pg').PoolClient} client - active client inside a transaction
 * @param {Object} entry
 * @param {string}  entry.businessId
 * @param {string}  entry.date            - YYYY-MM-DD
 * @param {string}  entry.description
 * @param {string} [entry.sourceType='manual']
 * @param {string} [entry.sourceId=null]
 * @param {string} [entry.createdBy=null]
 * @param {Array<{accountId: string, debit?: number, credit?: number, memo?: string}>} entry.lines
 * @returns {Promise<{id: string, lines: Array}>}
 */
export async function postJournalEntry(client, entry) {
  const {
    businessId,
    date,
    description = null,
    sourceType = "manual",
    sourceId = null,
    createdBy = null,
    lines = [],
  } = entry;

  if (!businessId) throw new Error("postJournalEntry: businessId is required");
  if (!date) throw new Error("postJournalEntry: date is required");

  // ── Validate line shape (no DB needed — fail fast and clearly) ──
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new Error("postJournalEntry: an entry needs at least two lines");
  }

  let totalDebit = 0;
  let totalCredit = 0;
  const normalized = [];

  lines.forEach((line, i) => {
    const debit = round2(line.debit || 0);
    const credit = round2(line.credit || 0);

    if (!line.accountId) {
      throw new Error(`postJournalEntry: line ${i} is missing accountId`);
    }
    if (debit < 0 || credit < 0) {
      throw new Error(`postJournalEntry: line ${i} has a negative amount`);
    }
    if (debit > 0 && credit > 0) {
      throw new Error(
        `postJournalEntry: line ${i} has both a debit and a credit`,
      );
    }
    if (debit === 0 && credit === 0) {
      throw new Error(
        `postJournalEntry: line ${i} has neither a debit nor a credit`,
      );
    }

    totalDebit += debit;
    totalCredit += credit;
    normalized.push({
      accountId: line.accountId,
      debit,
      credit,
      memo: line.memo || null,
    });
  });

  totalDebit = round2(totalDebit);
  totalCredit = round2(totalCredit);

  if (Math.abs(totalDebit - totalCredit) > EPSILON) {
    throw new Error(
      `postJournalEntry: entry is unbalanced — debits=${totalDebit}, credits=${totalCredit}`,
    );
  }

  // ── Validate every account belongs to this business ──
  const accountIds = [...new Set(normalized.map((l) => l.accountId))];
  const acctCheck = await client.query(
    `SELECT id FROM chart_of_accounts
     WHERE id = ANY($1::uuid[]) AND business_id = $2 AND is_active = TRUE`,
    [accountIds, businessId],
  );
  if (acctCheck.rows.length !== accountIds.length) {
    throw new Error(
      "postJournalEntry: one or more accounts do not belong to this business (or are inactive)",
    );
  }

  // ── Insert header ──
  const headerResult = await client.query(
    `INSERT INTO journal_entries
       (business_id, entry_date, description, source_type, source_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [businessId, date, description, sourceType, sourceId, createdBy],
  );
  const entryId = headerResult.rows[0].id;

  // ── Insert lines ──
  const insertedLines = [];
  for (let i = 0; i < normalized.length; i++) {
    const l = normalized[i];
    const lineResult = await client.query(
      `INSERT INTO journal_entry_lines
         (journal_entry_id, account_id, debit, credit, memo, line_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, account_id, debit, credit, memo, line_order`,
      [entryId, l.accountId, l.debit, l.credit, l.memo, i],
    );
    insertedLines.push(lineResult.rows[0]);
  }

  // The deferred trigger will re-verify balance at COMMIT.
  return { id: entryId, lines: insertedLines };
}

/**
 * Delete the journal entry(ies) produced by a given source row.
 * Used when a source document (e.g. a transaction) is deleted or edited.
 * Lines cascade-delete; balances re-derive automatically.
 *
 * For an immutable audit trail you'd post a REVERSING entry instead of
 * deleting (see reverseJournalEntry). At this stage, with erasable data,
 * deleting keeps the ledger clean. Switch to reversal before you need
 * audit history.
 *
 * @param {import('pg').PoolClient} client
 * @param {string} businessId
 * @param {string} sourceType
 * @param {string} sourceId
 * @returns {Promise<number>} number of entries deleted
 */
export async function deleteEntriesForSource(
  client,
  businessId,
  sourceType,
  sourceId,
) {
  const result = await client.query(
    `DELETE FROM journal_entries
     WHERE business_id = $1 AND source_type = $2 AND source_id = $3
     RETURNING id`,
    [businessId, sourceType, sourceId],
  );
  return result.rowCount;
}

/**
 * Post a reversing entry for an existing entry (debits/credits swapped).
 * Preserves history. Returns the new reversing entry.
 *
 * @param {import('pg').PoolClient} client
 * @param {string} businessId
 * @param {string} entryId
 * @param {Object} [opts]
 * @param {string} [opts.date]      - defaults to the original entry's date
 * @param {string} [opts.createdBy]
 */
export async function reverseJournalEntry(
  client,
  businessId,
  entryId,
  opts = {},
) {
  const orig = await client.query(
    `SELECT id, entry_date, description FROM journal_entries
     WHERE id = $1 AND business_id = $2`,
    [entryId, businessId],
  );
  if (orig.rows.length === 0) {
    throw new Error("reverseJournalEntry: entry not found for this business");
  }
  const origEntry = orig.rows[0];

  const origLines = await client.query(
    `SELECT account_id, debit, credit, memo FROM journal_entry_lines
     WHERE journal_entry_id = $1 ORDER BY line_order`,
    [entryId],
  );

  const header = await client.query(
    `INSERT INTO journal_entries
       (business_id, entry_date, description, source_type, source_id, reverses_entry_id, created_by)
     VALUES ($1, $2, $3, 'reversal', $4, $4, $5)
     RETURNING id`,
    [
      businessId,
      opts.date || origEntry.entry_date,
      `Reversal of: ${origEntry.description || entryId}`,
      entryId,
      opts.createdBy || null,
    ],
  );
  const newId = header.rows[0].id;

  for (let i = 0; i < origLines.rows.length; i++) {
    const l = origLines.rows[i];
    // swap debit <-> credit
    await client.query(
      `INSERT INTO journal_entry_lines
         (journal_entry_id, account_id, debit, credit, memo, line_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [newId, l.account_id, l.credit, l.debit, l.memo, i],
    );
  }

  return { id: newId };
}

export { round2 };
