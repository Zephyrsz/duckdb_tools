import type { QueryResult } from "../types";
import { Icon } from "./Icon";
import { DataGrid } from "./DataGrid";

type Props = { sql: string; onSqlChange: (sql: string) => void; onRun: () => void; isLoading: boolean; result: QueryResult | null; error: string | null; tablesCount: number };

export function SqlWorkspace({ sql, onSqlChange, onRun, isLoading, result, error, tablesCount }: Props) {
  return <section className="query-layout" aria-labelledby="query-title">
    <div className="surface-panel editor-panel">
      <div className="panel-heading editor-heading"><div><div className="section-kicker">查询工作区</div><h1 id="query-title">用 SQL 找到答案</h1><p className="panel-subtitle">当前数据集包含 {tablesCount} 张表，查询结果只读，不会修改原始数据。</p></div><div className="editor-badge"><span className="status-dot" /> READ ONLY</div></div>
      <div className="editor-toolbar"><span><Icon name="file" size={14} /> query.sql</span><span className="shortcut">⌘ ↵ 执行</span></div>
      <div className="editor-wrap"><textarea value={sql} onChange={(event) => onSqlChange(event.target.value)} spellCheck={false} aria-label="SQL 查询编辑器" /><div className="editor-gutter"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span></div></div>
      <div className="editor-footer"><span className="editor-hint">支持 SELECT、WITH、DESCRIBE、SHOW、EXPLAIN</span><button type="button" className="run-button" onClick={onRun} disabled={isLoading || !sql.trim()}>{isLoading ? <><Icon name="refresh" size={15} className="spin" /> 执行中…</> : <><Icon name="play" size={15} /> 执行查询</>}</button></div>
      {error && <div className="error-banner"><Icon name="alert" size={16} /><span>{error}</span></div>}
    </div>
    <div className="surface-panel result-panel">
      <div className="result-heading"><div><div className="section-kicker">结果</div><h2>{result ? `${result.row_count.toLocaleString()} 行结果` : "等待一次查询"}</h2></div>{result && <div className="result-meta"><span>{result.columns.length} 列</span><span>{result.elapsed_ms} ms</span></div>}</div>
      {result ? <DataGrid columns={result.columns} rows={result.rows} emptyLabel="查询没有返回数据" /> : <div className="result-empty"><div className="result-empty-icon"><Icon name="barChart" size={22} /></div><strong>执行 SQL 后，结果会显示在这里</strong><span>先从左侧选择一张表，或直接编辑上方示例查询。</span></div>}
    </div>
  </section>;
}
