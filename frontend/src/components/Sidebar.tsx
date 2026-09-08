import type { TableSummary } from "../types";
import { Icon } from "./Icon";

export type WorkspaceMode = "import" | "browse" | "query" | "semantic" | "semanticTable";

type Props = {
  databaseName: string;
  tables: TableSummary[];
  activeTable: string | null;
  mode: WorkspaceMode;
  onModeChange: (mode: WorkspaceMode) => void;
  onSelectTable: (name: string) => void;
  onImport: () => void;
};

type ModuleItem = {
  id: string;
  label: string;
  icon: "scan" | "catalog" | "dataset" | "annotation" | "history" | "agent" | "lineage" | "upload" | "table" | "play";
  mode?: WorkspaceMode;
  status?: string;
};

const workspaceModules: ModuleItem[] = [
  { id: "import", label: "数据导入", icon: "upload", mode: "import" },
  { id: "browse", label: "数据浏览", icon: "table", mode: "browse" },
  { id: "query", label: "SQL 查询", icon: "play", mode: "query" },
];

const semanticModules: ModuleItem[] = [
  { id: "catalog", label: "语义目录", icon: "catalog", mode: "semantic" },
  { id: "annotation", label: "字段标注", icon: "annotation", mode: "semanticTable" },
];

const exchangeModules: ModuleItem[] = [
  { id: "agent", label: "Agent 工具", icon: "agent", status: "规划中" },
  { id: "lineage", label: "OpenLineage", icon: "lineage", status: "规划中" },
];

function ModuleNav({ label, items, mode, onModeChange }: { label: string; items: ModuleItem[]; mode: WorkspaceMode; onModeChange: (mode: WorkspaceMode) => void }) {
  return (
    <section className="module-group" aria-label={label}>
      <div className="module-heading">{label}</div>
      <nav className="module-list">
        {items.map((item) => {
          const isActive = item.mode === mode;
          const isDisabled = !item.mode;
          return (
            <button
              key={item.id}
              type="button"
              className={`module-nav-item ${isActive ? "is-active" : ""} ${isDisabled ? "is-disabled" : ""}`}
              onClick={() => item.mode && onModeChange(item.mode)}
              disabled={isDisabled}
              aria-current={isActive ? "page" : undefined}
              title={isDisabled ? `${item.label}：${item.status}` : undefined}
            >
              <Icon name={item.icon} size={15} />
              <span>{item.label}</span>
              {item.status && <em>{item.status}</em>}
            </button>
          );
        })}
      </nav>
    </section>
  );
}

export function Sidebar({ databaseName, tables, activeTable, mode, onModeChange, onSelectTable, onImport }: Props) {
  return (
    <aside className="sidebar">
      <div className="brand-lockup">
        <div className="brand-mark"><Icon name="database" size={18} /></div>
        <div>
          <div className="brand-name">AIBase</div>
          <div className="brand-caption">数据工作台</div>
        </div>
      </div>

      <div className="sidebar-rule" />
      <div className="module-nav">
        <ModuleNav label="工作区" items={workspaceModules} mode={mode} onModeChange={onModeChange} />
        <ModuleNav label="语义层" items={semanticModules} mode={mode} onModeChange={onModeChange} />
        <ModuleNav label="连接与交换" items={exchangeModules} mode={mode} onModeChange={onModeChange} />
      </div>
      <div className="dataset-tile">
        <div className="dataset-icon"><Icon name="drive" size={16} /></div>
        <div className="dataset-copy">
          <strong>{databaseName}</strong>
          <span>本地 DuckDB 数据集</span>
        </div>
        <span className="status-dot" title="连接正常" />
      </div>

      <div className="table-heading">
        <span>数据表</span>
        <span className="table-count">{tables.length}</span>
      </div>
      <div className="table-list" aria-label="数据表列表">
        {tables.length === 0 ? (
          <div className="sidebar-empty">
            <span>还没有数据表</span>
            <button className="text-button" onClick={onImport}>上传第一份数据 <Icon name="arrowUpRight" size={13} /></button>
          </div>
        ) : (
          tables.map((table) => (
            <button
              type="button"
              className={`table-nav-item ${activeTable === table.name ? "is-active" : ""}`}
              key={table.name}
              onClick={() => onSelectTable(table.name)}
            >
              <Icon name="table" size={15} />
              <span className="table-nav-name">{table.name}</span>
              <span className="row-badge">{table.row_count.toLocaleString()}</span>
            </button>
          ))
        )}
      </div>

      <div className="sidebar-bottom">
        <div className="sidebar-tip"><Icon name="help" size={15} /><span>上传 CSV 或 Excel，自动创建数据表</span></div>
        <button type="button" className="sidebar-import" onClick={onImport}><Icon name="upload" size={15} /> 导入数据</button>
      </div>
    </aside>
  );
}
