export interface ColumnDef {
  name: string;
  data_type: string;
  char_max_len: number | null;
  is_nullable: boolean;
  is_primary_key: boolean;
}

export interface TableDef {
  name: string;
  columns: ColumnDef[];
}

export interface DatabaseSchema {
  tables: TableDef[];
}

export interface SchemaResponse {
  source: string;
  schema: DatabaseSchema;
}

export interface StatusResponse {
  config_path: string;
  connect_timeout_secs: number;
  max_concurrent_segments: number;
  schema_source: string;
  table_count: number;
}

export interface SegmentInfo {
  name: string;
  host: string;
  port: number;
  database: string;
  user: string;
}

export interface SegmentsResponse {
  segments: SegmentInfo[];
}

export interface QueryRequest {
  sql: string;
  segments: string[];
  stop_on_first_match: boolean;
}

export interface SegmentQueryResult {
  segment: string;
  ok: boolean;
  columns?: string[];
  row_count?: number;
  rows_affected?: number | null;
  rows?: unknown[][];
  error?: string;
}

export interface QueryResponse {
  results: SegmentQueryResult[];
}
