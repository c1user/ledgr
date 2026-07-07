import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs } from "../components/ui";
import ChartOfAccounts from "./ChartOfAccounts";
import Categories from "./Categories";

// Combined "Accounting" home. The chart of accounts and the income/expense
// categories are two views of the same underlying COA data, so they live
// behind a single nav item with tabs instead of two separate pages.
const TABS = [
  { id: "coa", labelKey: "coa.title" },
  { id: "categories", labelKey: "categories.title" },
];

export default function Accounting() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("coa");

  return (
    <div className="fade-in">
      <Tabs
        className="mb-5"
        tabs={TABS.map(({ id, labelKey }) => ({ id, label: t(labelKey) }))}
        active={tab}
        onChange={setTab}
      />
      {tab === "coa" ? <ChartOfAccounts /> : <Categories />}
    </div>
  );
}
