import type { ColumnMeta } from "../types";

type Props = { columns: ColumnMeta[]; rows: Record<string, unknown>[]; emptyLabel?: string };

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return <span className="null-value">NULL</span>;
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export function DataGrid({ columns, rows, emptyLabel = "暂无数据" }: Props) {
  if (!columns.length) return <div className="data-empty">{emptyLabel}</div>;
  return (
    <div className="data-grid-wrap">
      <table className="data-grid">
        <thead>
          <tr><th className="row-index-head" aria-label="行号" />{columns.map((column, index) => <th key={column.name}><span className="column-index">{String(index + 1).padStart(2, "0")}</span>{column.name}<span className="column-type">{column.type}</span></th>)}</tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row, rowIndex) => <tr key={`${rowIndex}-${String(row[columns[0].name])}`}><td className="row-index">{rowIndex + 1}</td>{columns.map((column) => <td key={column.name}>{displayValue(row[column.name])}</td>)}</tr>) : <tr><td className="data-empty-cell" colSpan={columns.length + 1}>{emptyLabel}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
