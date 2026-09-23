import type {
  DatabaseInfo,
  DatabaseSchema,
  ImportResult,
  PreviewPayload,
  QueryResult,
  TableInfo,
  SemanticDraft,
  SemanticPublish,
  SemanticSummary,
  SemanticTable,
  SemanticTableSummary,
  SemanticValidation,
  DuckDBStatus,
} from "./types";

const API_ROOT = (import.meta.env.VITE_API_URL ?? "/api").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.detail ?? `请求失败（${response.status}）`);
  }
  return body as T;
}

export function getDatabase(): Promise<DatabaseInfo> {
  return request<DatabaseInfo>("/database");
}

export function getDatabaseSchemas(): Promise<DatabaseSchema[]> {
  return request<DatabaseSchema[]>("/database/schemas");
}

export function getDuckDBStatus(): Promise<DuckDBStatus> {
  return request<DuckDBStatus>("/duckdb/status");
}

export function connectDuckDB(): Promise<DuckDBStatus> {
  return request<DuckDBStatus>("/duckdb/connect", { method: "POST" });
}

export function disconnectDuckDB(): Promise<DuckDBStatus> {
  return request<DuckDBStatus>("/duckdb/disconnect", { method: "POST" });
}

export function previewUpload(file: File): Promise<PreviewPayload> {
  const formData = new FormData();
  formData.append("file", file);
  return request<PreviewPayload>("/upload/preview", { method: "POST", body: formData });
}

export function importFile(payload: {
  stored_path: string;
  database_name: string;
  table_name: string;
  has_header: boolean;
}): Promise<ImportResult> {
  return request<ImportResult>("/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getTable(tableRef: string): Promise<TableInfo> {
  return request<TableInfo>(`/tables/${encodeURIComponent(tableRef)}`);
}

export function runQuery(sql: string): Promise<QueryResult> {
  return request<QueryResult>("/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql }),
  });
}

export function getSemanticSummary(): Promise<SemanticSummary> {
  return request<SemanticSummary>("/semantic/summary");
}

export function getSemanticTables(): Promise<SemanticTableSummary[]> {
  return request<SemanticTableSummary[]>("/semantic/tables");
}

export function getSemanticTable(tableName: string): Promise<SemanticTable> {
  return request<SemanticTable>(`/semantic/tables/${encodeURIComponent(tableName)}`);
}

export function scanSemantic(): Promise<{ table_count: number; draft_count: number; drafts: SemanticDraft[] }> {
  return request("/semantic/scan", { method: "POST" });
}

export function updateSemanticDraft(id: number, patch: Partial<Pick<SemanticDraft, "canonical_name" | "display_name" | "description" | "expression" | "status" | "confidence">>): Promise<SemanticDraft> {
  return request<SemanticDraft>(`/semantic/drafts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export function validateSemantic(): Promise<SemanticValidation> {
  return request<SemanticValidation>("/semantic/validate", { method: "POST" });
}

export function publishSemantic(): Promise<SemanticPublish> {
  return request<SemanticPublish>("/semantic/publish", { method: "POST" });
}
