import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import {
  Alert,
  Box,
  Chip,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { useMemo, useState } from 'react';
import type { SegmentQueryResult } from '../types';

interface ResultsPanelProps {
  results: SegmentQueryResult[] | null;
  running: boolean;
}

type CellValue = string | number | boolean | null;

function normalizeCell(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatDisplay(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return String(value);
}

function inferColumnType(values: unknown[]): 'number' | 'boolean' | 'string' {
  const nonNull = values.filter((v) => v !== null && v !== undefined);
  if (nonNull.length === 0) return 'string';

  if (nonNull.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    return 'number';
  }
  if (nonNull.every((v) => typeof v === 'boolean')) {
    return 'boolean';
  }

  // Numeric strings (e.g. from legacy responses)
  if (
    nonNull.every(
      (v) =>
        typeof v === 'string' &&
        v.trim() !== '' &&
        !Number.isNaN(Number(v)) &&
        Number.isFinite(Number(v)),
    )
  ) {
    return 'number';
  }

  return 'string';
}

function coerceCell(
  value: unknown,
  kind: 'number' | 'boolean' | 'string',
): CellValue {
  if (value === null || value === undefined) return null;
  if (kind === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
  }
  if (kind === 'boolean' && typeof value === 'boolean') return value;
  return normalizeCell(value);
}

function buildRows(columns: string[], rows: unknown[][]) {
  const columnKinds = columns.map((_, j) =>
    inferColumnType(rows.map((row) => row[j])),
  );

  return rows.map((row, i) => {
    const record: Record<string, CellValue> & { id: number } = { id: i };
    columns.forEach((col, j) => {
      record[col] = coerceCell(row[j], columnKinds[j]);
    });
    return record;
  });
}

function buildGridColumns(
  columns: string[],
  rows: unknown[][],
): GridColDef[] {
  return columns.map((field, colIndex) => {
    const sampleValues = rows.map((row) => row[colIndex]);
    const kind = inferColumnType(sampleValues);

    const col: GridColDef = {
      field,
      headerName: field,
      flex: 1,
      minWidth: 100,
      valueFormatter: (value) => formatDisplay(value),
      sortable: true,
    };

    if (kind === 'number') {
      col.type = 'number';
      col.align = 'right';
      col.headerAlign = 'right';
    } else if (kind === 'boolean') {
      col.type = 'boolean';
    }

    return col;
  });
}

function SegmentResultGrid({ result }: { result: SegmentQueryResult }) {
  const columns = result.columns ?? [];
  const rows = result.rows ?? [];

  const gridCols = useMemo(
    () => buildGridColumns(columns, rows),
    [columns, rows],
  );

  const gridRows = useMemo(
    () => buildRows(columns, rows),
    [columns, rows],
  );

  if (!result.ok) {
    return (
      <Alert severity="error" icon={<ErrorOutlineIcon />}>
        {result.error ?? 'Unknown error'}
      </Alert>
    );
  }

  const meta =
    result.rows_affected != null && result.row_count === 0
      ? `${result.rows_affected} row(s) affected`
      : `${result.row_count ?? rows.length} row(s)`;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }}>
        {meta}
      </Typography>
      {gridRows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Empty result set
        </Typography>
      ) : (
        <DataGrid
          rows={gridRows}
          columns={gridCols}
          density="compact"
          disableRowSelectionOnClick
          pageSizeOptions={[25, 50, 100]}
          initialState={{
            pagination: { paginationModel: { pageSize: 25 } },
          }}
          sx={{
            flex: 1,
            border: 1,
            borderColor: 'divider',
            '& .MuiDataGrid-cell': {
              fontFamily: 'monospace',
              fontSize: 12,
            },
          }}
        />
      )}
    </Box>
  );
}

export function ResultsPanel({ results, running }: ResultsPanelProps) {
  const [tab, setTab] = useState(0);

  if (running) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography color="text.secondary">Running query…</Typography>
      </Box>
    );
  }

  if (!results || results.length === 0) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography color="text.secondary">
          Execute a query to see results per segment
        </Typography>
      </Box>
    );
  }

  const safeTab = Math.min(tab, results.length - 1);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Tabs
        value={safeTab}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ minHeight: 40, borderBottom: 1, borderColor: 'divider' }}
      >
        {results.map((r) => (
          <Tab
            key={r.segment}
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {r.segment}
                <Chip
                  size="small"
                  label={r.ok ? 'OK' : 'ERR'}
                  color={r.ok ? 'success' : 'error'}
                  sx={{ height: 18, fontSize: 10 }}
                />
              </Box>
            }
          />
        ))}
      </Tabs>
      <Box sx={{ flex: 1, p: 1.5, minHeight: 0 }}>
        <SegmentResultGrid result={results[safeTab]} />
      </Box>
    </Box>
  );
}
