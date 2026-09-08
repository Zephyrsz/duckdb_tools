import { Icon } from "./Icon";

type Props = {
  mode: "import" | "browse" | "query";
  onModeChange: (mode: Props["mode"]) => void;
  tableName: string | null;
  tableCount: number;
  onUpload: () => void;
  onToggleSidebar: () => void;
};

const tabs: { id: Props["mode"]; label: string; icon: "upload" | "table" | "play" }[] = [
  { id: "import", label: "导入数据", icon: "upload" },
  { id: "browse", label: "表浏览", icon: "table" },
  { id: "query", label: "SQL 查询", icon: "play" },
];

export function Topbar({ mode, onModeChange, tableName, tableCount, onUpload, onToggleSidebar }: Props) {
  return (
    <header className="topbar">
      <button className="mobile-menu" type="button" onClick={onToggleSidebar} aria-label="打开导航"><Icon name="openSidebar" size={18} /></button>
      <div className="breadcrumb"><span>工作区</span><Icon name="chevronRight" size={13} /><strong>{tableName ?? "开始导入"}</strong></div>
      <div className="topbar-spacer" />
      <div className="database-health"><span className="status-dot" /> <span>已连接</span></div>
      <button type="button" className="upload-button" onClick={onUpload}><Icon name="upload" size={15} /> 上传文件</button>
    </header>
  );
}
