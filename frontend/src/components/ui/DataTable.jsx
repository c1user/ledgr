import cx from "../../lib/cx";

// columns: [{ key, header, align?: "right", className?, headerClassName?, render?(row) }]
export default function DataTable({
  columns,
  rows,
  keyField = "id",
  onRowClick,
  empty,
  className,
}) {
  return (
    <div className={cx("overflow-x-auto", className)}>
      <table className="w-full text-md border-collapse">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={cx(
                  "text-left text-[11px] uppercase tracking-wide font-semibold text-muted",
                  "px-3 py-[var(--row-y-sm)] border-b border-line whitespace-nowrap",
                  col.align === "right" && "text-right",
                  col.headerClassName,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-8 text-center text-muted"
              >
                {empty || "—"}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row[keyField]}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cx(
                  "border-b border-line last:border-b-0",
                  onRowClick && "cursor-pointer hover:bg-canvas transition-colors",
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cx(
                      "px-3 py-[var(--row-y-sm)] align-middle",
                      col.align === "right" && "text-right",
                      col.className,
                    )}
                  >
                    {col.render ? col.render(row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
