/**
 * RulePayloadEditor — human-readable view/editor for payroll rule payloads.
 *
 * The payloads are heterogeneous JSONB (rate scalars, *_cents money, nested
 * windows, bracket tables, regime lists), so this renders them generically:
 *   object            → labeled rows / nested sections
 *   array of flat obj → editable table (add/remove rows)
 *   array of scalars  → comma-list (editable as text)
 *   deeper arrays     → numbered read-only sections (structural changes go
 *                       through the raw-JSON toggle in the modal)
 *
 * Formatting conventions the accountant actually reads:
 *   *_cents keys      → dollars (edited in dollars, stored in cents)
 *   *rate/percentage  → percent (edited as %, stored as decimal fraction)
 *   booleans          → Sí/No
 *   null              → —
 */

import cx from "../../lib/cx";
import { Input } from "../ui";

const isCentsKey = (k) => /_cents$/.test(String(k));
const isRateKey = (k) => /(^|_)(rate|percentage)$/.test(String(k));

const isScalar = (v) => v === null || typeof v !== "object";
const isFlatObject = (v) =>
  v !== null &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.values(v).every(isScalar);

function classify(value) {
  if (isScalar(value)) return "scalar";
  if (!Array.isArray(value)) return "object";
  if (value.every(isScalar)) return "scalar-array";
  if (value.every(isFlatObject)) return "table-array";
  return "complex-array";
}

const fmtMoney = (cents) =>
  new Intl.NumberFormat("es-PR", { style: "currency", currency: "USD" }).format(
    (Number(cents) || 0) / 100,
  );

// 0.062 → "6.2 %" without float noise.
const fmtRate = (v) => `${Math.round(Number(v) * 1e6) / 1e4} %`;

function labelFor(key, t) {
  const pretty = String(key)
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
  return t(`payrollRules.field_${key}`, { defaultValue: pretty });
}

function formatScalar(key, value, inCents, t) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean")
    return value ? t("common.yes") : t("common.no");
  if (typeof value === "number") {
    if (inCents || isCentsKey(key)) return fmtMoney(value);
    if (isRateKey(key) && Math.abs(value) < 1) return fmtRate(value);
    return String(value);
  }
  return String(value);
}

// Immutable set-at-path for the working payload copy.
function setAtPath(obj, path, value) {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (Array.isArray(obj)) {
    const copy = obj.slice();
    copy[head] = setAtPath(obj[head], rest, value);
    return copy;
  }
  return { ...obj, [head]: setAtPath(obj?.[head], rest, value) };
}

// ── Leaf editor ──────────────────────────────────────────────
function ScalarEditor({ k, value, inCents, onChange }) {
  const cents = inCents || isCentsKey(k);
  const rate = !cents && isRateKey(k) && (value === null || Math.abs(value) < 1);

  if (typeof value === "boolean") {
    return (
      <input
        type="checkbox"
        className="w-4 h-4 cursor-pointer"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }

  if (cents) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-muted text-[12px]">$</span>
        <Input
          type="number"
          step="0.01"
          className="text-right max-w-[130px]"
          value={value === null || value === undefined ? "" : value / 100}
          onChange={(e) =>
            onChange(
              e.target.value === ""
                ? null
                : Math.round(parseFloat(e.target.value) * 100),
            )
          }
        />
      </div>
    );
  }

  if (rate) {
    return (
      <div className="flex items-center gap-1">
        <Input
          type="number"
          step="0.0001"
          className="text-right max-w-[110px]"
          value={
            value === null || value === undefined
              ? ""
              : Math.round(Number(value) * 1e6) / 1e4
          }
          onChange={(e) =>
            onChange(
              e.target.value === ""
                ? null
                : Math.round(parseFloat(e.target.value) * 1e4) / 1e6,
            )
          }
        />
        <span className="text-muted text-[12px]">%</span>
      </div>
    );
  }

  if (typeof value === "number" || value === null) {
    return (
      <Input
        type={typeof value === "number" ? "number" : "text"}
        step="any"
        className="max-w-[180px]"
        value={value === null || value === undefined ? "" : value}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") return onChange(null);
          const n = Number(raw);
          onChange(Number.isFinite(n) && raw.trim() !== "" ? n : raw);
        }}
      />
    );
  }

  return (
    <Input
      type="text"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// ── Recursive node renderer ──────────────────────────────────
function Node({ k, value, path, inCents, readOnly, onSet, t, depth = 0 }) {
  const kind = classify(value);

  if (kind === "scalar") {
    return (
      <div className="flex items-center justify-between gap-3 py-1.5 border-b border-line/60 last:border-0">
        <span className="text-[12px] text-muted">{labelFor(k, t)}</span>
        {readOnly ? (
          <span className="text-[13px] text-ink font-medium text-right">
            {formatScalar(k, value, inCents, t)}
          </span>
        ) : (
          <ScalarEditor
            k={k}
            value={value}
            inCents={inCents}
            onChange={(v) => onSet(path, v)}
          />
        )}
      </div>
    );
  }

  if (kind === "scalar-array") {
    return (
      <div className="py-1.5 border-b border-line/60 last:border-0">
        <div className="text-[12px] text-muted mb-1">{labelFor(k, t)}</div>
        {readOnly ? (
          <div className="flex flex-wrap gap-1.5">
            {value.length === 0 ? (
              <span className="text-[13px] text-muted">—</span>
            ) : (
              value.map((v, i) => (
                <span
                  key={i}
                  className="text-[12px] bg-canvas rounded-md px-2 py-0.5 text-ink"
                >
                  {String(v)}
                </span>
              ))
            )}
          </div>
        ) : (
          <Input
            type="text"
            value={value.join(", ")}
            onChange={(e) =>
              onSet(
                path,
                e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
          />
        )}
      </div>
    );
  }

  if (kind === "table-array") {
    const columns = [...new Set(value.flatMap((row) => Object.keys(row)))];
    const addRow = () => {
      const blank = Object.fromEntries(columns.map((c) => [c, null]));
      onSet(path, [...value, blank]);
    };
    const removeRow = (i) =>
      onSet(
        path,
        value.filter((_, idx) => idx !== i),
      );
    return (
      <div className="py-1.5 border-b border-line/60 last:border-0">
        <div className="text-[12px] text-muted mb-1">{labelFor(k, t)}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[11px] text-muted border-b border-line">
                {columns.map((c) => (
                  <th key={c} className="py-1 pr-3 font-medium">
                    {labelFor(c, t)}
                  </th>
                ))}
                {!readOnly && <th className="w-[26px]" />}
              </tr>
            </thead>
            <tbody>
              {value.map((row, i) => (
                <tr key={i} className="border-b border-line/60 last:border-0">
                  {columns.map((c) => (
                    <td key={c} className="py-1 pr-3">
                      {readOnly ? (
                        <span className="text-ink">
                          {formatScalar(c, row[c], false, t)}
                        </span>
                      ) : (
                        <ScalarEditor
                          k={c}
                          value={row[c] === undefined ? null : row[c]}
                          inCents={false}
                          onChange={(v) => onSet([...path, i, c], v)}
                        />
                      )}
                    </td>
                  ))}
                  {!readOnly && (
                    <td>
                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        className="text-muted hover:text-danger cursor-pointer"
                        title={t("common.delete")}
                      >
                        <i className="ti ti-x text-[12px]" aria-hidden="true" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={addRow}
            className="text-[12px] text-brand hover:underline mt-1 cursor-pointer"
          >
            <i className="ti ti-plus mr-1" aria-hidden="true" />
            {t("payrollRules.addRow")}
          </button>
        )}
      </div>
    );
  }

  if (kind === "object") {
    const childInCents = isCentsKey(k);
    return (
      <div className={cx("py-1.5", depth === 0 && "border-b border-line/60 last:border-0")}>
        <div className="text-[12px] font-semibold text-secondary mb-1">
          {labelFor(k, t)}
        </div>
        <div className="pl-3 border-l-2 border-line">
          {Object.entries(value).map(([ck, cv]) => (
            <Node
              key={ck}
              k={ck}
              value={cv}
              path={[...path, ck]}
              inCents={childInCents}
              readOnly={readOnly}
              onSet={onSet}
              t={t}
              depth={depth + 1}
            />
          ))}
        </div>
      </div>
    );
  }

  // complex-array — nested structures (e.g. bonus regimes with bands):
  // rendered recursively; rows stay editable, add/remove needs the JSON view.
  return (
    <div className="py-1.5 border-b border-line/60 last:border-0">
      <div className="text-[12px] font-semibold text-secondary mb-1">
        {labelFor(k, t)}
      </div>
      {value.map((item, i) => (
        <div key={i} className="pl-3 border-l-2 border-line mb-2">
          <div className="text-[11px] text-muted uppercase tracking-[0.5px] mb-0.5">
            {labelFor(k, t)} {i + 1}
          </div>
          {isScalar(item) ? (
            <span className="text-[13px] text-ink">
              {formatScalar(k, item, false, t)}
            </span>
          ) : (
            Object.entries(item).map(([ck, cv]) => (
              <Node
                key={ck}
                k={ck}
                value={cv}
                path={[...path, i, ck]}
                inCents={false}
                readOnly={readOnly}
                onSet={onSet}
                t={t}
                depth={depth + 1}
              />
            ))
          )}
        </div>
      ))}
      {!readOnly && (
        <div className="text-[11px] text-muted">
          {t("payrollRules.structuralHint")}
        </div>
      )}
    </div>
  );
}

export default function RulePayloadEditor({ payload, onChange, readOnly, t }) {
  const onSet = (path, value) => onChange(setAtPath(payload, path, value));
  return (
    <div className="bg-canvas rounded-lg px-3.5 py-2">
      {Object.entries(payload || {}).map(([k, v]) => (
        <Node
          key={k}
          k={k}
          value={v}
          path={[k]}
          inCents={false}
          readOnly={readOnly}
          onSet={onSet}
          t={t}
        />
      ))}
    </div>
  );
}
