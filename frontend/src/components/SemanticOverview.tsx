import type { SemanticSummary, SemanticTableSummary, SemanticValidation } from "../types";
import { Icon } from "./Icon";

type Props = {
  summary: SemanticSummary | null;
  tables: SemanticTableSummary[];
  validation: SemanticValidation | null;
  isLoading: boolean;
  isBusy: boolean;
  error: string | null;
  onScan: () => void;
  onValidate: () => void;
  onPublish: () => void;
  onSelectTable: (name: string) => void;
};

export function SemanticOverview({ summary, tables, validation, isLoading, isBusy, error, onScan, onValidate, onPublish, onSelectTable }: Props) {
  if (isLoading) return <section className="surface-panel state-panel"><div className="state-icon"><Icon name="refresh" size={22} className="spin" /></div><h2>正在读取语义层</h2><p>加载共享 SQLite metadata 状态。</p></section>;
  return <section className="surface-panel semantic-panel" aria-labelledby="semantic-title">
    <div className="panel-heading semantic-heading">
      <div><div className="section-kicker">语义层</div><h1 id="semantic-title">把字段变成业务语言</h1><p className="panel-subtitle">扫描 DuckDB 表结构生成可解释草稿，确认后发布到 rds_agent 共用的 SQLite metadata。</p></div>
      <div className="semantic-actions"><button type="button" className="secondary-button" onClick={onScan} disabled={isBusy}><Icon name="scan" size={14} /> 扫描数据</button><button type="button" className="primary-button" onClick={onPublish} disabled={isBusy || !validation?.valid}><Icon name="check" size={14} /> 发布 metadata</button></div>
    </div>
    {error && <div className="error-banner"><Icon name="alert" size={15} /><span>{error}</span></div>}
    <div className="semantic-stats">
      <div><span>草稿</span><strong>{summary?.draft_count ?? 0}</strong></div><div><span>已确认</span><strong>{summary?.approved_count ?? 0}</strong></div><div><span>已发布版本</span><strong>{summary?.revision ?? 0}</strong></div><div><span>运行时存储</span><strong className="semantic-path">SQLite</strong></div>
    </div>
    <div className="semantic-toolbar"><div><strong>数据表语义状态</strong><span>选择表查看字段候选、证据和确认状态。</span></div><button type="button" className="secondary-button" onClick={onValidate} disabled={isBusy}><Icon name="check" size={14} /> 校验草稿</button></div>
    {validation && <div className={`validation-box ${validation.valid ? "is-valid" : "is-invalid"}`}><Icon name={validation.valid ? "check" : "alert"} size={15} /><span>{validation.valid ? `校验通过，可以发布 ${validation.counts.approved} 个对象。` : `${validation.errors.length} 个错误，${validation.warnings.length} 个待确认项。`}</span></div>}
    <div className="semantic-table-list">{tables.length === 0 ? <div className="semantic-empty"><Icon name="table" size={22} /><strong>还没有可扫描的数据表</strong><span>先导入 CSV 或 Excel，再生成语义草稿。</span></div> : tables.map((table) => <button type="button" className="semantic-table-row" key={table.name} onClick={() => onSelectTable(table.name)}><span className="semantic-table-icon"><Icon name="table" size={15} /></span><span className="semantic-table-copy"><strong>{table.name}</strong><span>{table.row_count.toLocaleString()} 行 · {table.draft_count} 个候选</span></span><span className={`semantic-status ${table.published ? "is-published" : ""}`}>{table.published ? "已发布" : "草稿"}</span><Icon name="chevronRight" size={15} /></button>)}</div>
  </section>;
}
