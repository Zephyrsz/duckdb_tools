import { useEffect, useState } from "react";
import type { DatabaseSummary, DuckDBStatus, TableSummary } from "../types";
import { Icon } from "./Icon";

export type WorkspaceMode = "import" | "browse" | "query" | "semantic" | "semanticTable";

type Props = {
  databaseName: string;
  databases: DatabaseSummary[];
  tables: TableSummary[];
  activeTable: string | null;
  mode: WorkspaceMode;
  onModeChange: (mode: WorkspaceMode) => void;
  onSelectTable: (name: string) => void;
  onImport: () => void;
  duckdbStatus: DuckDBStatus;
  duckdbBusy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
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

export function Sidebar({ databaseName, databases, tables, activeTable, mode, onModeChange, onSelectTable, onImport, duckdbStatus, duckdbBusy, onConnect, onDisconnect }: Props) {
  const [selectedDatabase, setSelectedDatabase] = useState<string | null>(null);
  useEffect(() => {
    if (!duckdbStatus.connected || (selectedDatabase && !databases.some((database) => database.name === selectedDatabase))) {
      setSelectedDatabase(null);
    }
  }, [databases, duckdbStatus.connected, selectedDatabase]);
  const visibleTables = selectedDatabase ? tables.filter((table) => table.database_name === selectedDatabase) : [];

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
        <div className="dataset-actions">
          <span className={`status-dot ${duckdbStatus.connected ? "" : "is-disconnected"}`} title={duckdbStatus.connected ? "连接正常" : "未连接 DuckDB"} />
          {duckdbStatus.connected ? <button type="button" className="dataset-control" onClick={onDisconnect} disabled={duckdbBusy || duckdbStatus.active_operations > 0} title={duckdbStatus.active_operations > 0 ? `有 ${duckdbStatus.active_operations} 个操作正在运行` : "断开 DuckDB"}><Icon name="close" size={13} /></button> : <button type="button" className="dataset-control" onClick={onConnect} disabled={duckdbBusy} title="连接 DuckDB"><Icon name="plug" size={13} /></button>}
        </div>
      </div>

      <div className="table-heading">
        {selectedDatabase ? <button type="button" className="sidebar-back" onClick={() => setSelectedDatabase(null)}><Icon name="chevronLeft" size={13} /> 数据浏览</button> : <span>数据浏览</span>}
        <span className="table-count">{selectedDatabase ? visibleTables.length : databases.length}</span>
      </div>
      <div className="table-list" aria-label={selectedDatabase ? "数据表列表" : "数据库列表"}>
        {!duckdbStatus.connected ? (
          <div className="sidebar-empty"><span>请先连接 DuckDB</span></div>
        ) : selectedDatabase ? (
          visibleTables.length === 0 ? (
            <div className="sidebar-empty"><span>这个数据库还没有数据表</span><button className="text-button" onClick={onImport}>导入数据 <Icon name="arrowUpRight" size={13} /></button></div>
          ) : visibleTables.map((table) => (
            <button type="button" className={`table-nav-item ${activeTable === (table.table_ref ?? table.name) ? "is-active" : ""}`} key={table.table_ref ?? table.name} onClick={() => onSelectTable(table.table_ref ?? table.name)}>
              <Icon name="table" size={15} /><span className="table-nav-name">{table.name}</span><span className="row-badge">{table.row_count.toLocaleString()}</span>
            </button>
          ))
        ) : databases.length === 0 ? (
          <div className="sidebar-empty"><span>还没有数据库</span><button className="text-button" onClick={onImport}>上传第一份数据 <Icon name="arrowUpRight" size={13} /></button></div>
        ) : databases.map((database) => (
          <button type="button" className="table-nav-item database-nav-item" key={database.name} onClick={() => setSelectedDatabase(database.name)}>
            <Icon name="database" size={15} /><span className="table-nav-name">{database.name}</span><span className="row-badge">{database.table_count} 表</span><Icon name="chevronRight" size={13} />
          </button>
        ))}
      </div>

      <div className="sidebar-bottom">
        <div className="sidebar-tip"><Icon name="help" size={15} /><span>上传 CSV 或 Excel，自动创建数据表</span></div>
        <button type="button" className="sidebar-import" onClick={onImport}><Icon name="upload" size={15} /> 导入数据</button>
      </div>
    </aside>
  );
}
