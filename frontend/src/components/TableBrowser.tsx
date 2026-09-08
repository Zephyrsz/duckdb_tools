import type { TableInfo } from "../types";
import { Icon } from "./Icon";
import { DataGrid } from "./DataGrid";

type Props = { table: TableInfo | null; isLoading: boolean; error: string | null; onQuery: () => void };

export function TableBrowser({ table, isLoading, error, onQuery }: Props) {
  if (isLoading) return <section className="surface-panel loading-panel"><div className="skeleton skeleton-title" /><div className="skeleton skeleton-line" /><div className="skeleton skeleton-table" /></section>;
  if (error) return <section className="surface-panel state-panel"><div className="state-icon error"><Icon name="alert" size={23} /></div><h2>数据表暂时打不开</h2><p>{error}</p></section>;
  if (!table) return <section className="surface-panel state-panel"><div className="state-icon"><Icon name="table" size={23} /></div><h2>选择一张数据表</h2><p>从左侧列表选择表名，查看字段和前 100 行数据。</p></section>;
  return <section className="surface-panel browser-panel" aria-labelledby="browser-title">
    <div className="panel-heading"><div><div className="section-kicker">表浏览</div><h1 id="browser-title">{table.table_name}</h1><p className="panel-subtitle">快速查看字段结构与样例数据，结果最多展示前 100 行。</p></div><button type="button" className="secondary-button" onClick={onQuery}><Icon name="play" size={14} /> 在 SQL 中打开</button></div>
    <div className="table-stats"><div><span>字段</span><strong>{table.columns.length}</strong></div><div><span>总行数</span><strong>{table.row_count.toLocaleString()}</strong></div><div><span>状态</span><strong className="text-success"><span className="status-dot" /> 就绪</strong></div></div>
    <div className="schema-strip"><div className="strip-title"><Icon name="barChart" size={15} /> 字段结构</div><div className="schema-list">{table.columns.map((column, index) => <div className="schema-item" key={column.name}><span className="schema-index">{String(index + 1).padStart(2, "0")}</span><strong>{column.name}</strong><span>{column.type}</span></div>)}</div></div>
    <div className="data-section"><div className="data-section-head"><span>样例数据</span><span className="muted-label">{table.rows.length} / {table.row_count.toLocaleString()} 行</span></div><DataGrid columns={table.columns} rows={table.rows} /></div>
  </section>;
}
