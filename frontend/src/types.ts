export type ColumnMeta = { name: string; type: string };

export type TableSummary = { name: string; row_count: number };

export type DatabaseInfo = { database: string; tables: TableSummary[] };

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
