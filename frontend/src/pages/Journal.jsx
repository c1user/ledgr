import { useState, useMemo } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import { toast, confirmDialog } from "../store/feedbackStore";
import cx from "../lib/cx";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
} from "../components/ui";

const PAGE_SIZE = 25;

const makeFmt = (lang) => (val) =>
  new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
    style: "currency",
    currency: "USD",
  }).format(val || 0);

// Source-type badge tones: manual + reversal stand out, the rest are muted.
const SOURCE_TONE = {
  manual: "payroll",
  reversal: "danger",
};

const coaLabel = (acc, t) => {
  const name = acc.account_name_key ? t(acc.account_name_key) : acc.account_name;
  return acc.account_code ? `${acc.account_code} · ${name}` : name;
};

const emptyLine = () => ({ accountId: "", debit: "", credit: "", memo: "" });

// account_type -> existing i18n label key (same map as ChartOfAccounts.jsx).
const TYPE_LABEL = {
  asset: "coa.assets",
  liability: "coa.liabilities",
  equity: "coa.equity",
  revenue: "coa.revenue",
  expense: "coa.expenses",
};

// Libro diario — the raw journal, plus manual/adjusting entries (owner/admin).
// Manual entries cover what guided flows can't: depreciation, corrections,
// owner draws/contributions. Balanced lines only; posting goes through the
// same server-side chokepoint as every other money movement.
export default function Journal() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const lang = i18n.language?.startsWith("es") ? "es" : "en";
  const fmt = makeFmt(lang);
  const role = useAuthStore((s) => s.user)?.role;
  const canPost = role === "owner" || role === "admin";

  const [showNew, setShowNew] = useState(false);

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ["ledger-journal"],
      queryFn: ({ pageParam = 0 }) =>
        api
          .get(`/ledger/journal?limit=${PAGE_SIZE}&offset=${pageParam}`)
          .then((r) => r.data),
      initialPageParam: 0,
      getNextPageParam: (lastPage, pages) =>
        lastPage.entries.length === PAGE_SIZE
          ? pages.length * PAGE_SIZE
          : undefined,
    });
  const entries = useMemo(
    () => (data ? data.pages.flatMap((p) => p.entries) : []),
    [data],
  );
  const reversedIds = useMemo(
    () =>
      new Set(entries.map((e) => e.reverses_entry_id).filter(Boolean)),
    [entries],
  );

  const reverse = useMutation({
    mutationFn: (id) =>
      api.post(`/ledger/journal/${id}/reverse`, {}).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ledger-journal"] });
      toast.success(t("journal.reversed"));
    },
    onError: (err) =>
      toast.error(err.response?.data?.error || t("journal.reverseFailed")),
  });

  const handleReverse = async (entry) => {
    const ok = await confirmDialog({
      title: t("journal.reverseTitle"),
      message: t("journal.reverseWarning"),
      confirmLabel: t("journal.reverseConfirm"),
      danger: true,
    });
    if (ok) reverse.mutate(entry.id);
  };

  return (
    <div className="fade-in">
      <PageHeader
        title={t("journal.title")}
        subtitle={t("journal.subtitle")}
        actions={
          canPost && (
            <Button
              variant="primary"
              icon="ti-plus"
              onClick={() => setShowNew(true)}
            >
              {t("journal.newEntry")}
            </Button>
          )
        }
      />

      {isLoading ? (
        <div className="p-10 text-center text-muted">{t("common.loading")}</div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon="ti-notebook"
          title={t("journal.emptyTitle")}
          message={t("journal.emptyHint")}
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {entries.map((e) => {
            const totalDebit = e.lines.reduce(
              (s, l) => s + Number(l.debit || 0),
              0,
            );
            const isReversed = reversedIds.has(e.id);
            return (
              <Card key={e.id} padding="none" className="p-4">
                <div className="flex items-center gap-2.5 flex-wrap mb-2">
                  <span className="text-md font-semibold text-ink">
                    {dayjs(e.entry_date).format("YYYY-MM-DD")}
                  </span>
                  <Badge tone={SOURCE_TONE[e.source_type] || "neutral"}>
                    {t(`journal.source_${e.source_type}`, {
                      defaultValue: e.source_type,
                    })}
                  </Badge>
                  {isReversed && (
                    <Badge tone="danger">{t("journal.reversedBadge")}</Badge>
                  )}
                  <span className="text-md text-secondary flex-1 min-w-[120px]">
                    {e.description || ""}
                  </span>
                  <span className="text-md font-bold text-ink">
                    {fmt(totalDebit)}
                  </span>
                  {canPost && e.source_type === "manual" && !isReversed && (
                    <Button
                      size="sm"
                      icon="ti-arrow-back-up"
                      onClick={() => handleReverse(e)}
                    >
                      {t("journal.reverse")}
                    </Button>
                  )}
                </div>
                <div className="border-t border-line pt-2 flex flex-col gap-1">
                  {e.lines.map((l) => (
                    <div
                      key={l.id}
                      className="grid grid-cols-[1fr_110px_110px] gap-x-4 text-md"
                    >
                      <span
                        className={cx(
                          "text-secondary truncate",
                          Number(l.credit) > 0 && "pl-5",
                        )}
                        title={l.memo || undefined}
                      >
                        {coaLabel(l, t)}
                        {l.memo ? (
                          <span className="text-muted text-xs"> — {l.memo}</span>
                        ) : null}
                      </span>
                      <span className="text-right text-ink">
                        {Number(l.debit) > 0 ? fmt(l.debit) : ""}
                      </span>
                      <span className="text-right text-ink">
                        {Number(l.credit) > 0 ? fmt(l.credit) : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
          {hasNextPage && (
            <Button
              className="self-center"
              loading={isFetchingNextPage}
              onClick={() => fetchNextPage()}
            >
              {t("common.loadMore")}
            </Button>
          )}
        </div>
      )}

      {showNew && (
        <NewEntryModal
          t={t}
          fmt={fmt}
          onClose={() => setShowNew(false)}
          onSaved={() => {
            setShowNew(false);
            qc.invalidateQueries({ queryKey: ["ledger-journal"] });
            toast.success(t("journal.posted"));
          }}
        />
      )}
    </div>
  );
}

function NewEntryModal({ t, fmt, onClose, onSaved }) {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    description: "",
  });
  const [lines, setLines] = useState([emptyLine(), emptyLine()]);
  const [error, setError] = useState("");

  const { data: coaGroups } = useQuery({
    queryKey: ["chart-of-accounts"],
    queryFn: () => api.get("/chart-of-accounts").then((r) => r.data),
  });
  const groups = useMemo(() => {
    if (!coaGroups) return [];
    return coaGroups.map((g) => {
      const out = [];
      const walk = (acc) => {
        out.push({
          id: acc.id,
          name: acc.name_key ? t(acc.name_key) : acc.name,
          code: acc.code,
        });
        acc.children?.forEach(walk);
      };
      g.accounts.forEach(walk);
      return { type: g.account_type, accounts: out };
    });
  }, [coaGroups, t]);

  const totalDebit = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCredit = lines.reduce(
    (s, l) => s + (parseFloat(l.credit) || 0),
    0,
  );
  const balanced =
    totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.005;

  const updateLine = (i, key, val) =>
    setLines((arr) =>
      arr.map((l, idx) => {
        if (idx !== i) return l;
        const next = { ...l, [key]: val };
        // One side per line: typing on one side clears the other.
        if (key === "debit" && val !== "") next.credit = "";
        if (key === "credit" && val !== "") next.debit = "";
        return next;
      }),
    );

  const save = useMutation({
    mutationFn: () =>
      api
        .post("/ledger/journal", {
          date: form.date,
          description: form.description,
          lines: lines
            .filter((l) => l.accountId)
            .map((l) => ({
              accountId: l.accountId,
              debit: l.debit === "" ? 0 : parseFloat(l.debit),
              credit: l.credit === "" ? 0 : parseFloat(l.credit),
              memo: l.memo || null,
            })),
        })
        .then((r) => r.data),
    onSuccess: onSaved,
    onError: (err) =>
      setError(err.response?.data?.error || t("journal.postFailed")),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");
    const filled = lines.filter((l) => l.accountId);
    if (filled.length < 2) return setError(t("journal.errTwoLines"));
    for (const l of filled) {
      const d = parseFloat(l.debit) || 0;
      const c = parseFloat(l.credit) || 0;
      if (!(d > 0) && !(c > 0)) return setError(t("journal.errLineAmount"));
    }
    if (!balanced) return setError(t("journal.errUnbalanced"));
    save.mutate();
  };

  return (
    <Modal open size="lg" title={t("journal.newEntry")} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <p className="text-xs text-muted">{t("journal.newHint")}</p>
        <div className="grid grid-cols-[140px_1fr] gap-3">
          <Field label={t("journal.date")} className="mb-0">
            <Input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </Field>
          <Field label={t("journal.description")} className="mb-0">
            <Input
              type="text"
              placeholder={t("journal.descriptionPlaceholder")}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </Field>
        </div>

        <div>
          <div className="grid grid-cols-[1fr_110px_110px_1fr_26px] gap-2 text-xs text-muted font-semibold tracking-[0.5px] uppercase pb-1.5">
            <span>{t("journal.colAccount")}</span>
            <span className="text-right">{t("journal.colDebit")}</span>
            <span className="text-right">{t("journal.colCredit")}</span>
            <span>{t("journal.colMemo")}</span>
            <span />
          </div>
          <div className="flex flex-col gap-2">
            {lines.map((l, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_110px_110px_1fr_26px] gap-2 items-center"
              >
                <Select
                  value={l.accountId}
                  onChange={(e) => updateLine(i, "accountId", e.target.value)}
                >
                  <option value="">{t("journal.selectAccount")}</option>
                  {groups.map((g) => (
                    <optgroup
                      key={g.type}
                      label={t(TYPE_LABEL[g.type] || g.type)}
                    >
                      {g.accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code ? `${a.code} · ${a.name}` : a.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  className="text-right"
                  value={l.debit}
                  onChange={(e) => updateLine(i, "debit", e.target.value)}
                />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  className="text-right"
                  value={l.credit}
                  onChange={(e) => updateLine(i, "credit", e.target.value)}
                />
                <Input
                  type="text"
                  value={l.memo}
                  onChange={(e) => updateLine(i, "memo", e.target.value)}
                />
                <button
                  type="button"
                  onClick={() =>
                    setLines((arr) =>
                      arr.length > 2 ? arr.filter((_, idx) => idx !== i) : arr,
                    )
                  }
                  className="flex items-center justify-center w-[26px] h-[26px] rounded-md text-muted hover:text-danger hover:bg-danger-bg cursor-pointer"
                  title={t("common.delete")}
                >
                  <i className="ti ti-x text-xs" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
          <Button
            size="sm"
            icon="ti-plus"
            className="mt-2"
            onClick={() => setLines((arr) => [...arr, emptyLine()])}
          >
            {t("journal.addLine")}
          </Button>
        </div>

        <div className="bg-canvas rounded-lg px-3.5 py-3 flex items-center justify-between text-md">
          <span
            className={cx(
              "font-semibold",
              balanced ? "text-income" : "text-expense",
            )}
          >
            <i
              className={cx(
                "ti mr-1.5",
                balanced ? "ti-scale" : "ti-alert-triangle",
              )}
              aria-hidden="true"
            />
            {balanced ? t("journal.balanced") : t("journal.unbalanced")}
          </span>
          <span className="text-ink">
            {t("journal.colDebit")} {fmt(totalDebit)} ·{" "}
            {t("journal.colCredit")} {fmt(totalCredit)}
          </span>
        </div>

        {error && <div className="text-md text-expense">{error}</div>}

        <div className="flex gap-2.5 justify-end mt-1">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            type="submit"
            variant="primary"
            disabled={save.isPending || !balanced}
          >
            {save.isPending ? t("journal.posting") : t("journal.post")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
