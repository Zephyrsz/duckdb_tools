import { Icon } from "./Icon";
import type { DuckDBStatus } from "../types";

type Props = {
  mode: "import" | "browse" | "query" | "semantic" | "semanticTable";
  onModeChange: (mode: Props["mode"]) => void;
  tableName: string | null;
  tableCount: number;
  onUpload: () => void;
  onToggleSidebar: () => void;
  duckdbStatus: DuckDBStatus;
  duckdbBusy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
};

export function Topbar({ mode, onModeChange, tableName, tableCount, onUpload, onToggleSidebar, duckdbStatus, duckdbBusy, onConnect, onDisconnect }: Props) {
  return (
    <header className="topbar">
      <button className="mobile-menu" type="button" onClick={onToggleSidebar} aria-label="打开导航"><Icon name="openSidebar" size={18} /></button>
      <div className="breadcrumb"><span>{mode.startsWith("semantic") ? "语义层" : "工作区"}</span><Icon name="chevronRight" size={13} /><strong>{mode.startsWith("semantic") ? (tableName ?? "语义目录") : (tableName ?? "开始导入")}</strong></div>
      <div className="topbar-spacer" />
      <div className={`database-health ${duckdbStatus.connected ? "is-connected" : "is-disconnected"}`} title={duckdbStatus.database}>
        <span className="status-dot" /> <span>{duckdbStatus.connected ? "已连接" : "未连接"}</span>
        {duckdbStatus.connected ? <button type="button" className="database-control" onClick={onDisconnect} disabled={duckdbBusy || duckdbStatus.active_operations > 0} title={duckdbStatus.active_operations > 0 ? `有 ${duckdbStatus.active_operations} 个操作正在运行` : "断开 DuckDB"}><Icon name="close" size={13} /> 断开</button> : <button type="button" className="database-control" onClick={onConnect} disabled={duckdbBusy} title="连接 DuckDB"><Icon name="plug" size={13} /> 连接</button>}
      </div>
      <button type="button" className="upload-button" onClick={onUpload}><Icon name="upload" size={15} /> 上传文件</button>
    </header>
  );
}
