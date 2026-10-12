import { useEffect, useState } from "react";
import type { SemanticColumn, SemanticColumnPatch, SemanticTable } from "../types";
import { Icon } from "./Icon";

type Props = {
  table: SemanticTable;
  isBusy: boolean;
  onSave: (columns: SemanticColumnPatch[]) => Promise<boolean>;
  onDirtyChange: (dirty: boolean) => void;
};

function editableValues(column: SemanticColumn): SemanticColumnPatch {
  return { name: column.name, display_name: column.display_name, description: column.description,
    is_primary_key: column.is_primary_key, status: column.status };
}

function isChanged(column: SemanticColumn, value: SemanticColumnPatch): boolean {
  return value.display_name !== column.display_name || value.description !== column.description
    || value.is_primary_key !== column.is_primary_key || value.status !== column.status;
}

function sampleLabel(value: unknown): string {
  if (value === null) return "NULL";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function FieldMetadataTable({ table, isBusy, onSave, onDirtyChange }: Props) {
  const [edits, setEdits] = useState(() => new Map<string, SemanticColumnPatch>());
  const [saved, setSaved] = useState(false);
  const changes = table.columns.flatMap((column) => {
    const value = edits.get(column.name);
    return value && isChanged(column, value) ? [value] : [];
  });
  const dirty = changes.length > 0;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  const update = (column: SemanticColumn, patch: Partial<SemanticColumnPatch>) => {
    setSaved(false);
    setEdits((current) => new Map(current).set(column.name, { ...(current.get(column.name) ?? editableValues(column)), ...patch }));
  };
  const save = async () => {
    if (!dirty || isBusy) return;
    if (await onSave(changes)) { setEdits(new Map()); setSaved(true); }
  };

  return <form className="field-metadata-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <div className="field-metadata-toolbar">
      <div><h2 id="field-metadata-title">字段元数据</h2><p>编辑业务名称、字段说明和主键标注，保存后可在语义目录中校验并发布。</p></div>
      <div className="field-metadata-actions">
        <span className="field-save-status" role="status">{isBusy ? "正在保存…" : dirty ? `${changes.length} 个字段未保存` : saved ? "字段标注已保存" : `${table.columns.length} 个字段`}</span>
        <button type="button" className="secondary-button" disabled={isBusy || !dirty} onClick={() => { setEdits(new Map()); setSaved(false); }}>撤销修改</button>
        <button type="submit" className="primary-button" disabled={isBusy || !dirty}><Icon name={isBusy ? "refresh" : "check"} size={14} className={isBusy ? "spin" : undefined} /> 保存字段标注</button>
      </div>
    </div>
    <div className="field-metadata-scroll" tabIndex={0} role="region" aria-labelledby="field-metadata-title">
      <table className="field-metadata-table">
        <caption className="visually-hidden">{table.name} 的字段元数据，可编辑业务名称、字段说明、主键标注和确认状态。</caption>
        <thead><tr><th scope="col">字段 / 类型</th><th scope="col">业务名称</th><th scope="col">字段说明</th><th scope="col">主键标注</th><th scope="col">确认状态</th><th scope="col">数据概况</th><th scope="col">样例值</th></tr></thead>
        <tbody>{table.columns.map((column) => {
          const value = edits.get(column.name) ?? editableValues(column);
          const modified = isChanged(column, value);
          return <tr key={column.name} className={modified ? "is-modified" : undefined}>
            <th scope="row"><strong>{column.name}</strong><span>{column.type}</span>{modified && <em>已修改</em>}</th>
            <td><input className="field-name-input" aria-label={`${column.name} 业务名称`} value={value.display_name} required pattern=".*\S.*" maxLength={160} disabled={isBusy} onChange={(event) => update(column, { display_name: event.target.value })} /></td>
            <td><textarea className="field-description-input" aria-label={`${column.name} 字段说明`} value={value.description} maxLength={500} rows={2} placeholder="填写字段的业务含义" disabled={isBusy} onChange={(event) => update(column, { description: event.target.value })} /></td>
            <td className="field-checkbox-cell"><input type="checkbox" aria-label={`${column.name} 主键标注`} checked={value.is_primary_key} disabled={isBusy} onChange={(event) => update(column, { is_primary_key: event.target.checked })} /></td>
            <td><select className="field-status-select" aria-label={`${column.name} 确认状态`} value={value.status} disabled={isBusy} onChange={(event) => update(column, { status: event.target.value as SemanticColumnPatch["status"] })}><option value="draft">待确认</option><option value="approved">已确认</option><option value="rejected">忽略标注</option></select></td>
            <td className="field-profile-cell"><span>{column.nullable ? "允许为空" : "不允许为空"}</span><span>{column.distinct_count.toLocaleString()} 个不同值</span><span>{column.null_count.toLocaleString()} 个空值</span></td>
            <td className="field-samples-cell"><span title={column.sample_values.map(sampleLabel).join("、")}>{column.sample_values.length ? column.sample_values.slice(0, 3).map(sampleLabel).join("、") : "暂无非空样例"}</span></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </form>;
}
