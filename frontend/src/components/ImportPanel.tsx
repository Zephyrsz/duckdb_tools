import { useMemo } from "react";
import type { ImportResult, PreviewPayload } from "../types";
import { Icon } from "./Icon";
import { DataGrid } from "./DataGrid";

type Stage = "select" | "preview" | "importing" | "complete";
type Props = {
  stage: Stage;
  preview: PreviewPayload | null;
  result: ImportResult | null;
  tableName: string;
  onTableNameChange: (value: string) => void;
  onImport: () => void;
  onChoose: () => void;
  isBusy: boolean;
  error: string | null;
};

const stages: { id: Stage; number: string; label: string }[] = [
  { id: "select", number: "01", label: "选择文件" },
  { id: "preview", number: "02", label: "检查预览" },
  { id: "importing", number: "03", label: "写入数据" },
  { id: "complete", number: "04", label: "完成" },
];

export function ImportPanel({ stage, preview, result, tableName, onTableNameChange, onImport, onChoose, isBusy, error }: Props) {
  const activeIndex = stages.findIndex((item) => item.id === stage);
  const fileLabel = useMemo(() => preview?.filename ?? "CSV 或 Excel 文件", [preview]);
  return (
    <section className="surface-panel import-panel" aria-labelledby="import-title">
      <div className="panel-heading import-heading">
        <div>
          <div className="section-kicker">导入流程</div>
          <h1 id="import-title">把文件变成可查询的数据表</h1>
          <p className="panel-subtitle">上传带表头的 CSV 或 Excel，先检查字段，再写入当前 DuckDB 数据集。</p>
        </div>
        <div className="import-mark"><Icon name="arrowUpRight" size={22} /></div>
      </div>

      <div className="stage-rail" aria-label="导入阶段">
        {stages.map((item, index) => {
          const completed = index < activeIndex || stage === "complete";
          const current = item.id === stage;
          return <div className={`stage-step ${completed ? "is-complete" : ""} ${current ? "is-current" : ""}`} key={item.id}>
            <span className="stage-number">{completed ? <Icon name="check" size={13} strokeWidth={2.5} /> : item.number}</span>
            <span>{item.label}</span>
            {index < stages.length - 1 && <span className="stage-line" />}
          </div>;
        })}
      </div>

      {!preview && stage === "select" ? (
        <button type="button" className="drop-zone" onClick={onChoose}>
          <span className="drop-icon"><Icon name="upload" size={23} /></span>
          <span className="drop-title">选择一个文件开始</span>
          <span className="drop-note">支持 CSV、XLSX，单个文件不超过 50 MB</span>
          <span className="drop-action">浏览文件 <Icon name="arrowUpRight" size={14} /></span>
        </button>
      ) : (
        <div className="import-body">
          <div className="file-summary">
            <div className="file-icon"><Icon name={preview?.kind === "excel" ? "excel" : "file"} size={18} /></div>
            <div className="file-copy"><strong>{fileLabel}</strong><span>{preview?.kind === "excel" ? "Excel 工作表" : "CSV 文件"} · 已识别 {preview?.columns.length ?? 0} 个字段</span></div>
            {stage !== "importing" && stage !== "complete" && <button type="button" className="icon-button" onClick={onChoose} aria-label="重新选择文件" title="重新选择文件"><Icon name="refresh" size={16} /></button>}
          </div>

          {preview && stage !== "complete" && <>
            <div className="import-options">
              <label className="field-label" htmlFor="table-name">目标表名<span>必填</span></label>
              <div className="table-name-input"><span className="input-prefix">db /</span><input id="table-name" value={tableName} onChange={(event) => onTableNameChange(event.target.value)} disabled={isBusy} /><span className="input-suffix">table</span></div>
              <p className="field-help">将作为 DuckDB 中的数据表名称，支持字母、数字和下划线。</p>
            </div>
            <div className="preview-head"><div><span className="field-label">前 5 行预览</span><span className="preview-caption">字段类型已自动推断</span></div><span className="header-chip"><Icon name="check" size={12} /> 首行为表头</span></div>
            <DataGrid columns={preview.columns} rows={preview.preview} />
            <div className="import-actions"><button type="button" className="primary-button" disabled={isBusy || !tableName.trim()} onClick={onImport}>{isBusy ? <><Icon name="refresh" size={15} className="spin" /> 正在写入…</> : <>确认并导入 <Icon name="arrowUpRight" size={15} /></>}</button><span className="action-note">导入后可在左侧数据表中查看</span></div>
          </>}

          {stage === "complete" && result && <div className="complete-state"><div className="complete-icon"><Icon name="check" size={24} /></div><div><div className="complete-title">数据表已准备好</div><p>已将 {result.row_count.toLocaleString()} 行写入 <strong>{result.table_name}</strong>，现在可以浏览数据或运行 SQL。</p></div></div>}
        </div>
      )}
      {error && <div className="error-banner"><Icon name="alert" size={16} /><span>{error}</span></div>}
    </section>
  );
}
