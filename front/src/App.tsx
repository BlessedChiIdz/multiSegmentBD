import { Alert, Box, Snackbar } from '@mui/material';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api/client';
import { ResizableSplit } from './components/ResizableSplit';
import { ResultsPanel } from './components/ResultsPanel';
import { SchemaExplorer } from './components/SchemaExplorer';
import { SegmentPanel } from './components/SegmentPanel';
import { SqlEditor } from './components/SqlEditor';
import { Toolbar } from './components/Toolbar';
import type {
  DatabaseSchema,
  SegmentInfo,
  SegmentQueryResult,
  StatusResponse,
  TableDef,
} from './types';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1565c0' },
    background: { default: '#f0f2f5', paper: '#ffffff' },
  },
  typography: {
    fontFamily: '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
});

const DEFAULT_SQL = 'SELECT 1 AS ok;';

function App() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [segments, setSegments] = useState<SegmentInfo[]>([]);
  const [schema, setSchema] = useState<DatabaseSchema | null>(null);
  const [schemaSource, setSchemaSource] = useState('');
  const [selectedSegments, setSelectedSegments] = useState<string[]>([]);
  const [stopOnFirstMatch, setStopOnFirstMatch] = useState(false);
  const [sql, setSql] = useState(DEFAULT_SQL);
  const [results, setResults] = useState<SegmentQueryResult[] | null>(null);
  const [connected, setConnected] = useState(false);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInitial = useCallback(async () => {
    try {
      const [st, segs, sch] = await Promise.all([
        api.getStatus(),
        api.getSegments(),
        api.getSchema(),
      ]);
      setStatus(st);
      setSegments(segs.segments);
      setSchema(sch.schema);
      setSchemaSource(sch.source);
      setConnected(true);
      setError(null);
    } catch (e) {
      setConnected(false);
      setError(e instanceof Error ? e.message : 'Failed to connect to API');
    }
  }, []);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  const reloadSchema = async () => {
    setSchemaLoading(true);
    try {
      const sch = await api.reloadSchema();
      setSchema(sch.schema);
      setSchemaSource(sch.source);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Schema reload failed');
    } finally {
      setSchemaLoading(false);
    }
  };

  const runQuery = useCallback(async () => {
    const trimmed = sql.trim();
    if (!trimmed) {
      setError('SQL is empty');
      return;
    }

    const segmentFilter =
      selectedSegments.length > 0 &&
      selectedSegments.length < segments.length
        ? selectedSegments
        : [];

    setRunning(true);
    setResults(null);
    try {
      const res = await api.executeQuery({
        sql: trimmed,
        segments: segmentFilter,
        stop_on_first_match: stopOnFirstMatch,
      });
      setResults(res.results);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Query failed');
    } finally {
      setRunning(false);
    }
  }, [sql, selectedSegments, segments.length, stopOnFirstMatch]);

  const insertColumn = (table: TableDef, columnName: string) => {
    const snippet = `${quoteIdent(table.name)}.${quoteIdent(columnName)}`;
    setSql((prev) => (prev.trim() ? `${prev}\n${snippet}` : snippet));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!running && connected) void runQuery();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [runQuery, running, connected]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <Toolbar
          status={status}
          connected={connected}
          running={running}
          onRun={runQuery}
        />

        {error && !connected && (
          <Alert severity="error" sx={{ mx: 2, mt: 1 }}>
            {error}. Start backend:{' '}
            <code>cargo run -p multiSectorBD --manifest-path back/Cargo.toml</code>
          </Alert>
        )}

        <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <ResizableSplit
            direction="horizontal"
            initialFirstSize={300}
            minFirstSize={200}
            maxFirstSize={720}
            storageKey="multiSegmentBD.sidebarWidth"
            first={
              <Box
                sx={{
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  bgcolor: 'background.paper',
                }}
              >
                <ResizableSplit
                  direction="vertical"
                  initialFirstSize={220}
                  minFirstSize={80}
                  maxFirstSize={2000}
                  storageKey="multiSegmentBD.segmentsHeight"
                  first={
                    <SegmentPanel
                      segments={segments}
                      selected={selectedSegments}
                      stopOnFirstMatch={stopOnFirstMatch}
                      onSelectedChange={setSelectedSegments}
                      onStopOnFirstMatchChange={setStopOnFirstMatch}
                    />
                  }
                  second={
                    <SchemaExplorer
                      schema={schema}
                      schemaSource={schemaSource}
                      loading={schemaLoading}
                      onReload={reloadSchema}
                      onSetSql={setSql}
                      onInsertColumn={insertColumn}
                    />
                  }
                />
              </Box>
            }
            second={
              <Box
                sx={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  minWidth: 0,
                  height: '100%',
                }}
              >
                <SqlEditor value={sql} onChange={setSql} />
                <Box sx={{ flex: 1, minHeight: 0, bgcolor: 'background.paper' }}>
                  <ResultsPanel results={results} running={running} />
                </Box>
              </Box>
            }
          />
        </Box>
      </Box>

      <Snackbar
        open={!!error && connected}
        autoHideDuration={6000}
        onClose={() => setError(null)}
        message={error}
      />
    </ThemeProvider>
  );
}

function quoteIdent(name: string): string {
  if (/^[a-z_][a-z0-9_]*$/i.test(name)) return name;
  return `"${name.replace(/"/g, '""')}"`;
}

export default App;
