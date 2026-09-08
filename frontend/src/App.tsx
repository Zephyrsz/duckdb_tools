import { useCallback, useEffect, useRef, useState } from "react";
import { getDatabase, getTable, importFile, previewUpload, runQuery } from "./api";
import type { DatabaseInfo, ImportResult, PreviewPayload, QueryResult, TableInfo } from "./types";
import { Icon } from "./components/Icon";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { ImportPanel } from "./components/ImportPanel";
import { TableBrowser } from "./components/TableBrowser";
import { SqlWorkspace } from "./components/SqlWorkspace";

type Mode = "import" | "browse" | "query";
type ImportStage = "select" | "preview" | "importing" | "complete";

const starterSql = "SELECT 1 AS sample_value";

function defaultTableName(filename: string) {
  return filename.replace(/\.(csv|xlsx|xls)$/i, "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^([^a-z_])/, "table_$1").replace(/_+/g, "_").replace(/^_+|_+$/g, "") || "imported_data";
}

export default function App() {
  const [mode, setMode] = useState<Mode>("import");
  const [database, setDatabase] = useState<DatabaseInfo>({ database: "workspace.duckdb", tables: [] });
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [table, setTable] = useState<TableInfo | null>(null);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableError, setTableError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importStage, setImportStage] = useState<ImportStage>("select");
  const [importBusy, setImportBusy] = useState(false);
  const [tableName, setTableName] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [sql, setSql] = useState(starterSql);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [queryBusy, setQueryBusy] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshDatabase = useCallback(async () => {
    try {
      setGlobalError(null);
      setDatabase(await getDatabase());
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : "无法连接数据服务");
    }
  }, []);

  useEffect(() => { void refreshDatabase(); }, [refreshDatabase]);

  const loadTable = useCallback(async (name: string) => {
    setActiveTable(name);
    setMode("browse");
    setSidebarOpen(false);
    setTableLoading(true);
    setTableError(null);
    try {
      const nextTable = await getTable(name);
      setTable(nextTable);
      setSql(`SELECT *\nFROM "${name}"\nLIMIT 100`);
    } catch (error) {
      setTableError(error instanceof Error ? error.message : "无法读取数据表");
    } finally {
      setTableLoading(false);
    }
  }, []);

  const beginPreview = async (file: File) => {
    setMode("import");
    setImportError(null);
    setImportResult(null);
    setImportStage("select");
    setImportBusy(true);
    try {
      const nextPreview = await previewUpload(file);
      setPreview(nextPreview);
      setTableName(defaultTableName(nextPreview.filename));
      setImportStage("preview");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "文件预览失败");
      setPreview(null);
    } finally {
      setImportBusy(false);
    }
  };

  const handleImport = async () => {
    if (!preview || !tableName.trim()) return;
    setImportError(null);
    setImportBusy(true);
    setImportStage("importing");
    try {
      const result = await importFile({ stored_path: preview.stored_path, table_name: tableName.trim(), has_header: true });
      setImportResult(result);
      setActiveTable(result.table_name);
      setImportStage("complete");
      await refreshDatabase();
      const nextTable = await getTable(result.table_name);
      setTable(nextTable);
      setSql(`SELECT *\nFROM "${result.table_name}"\nLIMIT 100`);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "导入失败");
      setImportStage("preview");
    } finally {
      setImportBusy(false);
    }
  };

  const executeQuery = async () => {
    if (!sql.trim()) return;
    setQueryBusy(true);
    setQueryError(null);
    try {
      setQueryResult(await runQuery(sql));
    } catch (error) {
      setQueryError(error instanceof Error ? error.message : "查询失败");
      setQueryResult(null);
    } finally {
      setQueryBusy(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && mode === "query") {
        event.preventDefault();
        void executeQuery();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const startUpload = () => {
    setMode("import");
    fileInputRef.current?.click();
  };

  return <div className="app-shell">
    <div className={`sidebar-backdrop ${sidebarOpen ? "is-visible" : ""}`} onClick={() => setSidebarOpen(false)} />
    <div className={`sidebar-wrap ${sidebarOpen ? "is-open" : ""}`}><Sidebar databaseName={database.database} tables={database.tables} activeTable={activeTable} mode={mode} onModeChange={(nextMode) => { setMode(nextMode); setSidebarOpen(false); }} onSelectTable={loadTable} onImport={startUpload} /></div>
    <main className="workspace">
      <Topbar mode={mode} onModeChange={setMode} tableName={activeTable} tableCount={database.tables.length} onUpload={startUpload} onToggleSidebar={() => setSidebarOpen((open) => !open)} />
      <input ref={fileInputRef} id="upload-input" type="file" accept=".csv,.xlsx" className="visually-hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void beginPreview(file); event.target.value = ""; }} />
      <div className="mode-tabs" role="tablist" aria-label="工作区视图">
        <button className={mode === "import" ? "is-active" : ""} onClick={() => setMode("import")} role="tab" aria-selected={mode === "import"}><Icon name="upload" size={14} /> 导入数据</button>
        <button className={mode === "browse" ? "is-active" : ""} onClick={() => setMode("browse")} role="tab" aria-selected={mode === "browse"}><Icon name="table" size={14} /> 表浏览</button>
        <button className={mode === "query" ? "is-active" : ""} onClick={() => setMode("query")} role="tab" aria-selected={mode === "query"}><Icon name="play" size={14} /> SQL 查询</button>
      </div>
      <div className="content-area">
        {globalError && <div className="connection-banner"><Icon name="alert" size={16} /><span>{globalError}</span><button type="button" onClick={() => void refreshDatabase()}><Icon name="refresh" size={14} /> 重试</button></div>}
        {mode === "import" && <ImportPanel stage={importStage} preview={preview} result={importResult} tableName={tableName} onTableNameChange={setTableName} onImport={() => void handleImport()} onChoose={startUpload} isBusy={importBusy} error={importError} />}
        {mode === "browse" && <TableBrowser table={table} isLoading={tableLoading} error={tableError} onQuery={() => setMode("query")} />}
        {mode === "query" && <SqlWorkspace sql={sql} onSqlChange={setSql} onRun={() => void executeQuery()} isLoading={queryBusy} result={queryResult} error={queryError} tablesCount={database.tables.length} />}
      </div>
      <footer className="workspace-footer"><span><span className="status-dot" /> AIBase 服务在线</span><span>远程工作区 · 数据保存在服务器</span></footer>
    </main>
  </div>;
}
