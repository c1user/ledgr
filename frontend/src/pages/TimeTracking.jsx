import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import api from "../lib/api";
import cx from "../lib/cx";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Textarea,
} from "../components/ui";

// ── Date helpers ─────────────────────────────────────────────
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getMonday(dateStr) {
  const [y, m, day] = dateStr.split("-").map(Number);
  const d = new Date(y, m - 1, day);
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(dateStr, n) {
  const [y, m, day] = dateStr.split("-").map(Number);
  const d = new Date(y, m - 1, day + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDate(dateStr, locale) {
  const [y, m, day] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(locale, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function fmtWeekRange(weekStart, locale) {
  const [y, m, day] = weekStart.split("-").map(Number);
  const s = new Date(y, m - 1, day);
  const e = new Date(y, m - 1, day + 6);
  const opts = { month: "short", day: "numeric" };
  return `${s.toLocaleDateString(locale, opts)} – ${e.toLocaleDateString(locale, { ...opts, year: "numeric" })}`;
}

function fmtHours(h) {
  const n = parseFloat(h || 0);
  if (n === 0) return "0";
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace(/0$/, "");
}

function formatElapsed(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function roundTo15min(seconds) {
  return Math.max(0.25, Math.round(seconds / 900) * 0.25);
}

const DAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ── EntryModal ───────────────────────────────────────────────
function EntryModal({ entry, projects, prefill, onClose, onSave, saving }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(() => ({
    projectId: entry?.project_id ?? prefill?.projectId ?? "",
    date: entry?.date ?? prefill?.date ?? todayStr(),
    hours: entry?.hours
      ? String(parseFloat(entry.hours))
      : (prefill?.hours ?? ""),
    description: entry?.description ?? "",
    isBillable: entry?.is_billable ?? true,
    hourlyRate: entry?.hourly_rate ? String(entry.hourly_rate) : "",
  }));
  const [err, setErr] = useState("");

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    setErr("");
    if (!form.date) return setErr(t("time.errDateRequired"));
    const h = parseFloat(form.hours);
    if (!h || h <= 0) return setErr(t("time.errHoursRequired"));
    onSave({
      ...(entry ? { id: entry.id } : {}),
      projectId: form.projectId || null,
      date: form.date,
      hours: h,
      description: form.description || null,
      isBillable: form.isBillable,
      hourlyRate:
        form.isBillable && form.hourlyRate ? parseFloat(form.hourlyRate) : null,
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={entry ? t("time.editEntry") : t("time.newEntry")}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        {/* Project */}
        <Field label={t("time.project")} className="mb-0">
          <Select
            value={form.projectId}
            onChange={(e) => set("projectId", e.target.value)}
          >
            <option value="">{t("time.noProject")}</option>
            {projects
              .filter((p) => p.is_active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        </Field>

        {/* Date + Hours (row) */}
        <div className="grid grid-cols-2 gap-2.5">
          <Field label={t("time.date")} className="mb-0">
            <Input
              type="date"
              required
              value={form.date}
              onChange={(e) => set("date", e.target.value)}
            />
          </Field>
          <Field label={t("time.hours")} className="mb-0">
            <Input
              type="number"
              required
              min="0.25"
              step="0.25"
              placeholder="0.00"
              value={form.hours}
              onChange={(e) => set("hours", e.target.value)}
            />
          </Field>
        </div>

        {/* Description */}
        <Field label={t("time.description")} className="mb-0">
          <Textarea
            rows={2}
            className="min-h-[60px]"
            placeholder="What did you work on?"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </Field>

        {/* Billable toggle + rate */}
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-1.5 cursor-pointer text-md">
            <input
              type="checkbox"
              checked={form.isBillable}
              onChange={(e) => set("isBillable", e.target.checked)}
            />
            {t("time.billable")}
          </label>
          {form.isBillable && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted">{t("time.hourlyRate")}</span>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.hourlyRate}
                onChange={(e) => set("hourlyRate", e.target.value)}
                className="w-[90px]"
              />
            </div>
          )}
        </div>

        {err && <p className="text-danger text-xs">{err}</p>}

        <div className="flex gap-2 justify-end mt-1">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving
              ? t("time.saving")
              : entry
                ? t("time.saveChanges")
                : t("time.createEntry")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Main page ────────────────────────────────────────────────
export default function TimeTracking() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const locale = i18n.language === "es" ? "es-PR" : "en-US";

  // Tab
  const [tab, setTab] = useState("timesheet");

  // Week
  const [weekStart, setWeekStart] = useState(() => getMonday(todayStr()));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = todayStr();

  // Timer
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerStart, setTimerStart] = useState(null);
  const [timerProjectId, setTimerProjectId] = useState("");
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (!timerRunning) return;
    const id = setInterval(() => forceRender((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [timerRunning]);

  const timerElapsed = timerRunning && timerStart
    ? Math.floor((Date.now() - timerStart) / 1000)
    : 0;

  // Modals
  const [entryModal, setEntryModal] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [entryPrefill, setEntryPrefill] = useState(null);

  // Data
  const { data: entries = [], isLoading: loadingEntries } = useQuery({
    queryKey: ["time-entries", weekStart],
    queryFn: () => api.get(`/time-entries?week=${weekStart}`).then((r) => r.data),
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get("/projects").then((r) => r.data),
  });

  // Mutations — entries
  const createEntry = useMutation({
    mutationFn: (body) => api.post("/time-entries", body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["time-entries"] });
      setEntryModal(false);
      setEditEntry(null);
    },
  });

  const updateEntry = useMutation({
    mutationFn: ({ id, ...body }) =>
      api.put(`/time-entries/${id}`, body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["time-entries"] });
      setEntryModal(false);
      setEditEntry(null);
    },
  });

  const deleteEntry = useMutation({
    mutationFn: (id) => api.delete(`/time-entries/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["time-entries"] }),
  });

  // Timer actions
  function startTimer() {
    setTimerStart(Date.now());
    setTimerRunning(true);
  }

  function stopTimer() {
    const rounded = roundTo15min(timerElapsed);
    setTimerRunning(false);
    setTimerStart(null);
    setEditEntry(null);
    setEntryPrefill({
      hours: String(rounded),
      projectId: timerProjectId,
      date: todayStr(),
    });
    setEntryModal(true);
  }

  // Entry actions
  function openNewEntry() {
    setEditEntry(null);
    setEntryPrefill(null);
    setEntryModal(true);
  }

  function openEditEntry(e) {
    setEditEntry(e);
    setEntryPrefill(null);
    setEntryModal(true);
  }

  function handleEntrySave(payload) {
    if (payload.id) updateEntry.mutate(payload);
    else createEntry.mutate(payload);
  }

  // CSV export
  function exportCsv() {
    const header = [
      "Date",
      "Project",
      "Description",
      "Hours",
      "Billable",
      "Rate",
      "Amount",
    ].join(",");
    const rows = entries.map((e) => {
      const rate = e.hourly_rate ? parseFloat(e.hourly_rate) : "";
      const amount =
        e.is_billable && rate ? (parseFloat(e.hours) * rate).toFixed(2) : "";
      return [
        e.date,
        `"${(e.project_name || "").replace(/"/g, '""')}"`,
        `"${(e.description || "").replace(/"/g, '""')}"`,
        e.hours,
        e.is_billable ? "Yes" : "No",
        rate,
        amount,
      ].join(",");
    });
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `timesheet-${weekStart}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Computed values
  const hoursByDay = {};
  let weekTotal = 0;
  for (const e of entries) {
    const h = parseFloat(e.hours || 0);
    hoursByDay[e.date] = (hoursByDay[e.date] || 0) + h;
    weekTotal += h;
  }

  const entriesByDate = {};
  for (const e of entries) {
    if (!entriesByDate[e.date]) entriesByDate[e.date] = [];
    entriesByDate[e.date].push(e);
  }

  const entrySaving = createEntry.isPending || updateEntry.isPending;

  return (
    <div>
      <PageHeader title={t("time.title")} />

      <Card>
        {/* Tabs */}
        <div className="flex gap-1 mb-5 bg-canvas rounded-lg p-1 w-fit">
          {[
            { id: "timesheet", icon: "ti-calendar-week", label: t("time.timesheet") },
            { id: "projects", icon: "ti-folder", label: t("time.projects") },
          ].map((tb) => (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={cx(
                "px-4 py-1.5 rounded-md text-md cursor-pointer transition-all",
                tab === tb.id
                  ? "bg-brand text-white font-semibold"
                  : "bg-transparent text-secondary",
              )}
            >
              <i className={`ti ${tb.icon} mr-1.5`} aria-hidden="true" />
              {tb.label}
            </button>
          ))}
        </div>

        {/* ── Timesheet tab ────────────────────────────── */}
        {tab === "timesheet" && (
          <div>
            {/* Timer + week nav + actions row */}
            <div className="flex flex-wrap gap-3 items-center mb-5">
              {/* Timer widget */}
              <div
                className={cx(
                  "flex items-center gap-2 px-3 py-2 rounded-lg border border-line shrink-0",
                  timerRunning ? "bg-brand-light" : "bg-canvas",
                )}
              >
                {!timerRunning ? (
                  <>
                    <Select
                      value={timerProjectId}
                      onChange={(e) => setTimerProjectId(e.target.value)}
                      className="text-xs py-1 px-1.5 min-w-[120px] max-w-[160px] w-auto"
                    >
                      <option value="">{t("time.noProject")}</option>
                      {projects
                        .filter((p) => p.is_active)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </Select>
                    <Button
                      variant="primary"
                      size="sm"
                      icon="ti-player-play"
                      onClick={startTimer}
                    >
                      {t("time.startTimer")}
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="font-mono text-lg font-semibold text-brand min-w-[72px]">
                      {formatElapsed(timerElapsed)}
                    </span>
                    <button
                      onClick={stopTimer}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs bg-danger text-white cursor-pointer"
                    >
                      <i className="ti ti-player-stop text-md" aria-hidden="true" />
                      {t("time.stopTimer")}
                    </button>
                    <span className="text-[11px] text-muted">
                      {t("time.roundedHint")}
                    </span>
                  </>
                )}
              </div>

              {/* Week navigation */}
              <div className="flex items-center gap-2 flex-1 justify-center">
                <Button
                  size="sm"
                  icon="ti-chevron-left"
                  onClick={() => setWeekStart((w) => addDays(w, -7))}
                  aria-label="Previous week"
                />
                <span className="text-md font-medium min-w-[160px] text-center">
                  {fmtWeekRange(weekStart, locale)}
                </span>
                <Button
                  size="sm"
                  icon="ti-chevron-right"
                  onClick={() => setWeekStart((w) => addDays(w, 7))}
                  aria-label="Next week"
                />
                <Button
                  size="sm"
                  onClick={() => setWeekStart(getMonday(todayStr()))}
                >
                  Today
                </Button>
              </div>

              {/* Actions */}
              <div className="flex gap-2 shrink-0">
                {entries.length > 0 && (
                  <Button size="sm" icon="ti-download" onClick={exportCsv}>
                    {t("time.exportCsv")}
                  </Button>
                )}
                <Button variant="primary" icon="ti-plus" onClick={openNewEntry}>
                  {t("time.logTime")}
                </Button>
              </div>
            </div>

            {/* Day summary bar */}
            <div className="grid grid-cols-7 gap-1 mb-5 py-2.5 border-t border-b border-line">
              {weekDays.map((day, i) => {
                const isToday = day === today;
                const h = hoursByDay[day] || 0;
                const dayNum = parseInt(day.split("-")[2]);
                return (
                  <div
                    key={day}
                    className={cx(
                      "text-center px-0.5 py-1.5 rounded-md border",
                      isToday
                        ? "bg-brand-light border-brand"
                        : "bg-transparent border-transparent",
                    )}
                  >
                    <div className="text-[10px] text-muted font-medium uppercase">
                      {DAY_ABBR[i]}
                    </div>
                    <div
                      className={cx(
                        "text-[11px]",
                        isToday
                          ? "text-brand font-semibold"
                          : "text-secondary",
                      )}
                    >
                      {dayNum}
                    </div>
                    {h > 0 && (
                      <div className="text-xs font-bold text-brand mt-0.5">
                        {fmtHours(h)}h
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Week total */}
            {weekTotal > 0 && (
              <div className="text-right text-xs text-muted mb-3">
                {t("time.totalHours", { hours: fmtHours(weekTotal) })}
              </div>
            )}

            {/* Entry list */}
            {loadingEntries ? (
              <p className="text-muted text-center py-6">
                {t("common.loading")}
              </p>
            ) : entries.length === 0 ? (
              <EmptyState
                icon="ti-clock-off"
                title={t("time.noEntries")}
                message={t("time.noEntriesHint")}
              />
            ) : (
              <div className="flex flex-col gap-0.5">
                {Object.keys(entriesByDate)
                  .sort()
                  .map((date) => {
                    const dayEntries = entriesByDate[date];
                    const dayH = hoursByDay[date] || 0;
                    return (
                      <div key={date} className="mb-3">
                        {/* Day header */}
                        <div className="flex justify-between items-center px-2 py-1.5 rounded-md bg-canvas mb-1">
                          <span className="text-xs font-semibold text-secondary">
                            {fmtDate(date, locale)}
                          </span>
                          <span className="text-xs text-brand font-semibold">
                            {fmtHours(dayH)}h
                          </span>
                        </div>

                        {/* Entries */}
                        {dayEntries.map((entry) => {
                          const billAmt =
                            entry.is_billable && entry.hourly_rate
                              ? (
                                  parseFloat(entry.hours) *
                                  parseFloat(entry.hourly_rate)
                                ).toFixed(2)
                              : null;
                          return (
                            <div
                              key={entry.id}
                              className="flex items-center gap-2.5 px-2 py-2.5 border-b border-line"
                            >
                              {/* Color dot */}
                              <div
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{
                                  background:
                                    entry.project_color || "var(--text-muted)",
                                }}
                              />

                              {/* Main info */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {entry.project_name && (
                                    <span className="text-xs font-semibold text-ink">
                                      {entry.project_name}
                                    </span>
                                  )}
                                  {entry.description && (
                                    <span className="text-xs text-muted truncate">
                                      {entry.project_name
                                        ? `· ${entry.description}`
                                        : entry.description}
                                    </span>
                                  )}
                                  {!entry.project_name && !entry.description && (
                                    <span className="text-xs text-muted italic">
                                      {t("time.noProject")}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Right: hours + billable + actions */}
                              <div className="flex items-center gap-2 shrink-0">
                                {entry.is_billable && (
                                  <span className="text-[10px] px-1.5 py-px rounded-sm bg-brand-light text-brand font-medium">
                                    {billAmt ? `$${billAmt}` : t("time.billable")}
                                  </span>
                                )}
                                <span className="text-md font-bold text-ink min-w-[36px] text-right">
                                  {fmtHours(entry.hours)}h
                                </span>
                                <button
                                  onClick={() => openEditEntry(entry)}
                                  className="p-1 text-muted hover:text-ink cursor-pointer"
                                  title={t("common.edit")}
                                >
                                  <i
                                    className="ti ti-pencil text-md"
                                    aria-hidden="true"
                                  />
                                </button>
                                <button
                                  onClick={() => {
                                    if (
                                      window.confirm(t("time.confirmDeleteEntry"))
                                    )
                                      deleteEntry.mutate(entry.id);
                                  }}
                                  className="p-1 text-danger cursor-pointer"
                                  title={t("common.delete")}
                                >
                                  <i
                                    className="ti ti-trash text-md"
                                    aria-hidden="true"
                                  />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {/* ── Projects tab ─────────────────────────────── */}
        {tab === "projects" && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <span className="text-xs text-muted">
                {t("time.projectsReadonly")}
              </span>
              <Link
                to="/projects"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md bg-canvas text-ink border border-line hover:bg-sunken"
              >
                <i className="ti ti-briefcase text-sm" aria-hidden="true" />
                {t("time.manageProjects")}
              </Link>
            </div>

            {projects.length === 0 ? (
              <EmptyState
                icon="ti-folder-off"
                title={t("time.noProjects")}
                message={t("time.noProjectsHint")}
              />
            ) : (
              <div className="flex flex-col gap-0.5">
                {projects.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 px-2 py-3 border-b border-line"
                  >
                    {/* Color swatch */}
                    <div
                      className="w-3.5 h-3.5 rounded-full shrink-0"
                      style={{ background: p.color }}
                    />

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-md font-medium text-ink">
                          {p.name}
                        </span>
                        {!p.is_active && (
                          <span className="text-[10px] px-1.5 py-px rounded-sm bg-line text-muted">
                            inactive
                          </span>
                        )}
                      </div>
                      {p.description && (
                        <div className="text-[11px] text-muted mt-px">
                          {p.description}
                        </div>
                      )}
                    </div>

                    {/* Stats */}
                    <div className="text-right shrink-0">
                      <div className="text-md font-semibold text-ink">
                        {fmtHours(p.total_hours)}h
                      </div>
                      <div className="text-[11px] text-muted">
                        {t("time.entryCount", { count: p.entry_count })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Modals */}
      {entryModal && (
        <EntryModal
          entry={editEntry}
          prefill={entryPrefill}
          projects={projects}
          onClose={() => {
            setEntryModal(false);
            setEditEntry(null);
            setEntryPrefill(null);
          }}
          onSave={handleEntrySave}
          saving={entrySaving}
        />
      )}
    </div>
  );
}
