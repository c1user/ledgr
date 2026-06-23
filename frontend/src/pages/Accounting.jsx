import { useState } from "react";
import { useTranslation } from "react-i18next";
import ChartOfAccounts from "./ChartOfAccounts";
import Categories from "./Categories";

// Combined "Accounting" home. The chart of accounts and the income/expense
// categories are two views of the same underlying COA data, so they live
// behind a single nav item with tabs instead of two separate pages.
const TABS = [
  { key: "coa", labelKey: "coa.title" },
  { key: "categories", labelKey: "categories.title" },
];

export default function Accounting() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("coa");

  return (
    <div className="fade-in">
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 20,
          borderBottom: "0.5px solid var(--border-color)",
        }}
      >
        {TABS.map(({ key, labelKey }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: "8px 20px",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              color: tab === key ? "var(--brand)" : "var(--text-muted)",
              borderBottom:
                tab === key
                  ? "2px solid var(--brand)"
                  : "2px solid transparent",
              fontWeight: tab === key ? 500 : 400,
            }}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      {tab === "coa" ? <ChartOfAccounts /> : <Categories />}
    </div>
  );
}
