/**
 * Runs active categorization rules for a business against a transaction's
 * merchant and notes fields. Returns the first matching rule's category_id
 * and rule_id, or null if no rule matches.
 *
 * Must receive `client` (a pool connection inside an active DB transaction)
 * so the rule lookup participates in the same transaction as the INSERT.
 */
export async function applyRules(client, { merchant, notes }, businessId, transactionType) {
  const { rows: rules } = await client.query(
    `SELECT r.id, r.match_type, r.pattern, r.category_id,
            CASE WHEN c.account_type = 'revenue' THEN 'income' ELSE 'expense' END AS category_type
     FROM categorization_rules r
     JOIN chart_of_accounts c ON c.id = r.category_id
     WHERE r.business_id = $1
       AND r.is_active = TRUE
     ORDER BY r.priority ASC, r.created_at ASC`,
    [businessId],
  );

  const matchText = [merchant, notes].filter(Boolean).join(" ").toLowerCase();

  for (const rule of rules) {
    // Skip rules whose assigned category type doesn't match the transaction type
    if (rule.category_type !== transactionType) continue;

    let matched = false;
    const pattern = rule.pattern;

    if (rule.match_type === "contains") {
      matched = matchText.includes(pattern.toLowerCase());
    } else if (rule.match_type === "equals") {
      matched = merchant?.toLowerCase() === pattern.toLowerCase();
    } else if (rule.match_type === "regex") {
      try {
        matched = new RegExp(pattern, "i").test(matchText);
      } catch {
        // Invalid regex — skip silently rather than crashing the transaction
      }
    }

    if (matched) {
      return { category_id: rule.category_id, rule_id: rule.id };
    }
  }

  return null;
}
