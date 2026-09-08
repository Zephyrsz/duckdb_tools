import { Icon } from "./Icon";

type Props = {
  mode: "import" | "browse" | "query" | "semantic" | "semanticTable";
  onModeChange: (mode: Props["mode"]) => void;
  tableName: string | null;
  tableCount: number;
  onUpload: () => void;
  onToggleSidebar: () => void;
};

export function Topbar({ mode, onModeChange, tableName, tableCount, onUpload, onToggleSidebar }: Props) {
  return (
    <header className="topbar">
      <button className="mobile-menu" type="button" onClick={onToggleSidebar} aria-label="打开导航"><Icon name="openSidebar" size={18} /></button>
      <div className="breadcrumb"><span>{mode.startsWith("semantic") ? "语义层" : "工作区"}</span><Icon name="chevronRight" size={13} /><strong>{mode.startsWith("semantic") ? (tableName ?? "语义目录") : (tableName ?? "开始导入")}</strong></div>
      <div className="topbar-spacer" />
      <div className="database-health"><span className="status-dot" /> <span>已连接</span></div>
      <button type="button" className="upload-button" onClick={onUpload}><Icon name="upload" size={15} /> 上传文件</button>
    </header>
  );
}
