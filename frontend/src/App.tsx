import { useCallback, useEffect, useRef, useState } from "react";
import { connectDuckDB, disconnectDuckDB, getDatabase, getDatabaseSchemas, getDuckDBStatus, getSemanticSummary, getSemanticTable, getSemanticTables, getTable, importFile, previewUpload, publishSemantic, runQuery, scanSemantic, updateSemanticDraft, validateSemantic } from "./api";
import type { DatabaseInfo, DuckDBStatus, ImportResult, PreviewPayload, QueryResult, SemanticDraft, SemanticSummary, SemanticTable, SemanticTableSummary, SemanticValidation, TableInfo } from "./types";
import { Icon } from "./components/Icon";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { ImportPanel } from "./components/ImportPanel";
import { TableBrowser } from "./components/TableBrowser";
import { SqlWorkspace } from "./components/SqlWorkspace";
import { SemanticOverview } from "./components/SemanticOverview";
import { SemanticTableDetail } from "./components/SemanticTableDetail";

type Mode = "import" | "browse" | "query" | "semantic" | "semanticTable";
type ImportStage = "select" | "preview" | "importing" | "complete";

const starterSql = "SELECT 1 AS sample_value";
const DEFAULT_DATABASE_NAME = "db";

function defaultTableName(filename: string) {
  return filename.replace(/\.(csv|xlsx|xls)$/i, "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^([^a-z_])/, "table_$1").replace(/_+/g, "_").replace(/^_+|_+$/g, "") || "imported_data";
}

function sqlTableReference(tableRef: string) {
  return tableRef.split(".").map((part) => `"${part.replace(/"/g, '""')}"`).join(".");
}

export default function App() {
  const [mode, setMode] = useState<Mode>("import");
  const [database, setDatabase] = useState<DatabaseInfo>({ database: "workspace.duckdb", databases: [], tables: [] });
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [table, setTable] = useState<TableInfo | null>(null);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableError, setTableError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importStage, setImportStage] = useState<ImportStage>("select");
  const [importBusy, setImportBusy] = useState(false);
  const [tableName, setTableName] = useState("");
  const [databaseName, setDatabaseName] = useState(DEFAULT_DATABASE_NAME);
  const [databaseSchemas, setDatabaseSchemas] = useState<string[]>([DEFAULT_DATABASE_NAME]);
  const [importError, setImportError] = useState<string | null>(null);
  const [sql, setSql] = useState(starterSql);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [queryBusy, setQueryBusy] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [duckdbStatus, setDuckdbStatus] = useState<DuckDBStatus>({ connected: false, database: "workspace.duckdb", connected_at: null, active_operations: 0, auto_connect: true });
  const [duckdbBusy, setDuckdbBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [semanticSummary, setSemanticSummary] = useState<SemanticSummary | null>(null);
  const [semanticTables, setSemanticTables] = useState<SemanticTableSummary[]>([]);
  const [semanticTable, setSemanticTable] = useState<SemanticTable | null>(null);
  const [semanticValidation, setSemanticValidation] = useState<SemanticValidation | null>(null);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [semanticBusy, setSemanticBusy] = useState(false);
  const [semanticError, setSemanticError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshDatabase = useCallback(async () => {
    try {
      setGlobalError(null);
      const [nextDatabase, nextStatus, nextSchemas] = await Promise.all([getDatabase(), getDuckDBStatus(), getDatabaseSchemas()]);
      setDatabase(nextDatabase);
      setDuckdbStatus(nextStatus);
      setDatabaseSchemas(nextSchemas);
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : "无法连接数据服务");
      try { setDuckdbStatus(await getDuckDBStatus()); } catch { /* backend unavailable */ }
    }
  }, []);

  useEffect(() => { void refreshDatabase(); }, [refreshDatabase]);

  useEffect(() => {
    const timer = window.setInterval(() => { void getDuckDBStatus().then(setDuckdbStatus).catch(() => undefined); }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  const handleDuckDBConnection = async (action: "connect" | "disconnect") => {
    setDuckdbBusy(true);
    setGlobalError(null);
    try {
      const nextStatus = action === "connect" ? await connectDuckDB() : await disconnectDuckDB();
      setDuckdbStatus(nextStatus);
      if (nextStatus.connected) await refreshDatabase();
      else setDatabase((current) => ({ ...current, databases: [], tables: [] }));
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : "DuckDB 连接操作失败");
      try { setDuckdbStatus(await getDuckDBStatus()); } catch { /* backend unavailable */ }
    } finally { setDuckdbBusy(false); }
  };

  const refreshSemantic = useCallback(async () => {
    setSemanticLoading(true);
    setSemanticError(null);
    try {
      const [summary, tables] = await Promise.all([getSemanticSummary(), getSemanticTables()]);
      setSemanticSummary(summary);
      setSemanticTables(tables);
    } catch (error) {
      setSemanticError(error instanceof Error ? error.message : "无法读取语义层");
    } finally { setSemanticLoading(false); }
  }, []);

  useEffect(() => { if (mode === "semantic" || mode === "semanticTable") void refreshSemantic(); }, [mode, refreshSemantic]);

  const loadSemanticTable = async (name: string) => {
    setSemanticBusy(true); setSemanticError(null);
    try { setSemanticTable(await getSemanticTable(name)); setMode("semanticTable"); setSidebarOpen(false); }
    catch (error) { setSemanticError(error instanceof Error ? error.message : "无法读取字段语义"); }
    finally { setSemanticBusy(false); }
  };

  const handleScan = async () => {
    setSemanticBusy(true); setSemanticError(null); setSemanticValidation(null);
    try { await scanSemantic(); await refreshSemantic(); }
    catch (error) { setSemanticError(error instanceof Error ? error.message : "语义扫描失败"); }
    finally { setSemanticBusy(false); }
  };

  const handleValidate = async () => {
    setSemanticBusy(true); setSemanticError(null);
    try { setSemanticValidation(await validateSemantic()); }
    catch (error) { setSemanticError(error instanceof Error ? error.message : "语义校验失败"); }
    finally { setSemanticBusy(false); }
  };

  const handlePublish = async () => {
    setSemanticBusy(true); setSemanticError(null);
    try { await publishSemantic(); await refreshSemantic(); setSemanticValidation(await validateSemantic()); }
    catch (error) { setSemanticError(error instanceof Error ? error.message : "metadata 发布失败"); }
    finally { setSemanticBusy(false); }
  };

  const handleDraftUpdate = async (draft: SemanticDraft, patch: Partial<SemanticDraft>) => {
    setSemanticBusy(true); setSemanticError(null);
    try { await updateSemanticDraft(draft.id, patch); setSemanticTable(await getSemanticTable(draft.table_name)); setSemanticValidation(null); await refreshSemantic(); }
    catch (error) { setSemanticError(error instanceof Error ? error.message : "草稿保存失败"); }
    finally { setSemanticBusy(false); }
  };

  const loadTable = useCallback(async (tableRef: string) => {
    setActiveTable(tableRef);
    setMode("browse");
    setSidebarOpen(false);
    setTableLoading(true);
    setTableError(null);
    try {
      const nextTable = await getTable(tableRef);
      setTable(nextTable);
      setSql(`SELECT *\nFROM ${sqlTableReference(tableRef)}\nLIMIT 100`);
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
      const result = await importFile({ stored_path: preview.stored_path, database_name: databaseName.trim(), table_name: tableName.trim(), has_header: true });
      setImportResult(result);
      setActiveTable(result.table_ref);
      setImportStage("complete");
      await refreshDatabase();
      const nextTable = await getTable(result.table_ref);
      setTable(nextTable);
      setSql(`SELECT *\nFROM ${sqlTableReference(result.table_ref)}\nLIMIT 100`);
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
    <div className={`sidebar-wrap ${sidebarOpen ? "is-open" : ""}`}><Sidebar databaseName={database.database} databases={database.databases} tables={database.tables} activeTable={activeTable} mode={mode} onModeChange={(nextMode) => { setMode(nextMode); setSidebarOpen(false); }} onSelectTable={loadTable} onImport={startUpload} duckdbStatus={duckdbStatus} duckdbBusy={duckdbBusy} onConnect={() => void handleDuckDBConnection("connect")} onDisconnect={() => void handleDuckDBConnection("disconnect")} /></div>
    <main className="workspace">
      <Topbar mode={mode} onModeChange={setMode} tableName={activeTable} tableCount={database.tables.length} onUpload={startUpload} onToggleSidebar={() => setSidebarOpen((open) => !open)} />
      <input ref={fileInputRef} id="upload-input" type="file" accept=".csv,.xlsx" className="visually-hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void beginPreview(file); event.target.value = ""; }} />
      {!mode.startsWith("semantic") && <div className="mode-tabs" role="tablist" aria-label="工作区视图">
        <button className={mode === "import" ? "is-active" : ""} onClick={() => setMode("import")} role="tab" aria-selected={mode === "import"}><Icon name="upload" size={14} /> 导入数据</button>
        <button className={mode === "browse" ? "is-active" : ""} onClick={() => setMode("browse")} role="tab" aria-selected={mode === "browse"}><Icon name="table" size={14} /> 表浏览</button>
        <button className={mode === "query" ? "is-active" : ""} onClick={() => setMode("query")} role="tab" aria-selected={mode === "query"}><Icon name="play" size={14} /> SQL 查询</button>
      </div>}
      <div className="content-area">
        {globalError && <div className="connection-banner"><Icon name="alert" size={16} /><span>{globalError}</span><button type="button" onClick={() => void refreshDatabase()}><Icon name="refresh" size={14} /> 重试</button></div>}
        {mode === "import" && <ImportPanel stage={importStage} preview={preview} result={importResult} databaseName={databaseName} databaseOptions={databaseSchemas} onDatabaseNameChange={setDatabaseName} tableName={tableName} onTableNameChange={setTableName} onImport={() => void handleImport()} onChoose={startUpload} isBusy={importBusy} error={importError} />}
        {mode === "browse" && <TableBrowser table={table} isLoading={tableLoading} error={tableError} onQuery={() => setMode("query")} />}
        {mode === "query" && <SqlWorkspace sql={sql} onSqlChange={setSql} onRun={() => void executeQuery()} isLoading={queryBusy} result={queryResult} error={queryError} tablesCount={database.tables.length} />}
        {mode === "semantic" && <SemanticOverview summary={semanticSummary} tables={semanticTables} validation={semanticValidation} isLoading={semanticLoading} isBusy={semanticBusy} error={semanticError} onScan={() => void handleScan()} onValidate={() => void handleValidate()} onPublish={() => void handlePublish()} onSelectTable={(name) => void loadSemanticTable(name)} />}
        {mode === "semanticTable" && (semanticTable ? <SemanticTableDetail table={semanticTable} isBusy={semanticBusy} error={semanticError} onBack={() => setMode("semantic")} onUpdate={handleDraftUpdate} /> : <section className="surface-panel state-panel"><div className="state-icon"><Icon name="annotation" size={22} /></div><h2>选择一张数据表</h2><p>先进入语义目录并扫描数据，再选择表配置字段语义。</p><button type="button" className="primary-button state-action" onClick={() => setMode("semantic")}>打开语义目录</button></section>)}
      </div>
      <footer className="workspace-footer"><span><span className="status-dot" /> AIBase 服务在线</span><span>远程工作区 · 数据保存在服务器</span></footer>
    </main>
  </div>;
}
