import type {
  DatabaseInfo,
  ImportResult,
  PreviewPayload,
  QueryResult,
  TableInfo,
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

export function previewUpload(file: File): Promise<PreviewPayload> {
  const formData = new FormData();
  formData.append("file", file);
  return request<PreviewPayload>("/upload/preview", { method: "POST", body: formData });
}

export function importFile(payload: {
  stored_path: string;
  table_name: string;
  has_header: boolean;
}): Promise<ImportResult> {
  return request<ImportResult>("/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getTable(tableName: string): Promise<TableInfo> {
  return request<TableInfo>(`/tables/${encodeURIComponent(tableName)}`);
}

export function runQuery(sql: string): Promise<QueryResult> {
  return request<QueryResult>("/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql }),
  });
}
