// Transaction "categories" are chart_of_accounts revenue/expense accounts —
// that's what a transaction's journal line posts against. These helpers flatten
// the grouped /chart-of-accounts response into the {id, name, type, color,
// parent_id, parent_name, is_system} shape the category-driven pages render.
// revenue → "income", expense → "expense". System accounts carry a name_key
// (resolve via i18n); custom ones a plain name.
export function coaToCategories(groups, t) {
  if (!groups) return [];
  const out = [];
  const walk = (acc, type, parentName) => {
    const name = acc.name_key ? t(acc.name_key) : acc.name;
    out.push({
      id: acc.id,
      name,
      type,
      color: acc.color,
      parent_id: acc.parent_id || null,
      parent_name: parentName || null,
      is_system: acc.is_system,
    });
    acc.children?.forEach((c) => walk(c, type, name));
  };
  for (const g of groups) {
    if (g.account_type === "revenue")
      g.accounts.forEach((a) => walk(a, "income"));
    else if (g.account_type === "expense")
      g.accounts.forEach((a) => walk(a, "expense"));
  }
  return out;
}

// Resolve a category display name from a backend *_name_key / *_name pair.
// System COA accounts store an i18n name_key; custom ones a plain name.
export function resolveCatName(nameKey, name, t) {
  return nameKey ? t(nameKey) : name || "";
}
