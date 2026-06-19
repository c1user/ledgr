import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";

const PROJECT_COLORS = [
  "#4f8ef7", "#38a169", "#e53e3e", "#dd6b20",
  "#805ad5", "#d69e2e", "#319795", "#e91e8c",
];

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
    projectId:   entry?.project_id   ?? prefill?.projectId ?? "",
    date:        entry?.date         ?? prefill?.date      ?? todayStr(),
    hours:       entry?.hours        ? String(parseFloat(entry.hours)) : (prefill?.hours ?? ""),
    description: entry?.description  ?? "",
    isBillable:  entry?.is_billable  ?? true,
    hourlyRate:  entry?.hourly_rate  ? String(entry.hourly_rate) : "",
  }));
  const [err, setErr] = useState("");

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function handleSubmit(e) {
    e.preventDefault();
    setErr("");
    if (!form.date) return setErr(t("time.errDateRequired"));
    const h = parseFloat(form.hours);
    if (!h || h <= 0) return setErr(t("time.errHoursRequired"));
    onSave({
      ...(entry ? { id: entry.id } : {}),
      projectId:   form.projectId || null,
      date:        form.date,
      hours:       h,
      description: form.description || null,
      isBillable:  form.isBillable,
      hourlyRate:  form.isBillable && form.hourlyRate ? parseFloat(form.hourlyRate) : null,
    });
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, padding: 16,
    }}>
      <div className="card" style={{ width: "100%", maxWidth: 460, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            {entry ? t("time.editEntry") : t("time.newEntry")}
          </h2>
          <button onClick={onClose} className="btn btn-sm btn-secondary"
            style={{ padding: "4px 8px" }}>
            <i className="ti ti-x" />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Project */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>
              {t("time.project")}
            </label>
            <select
              value={form.projectId}
              onChange={e => set("projectId", e.target.value)}
              className="form-input"
            >
              <option value="">{t("time.noProject")}</option>
              {projects.filter(p => p.is_active).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Date + Hours (row) */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>
                {t("time.date")}
              </label>
              <input
                type="date"
                required
                value={form.date}
                onChange={e => set("date", e.target.value)}
                className="form-input"
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>
                {t("time.hours")}
              </label>
              <input
                type="number"
                required
                min="0.25"
                step="0.25"
                placeholder="0.00"
                value={form.hours}
                onChange={e => set("hours", e.target.value)}
                className="form-input"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>
              {t("time.description")}
            </label>
            <textarea
              rows={2}
              placeholder="What did you work on?"
              value={form.description}
              onChange={e => set("description", e.target.value)}
              className="form-input"
              style={{ resize: "vertical", minHeight: 60 }}
            />
          </div>

          {/* Billable toggle + rate */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={form.isBillable}
                onChange={e => set("isBillable", e.target.checked)}
              />
              {t("time.billable")}
            </label>
            {form.isBillable && (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {t("time.hourlyRate")}
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={form.hourlyRate}
                  onChange={e => set("hourlyRate", e.target.value)}
                  className="form-input"
                  style={{ width: 90 }}
                />
              </div>
            )}
          </div>

          {err && (
            <p style={{ color: "var(--error, #e53e3e)", fontSize: 12, margin: 0 }}>{err}</p>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" onClick={onClose} className="btn btn-secondary">
              {t("common.cancel")}
            </button>
            <button type="submit" disabled={saving} className="btn btn-primary">
              {saving ? t("time.saving") : entry ? t("time.saveChanges") : t("time.createEntry")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── ProjectModal ─────────────────────────────────────────────
function ProjectModal({ project, onClose, onSave, saving }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name:        project?.name        ?? "",
    description: project?.description ?? "",
    color:       project?.color       ?? PROJECT_COLORS[0],
  });
  const [err, setErr] = useState("");

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function handleSubmit(e) {
    e.preventDefault();
    setErr("");
    if (!form.name.trim()) return setErr(t("time.errNameRequired"));
    onSave({
      ...(project ? { id: project.id } : {}),
      name:        form.name.trim(),
      description: form.description || null,
      color:       form.color,
    });
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, padding: 16,
    }}>
      <div className="card" style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            {project ? t("time.editProject") : t("time.newProject")}
          </h2>
          <button onClick={onClose} className="btn btn-sm btn-secondary"
            style={{ padding: "4px 8px" }}>
            <i className="ti ti-x" />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>
              {t("time.projectName")} *
            </label>
            <input
              type="text"
              required
              autoFocus
              placeholder="e.g. Website Redesign"
              value={form.name}
              onChange={e => set("name", e.target.value)}
              className="form-input"
            />
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
              {t("time.projectColor")}
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {PROJECT_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => set("color", c)}
                  style={{
                    width: 28, height: 28, borderRadius: "50%",
                    background: c, border: "none", cursor: "pointer",
                    outline: form.color === c ? `3px solid ${c}` : "none",
                    outlineOffset: 2,
                    boxShadow: form.color === c ? "0 0 0 2px var(--bg-primary)" : "none",
                  }}
                />
              ))}
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>
              {t("time.projectDescription")}
            </label>
            <input
              type="text"
              placeholder="Optional description"
              value={form.description}
              onChange={e => set("description", e.target.value)}
              className="form-input"
            />
          </div>

          {err && (
            <p style={{ color: "var(--error, #e53e3e)", fontSize: 12, margin: 0 }}>{err}</p>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" onClick={onClose} className="btn btn-secondary">
              {t("common.cancel")}
            </button>
            <button type="submit" disabled={saving} className="btn btn-primary">
              {saving ? t("time.saving") : project ? t("time.saveChanges") : t("time.createProject")}
            </button>
          </div>
        </form>
      </div>
    </div>
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
    const id = setInterval(() => forceRender(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [timerRunning]);

  const timerElapsed = timerRunning && timerStart
    ? Math.floor((Date.now() - timerStart) / 1000)
    : 0;

  // Modals
  const [entryModal, setEntryModal] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [entryPrefill, setEntryPrefill] = useState(null);
  const [projectModal, setProjectModal] = useState(false);
  const [editProject, setEditProject] = useState(null);

  // Data
  const { data: entries = [], isLoading: loadingEntries } = useQuery({
    queryKey: ["time-entries", weekStart],
    queryFn: () => api.get(`/time-entries?week=${weekStart}`).then(r => r.data),
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get("/projects").then(r => r.data),
  });

  // Mutations — entries
  const createEntry = useMutation({
    mutationFn: body => api.post("/time-entries", body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["time-entries"] });
      setEntryModal(false);
      setEditEntry(null);
    },
  });

  const updateEntry = useMutation({
    mutationFn: ({ id, ...body }) => api.put(`/time-entries/${id}`, body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["time-entries"] });
      setEntryModal(false);
      setEditEntry(null);
    },
  });

  const deleteEntry = useMutation({
    mutationFn: id => api.delete(`/time-entries/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["time-entries"] }),
  });

  // Mutations — projects
  const createProject = useMutation({
    mutationFn: body => api.post("/projects", body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      setProjectModal(false);
      setEditProject(null);
    },
  });

  const updateProject = useMutation({
    mutationFn: ({ id, ...body }) => api.put(`/projects/${id}`, body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      setProjectModal(false);
      setEditProject(null);
    },
  });

  const deleteProject = useMutation({
    mutationFn: id => api.delete(`/projects/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
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
    setEntryPrefill({ hours: String(rounded), projectId: timerProjectId, date: todayStr() });
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

  // Project actions
  function openNewProject() {
    setEditProject(null);
    setProjectModal(true);
  }

  function openEditProject(p) {
    setEditProject(p);
    setProjectModal(true);
  }

  function handleProjectSave(payload) {
    if (payload.id) updateProject.mutate(payload);
    else createProject.mutate(payload);
  }

  // CSV export
  function exportCsv() {
    const header = ["Date", "Project", "Description", "Hours", "Billable", "Rate", "Amount"].join(",");
    const rows = entries.map(e => {
      const rate = e.hourly_rate ? parseFloat(e.hourly_rate) : "";
      const amount = e.is_billable && rate ? (parseFloat(e.hours) * rate).toFixed(2) : "";
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
  const projectSaving = createProject.isPending || updateProject.isPending;

  // Tab pill style
  const tabStyle = (active) => ({
    padding: "6px 16px",
    borderRadius: 6,
    border: "none",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    background: active ? "var(--brand)" : "transparent",
    color: active ? "#fff" : "var(--text-secondary)",
    transition: "all 0.15s",
  });

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{t("time.title")}</h1>
      </div>

      <div className="card">
        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "var(--bg-secondary, var(--border-color))", borderRadius: 8, padding: 3, width: "fit-content" }}>
          <button style={tabStyle(tab === "timesheet")} onClick={() => setTab("timesheet")}>
            <i className="ti ti-calendar-week" style={{ marginRight: 6 }} />
            {t("time.timesheet")}
          </button>
          <button style={tabStyle(tab === "projects")} onClick={() => setTab("projects")}>
            <i className="ti ti-folder" style={{ marginRight: 6 }} />
            {t("time.projects")}
          </button>
        </div>

        {/* ── Timesheet tab ────────────────────────────── */}
        {tab === "timesheet" && (
          <div>
            {/* Timer + week nav + actions row */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 20 }}>
              {/* Timer widget */}
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 12px", borderRadius: 8,
                border: "1px solid var(--border-color)",
                background: timerRunning ? "var(--brand-light, #ebf4ff)" : "var(--bg-secondary, transparent)",
                flex: "0 0 auto",
              }}>
                {!timerRunning ? (
                  <>
                    <select
                      value={timerProjectId}
                      onChange={e => setTimerProjectId(e.target.value)}
                      className="form-input"
                      style={{ fontSize: 12, padding: "3px 6px", height: "auto", minWidth: 120, maxWidth: 160 }}
                    >
                      <option value="">{t("time.noProject")}</option>
                      {projects.filter(p => p.is_active).map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={startTimer}
                      className="btn btn-primary"
                      style={{ padding: "5px 12px", fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}
                    >
                      <i className="ti ti-player-play" style={{ fontSize: 13 }} />
                      {t("time.startTimer")}
                    </button>
                  </>
                ) : (
                  <>
                    <span style={{ fontFamily: "monospace", fontSize: 18, fontWeight: 600, color: "var(--brand)", minWidth: 72 }}>
                      {formatElapsed(timerElapsed)}
                    </span>
                    <button
                      onClick={stopTimer}
                      style={{
                        padding: "5px 12px", fontSize: 12, borderRadius: 6, border: "none",
                        cursor: "pointer", background: "var(--error, #e53e3e)", color: "#fff",
                        display: "flex", alignItems: "center", gap: 5,
                      }}
                    >
                      <i className="ti ti-player-stop" style={{ fontSize: 13 }} />
                      {t("time.stopTimer")}
                    </button>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("time.roundedHint")}</span>
                  </>
                )}
              </div>

              {/* Week navigation */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 auto", justifyContent: "center" }}>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => setWeekStart(w => addDays(w, -7))}
                  style={{ padding: "4px 10px" }}
                  aria-label="Previous week"
                >
                  <i className="ti ti-chevron-left" />
                </button>
                <span style={{ fontSize: 13, fontWeight: 500, minWidth: 160, textAlign: "center" }}>
                  {fmtWeekRange(weekStart, locale)}
                </span>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => setWeekStart(w => addDays(w, 7))}
                  style={{ padding: "4px 10px" }}
                  aria-label="Next week"
                >
                  <i className="ti ti-chevron-right" />
                </button>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => setWeekStart(getMonday(todayStr()))}
                  style={{ padding: "4px 10px", fontSize: 11 }}
                >
                  Today
                </button>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
                {entries.length > 0 && (
                  <button onClick={exportCsv} className="btn btn-sm btn-secondary"
                    style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <i className="ti ti-download" style={{ fontSize: 13 }} />
                    {t("time.exportCsv")}
                  </button>
                )}
                <button onClick={openNewEntry} className="btn btn-primary"
                  style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <i className="ti ti-plus" style={{ fontSize: 14 }} />
                  {t("time.logTime")}
                </button>
              </div>
            </div>

            {/* Day summary bar */}
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(7, 1fr)",
              gap: 4, marginBottom: 20,
              padding: "10px 0",
              borderTop: "1px solid var(--border-color)",
              borderBottom: "1px solid var(--border-color)",
            }}>
              {weekDays.map((day, i) => {
                const isToday = day === today;
                const h = hoursByDay[day] || 0;
                const dayNum = parseInt(day.split("-")[2]);
                return (
                  <div
                    key={day}
                    style={{
                      textAlign: "center",
                      padding: "6px 2px",
                      borderRadius: 6,
                      background: isToday ? "var(--brand-light, #ebf4ff)" : "transparent",
                      border: `1px solid ${isToday ? "var(--brand)" : "transparent"}`,
                    }}
                  >
                    <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500, textTransform: "uppercase" }}>
                      {DAY_ABBR[i]}
                    </div>
                    <div style={{ fontSize: 11, color: isToday ? "var(--brand)" : "var(--text-secondary)", fontWeight: isToday ? 600 : 400 }}>
                      {dayNum}
                    </div>
                    {h > 0 && (
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand)", marginTop: 2 }}>
                        {fmtHours(h)}h
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Week total */}
            {weekTotal > 0 && (
              <div style={{ textAlign: "right", fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
                {t("time.totalHours", { hours: fmtHours(weekTotal) })}
              </div>
            )}

            {/* Entry list */}
            {loadingEntries ? (
              <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "24px 0" }}>
                {t("common.loading")}
              </p>
            ) : entries.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 0" }}>
                <i className="ti ti-clock-off" style={{ fontSize: 36, color: "var(--text-muted)", display: "block", marginBottom: 8 }} />
                <p style={{ color: "var(--text-muted)", margin: 0, fontSize: 14 }}>{t("time.noEntries")}</p>
                <p style={{ color: "var(--text-muted)", margin: "4px 0 0", fontSize: 12 }}>{t("time.noEntriesHint")}</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {Object.keys(entriesByDate).sort().map(date => {
                  const dayEntries = entriesByDate[date];
                  const dayH = hoursByDay[date] || 0;
                  return (
                    <div key={date} style={{ marginBottom: 12 }}>
                      {/* Day header */}
                      <div style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "6px 8px", borderRadius: 6,
                        background: "var(--bg-secondary, var(--border-color))",
                        marginBottom: 4,
                      }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>
                          {fmtDate(date, locale)}
                        </span>
                        <span style={{ fontSize: 12, color: "var(--brand)", fontWeight: 600 }}>
                          {fmtHours(dayH)}h
                        </span>
                      </div>

                      {/* Entries */}
                      {dayEntries.map(entry => {
                        const billAmt = entry.is_billable && entry.hourly_rate
                          ? (parseFloat(entry.hours) * parseFloat(entry.hourly_rate)).toFixed(2)
                          : null;
                        return (
                          <div key={entry.id} style={{
                            display: "flex", alignItems: "center", gap: 10,
                            padding: "10px 8px",
                            borderBottom: "1px solid var(--border-color)",
                          }}>
                            {/* Color dot */}
                            <div style={{
                              width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                              background: entry.project_color || "var(--text-muted)",
                            }} />

                            {/* Main info */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                {entry.project_name && (
                                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
                                    {entry.project_name}
                                  </span>
                                )}
                                {entry.description && (
                                  <span style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {entry.project_name ? `· ${entry.description}` : entry.description}
                                  </span>
                                )}
                                {!entry.project_name && !entry.description && (
                                  <span style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                                    {t("time.noProject")}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Right: hours + billable + actions */}
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                              {entry.is_billable && (
                                <span style={{
                                  fontSize: 10, padding: "2px 5px", borderRadius: 3,
                                  background: "var(--brand-light, #ebf4ff)", color: "var(--brand)",
                                  fontWeight: 500,
                                }}>
                                  {billAmt ? `$${billAmt}` : t("time.billable")}
                                </span>
                              )}
                              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", minWidth: 36, textAlign: "right" }}>
                                {fmtHours(entry.hours)}h
                              </span>
                              <button
                                onClick={() => openEditEntry(entry)}
                                className="btn btn-sm btn-secondary"
                                style={{ padding: "3px 6px" }}
                                title={t("common.edit")}
                              >
                                <i className="ti ti-pencil" style={{ fontSize: 13 }} />
                              </button>
                              <button
                                onClick={() => {
                                  if (window.confirm(t("time.confirmDeleteEntry")))
                                    deleteEntry.mutate(entry.id);
                                }}
                                className="btn btn-sm btn-secondary"
                                style={{ padding: "3px 6px", color: "var(--error, #e53e3e)" }}
                                title={t("common.delete")}
                              >
                                <i className="ti ti-trash" style={{ fontSize: 13 }} />
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
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
              <button onClick={openNewProject} className="btn btn-primary"
                style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <i className="ti ti-plus" style={{ fontSize: 14 }} />
                {t("time.addProject")}
              </button>
            </div>

            {projects.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 0" }}>
                <i className="ti ti-folder-off" style={{ fontSize: 36, color: "var(--text-muted)", display: "block", marginBottom: 8 }} />
                <p style={{ color: "var(--text-muted)", margin: 0, fontSize: 14 }}>{t("time.noProjects")}</p>
                <p style={{ color: "var(--text-muted)", margin: "4px 0 0", fontSize: 12 }}>{t("time.noProjectsHint")}</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {projects.map(p => (
                  <div key={p.id} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "12px 8px",
                    borderBottom: "1px solid var(--border-color)",
                  }}>
                    {/* Color swatch */}
                    <div style={{
                      width: 14, height: 14, borderRadius: "50%",
                      background: p.color, flexShrink: 0,
                    }} />

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
                          {p.name}
                        </span>
                        {!p.is_active && (
                          <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, background: "var(--border-color)", color: "var(--text-muted)" }}>
                            inactive
                          </span>
                        )}
                      </div>
                      {p.description && (
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
                          {p.description}
                        </div>
                      )}
                    </div>

                    {/* Stats */}
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                        {fmtHours(p.total_hours)}h
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {t("time.entryCount", { count: p.entry_count })}
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      <button
                        onClick={() => openEditProject(p)}
                        className="btn btn-sm btn-secondary"
                        style={{ padding: "4px 8px" }}
                        title={t("common.edit")}
                      >
                        <i className="ti ti-pencil" style={{ fontSize: 13 }} />
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(t("time.confirmDeleteProject", { name: p.name })))
                            deleteProject.mutate(p.id);
                        }}
                        className="btn btn-sm btn-secondary"
                        style={{ padding: "4px 8px", color: "var(--error, #e53e3e)" }}
                        title={t("common.delete")}
                      >
                        <i className="ti ti-trash" style={{ fontSize: 13 }} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {entryModal && (
        <EntryModal
          entry={editEntry}
          prefill={entryPrefill}
          projects={projects}
          onClose={() => { setEntryModal(false); setEditEntry(null); setEntryPrefill(null); }}
          onSave={handleEntrySave}
          saving={entrySaving}
        />
      )}
      {projectModal && (
        <ProjectModal
          project={editProject}
          onClose={() => { setProjectModal(false); setEditProject(null); }}
          onSave={handleProjectSave}
          saving={projectSaving}
        />
      )}
    </div>
  );
}
