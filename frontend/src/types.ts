export type ColumnMeta = { name: string; type: string };

export type TableSummary = { name: string; row_count: number };

export type DatabaseInfo = { database: string; tables: TableSummary[] };

export type DuckDBStatus = {
  connected: boolean;
  database: string;
  connected_at: string | null;
  active_operations: number;
  auto_connect: boolean;
};

export type PreviewPayload = {
  filename: string;
  stored_path: string;
  kind: "csv" | "excel";
  columns: ColumnMeta[];
  preview: Record<string, unknown>[];
};

export type ImportResult = {
  table_name: string;
  row_count: number;
  columns: ColumnMeta[];
};

export type TableInfo = {
  table_name: string;
  columns: ColumnMeta[];
  rows: Record<string, unknown>[];
  row_count: number;
};

export type QueryResult = {
  columns: ColumnMeta[];
  rows: Record<string, unknown>[];
  row_count: number;
  elapsed_ms: number;
};

export type SemanticDraft = {
  id: number;
  object_type: "table" | "column" | "entity" | "dimension" | "measure" | "metric" | "term";
  table_name: string;
  source_column?: string | null;
  canonical_name: string;
  display_name: string;
  description: string;
  expression?: string | null;
  metadata: Record<string, unknown>;
  status: "draft" | "approved" | "rejected";
  confidence: number;
  source: string;
  evidence: string;
};

export type SemanticSummary = {
  metadata_db: string;
  revision: number;
  draft_count: number;
  approved_count: number;
  published: Record<string, number>;
};

export type SemanticTableSummary = TableSummary & { draft_count: number; published: boolean };
export type SemanticColumn = ColumnMeta & { null_count: number; distinct_count: number; sample_values: unknown[]; row_count: number; description: string; is_primary_key?: boolean };
export type SemanticTable = { name: string; row_count: number; columns: SemanticColumn[]; drafts: SemanticDraft[] };
export type SemanticValidation = { valid: boolean; errors: string[]; warnings: string[]; counts: { drafts: number; approved: number } };
export type SemanticPublish = { revision: number; counts: Record<string, number> };
