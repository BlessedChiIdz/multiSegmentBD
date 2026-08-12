import { Alert, Box, Snackbar, Typography } from '@mui/material';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api/client';
import { ConnectionsPanel } from './components/ConnectionsPanel';
import { ConnectionSettingsDialog } from './components/ConnectionSettingsDialog';
import {
  CredentialsDialog,
  type CredentialsDialogMode,
} from './components/CredentialsDialog';
import { ResizableSplit } from './components/ResizableSplit';
import { ResultsPanel } from './components/ResultsPanel';
import { SchemaExplorer } from './components/SchemaExplorer';
import { SqlEditor } from './components/SqlEditor';
import { Toolbar } from './components/Toolbar';
import type {
  ConnectionGroup,
  DatabaseSchema,
  SegmentQueryResult,
  SegmentRunStatus,
  SegmentHealthInfo,
  StatusResponse,
  TableDef,
  CredentialsStatusResponse,
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

function isSqlPolicyError(message: string): boolean {
  return /Запрещённая операция/i.test(message);
}

function allConnectionIds(groups: ConnectionGroup[]): string[] {
  return groups.flatMap((g) => g.connections.map((c) => c.id));
}

function App() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [groups, setGroups] = useState<ConnectionGroup[]>([]);
  const [schema, setSchema] = useState<DatabaseSchema | null>(null);
  const [schemaSource, setSchemaSource] = useState('');
  const [selectedSegments, setSelectedSegments] = useState<string[]>([]);
  const [stopOnFirstMatch, setStopOnFirstMatch] = useState(false);
  const [sql, setSql] = useState(DEFAULT_SQL);
  const [results, setResults] = useState<SegmentQueryResult[] | null>(null);
  const [connected, setConnected] = useState(false);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [segmentRunStatus, setSegmentRunStatus] = useState<
    Record<string, SegmentRunStatus>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [segmentHealth, setSegmentHealth] = useState<
    Record<string, SegmentHealthInfo>
  >({});
  const [healthChecking, setHealthChecking] = useState(false);
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [credentialsMode, setCredentialsMode] =
    useState<CredentialsDialogMode>('unlock');
  const [credentialsStatus, setCredentialsStatus] =
    useState<CredentialsStatusResponse | null>(null);
  const [credentialsSubmitting, setCredentialsSubmitting] = useState(false);
  const [credentialsError, setCredentialsError] = useState<string | null>(null);
  const [credentialsReady, setCredentialsReady] = useState(false);
  const [settingsConnectionId, setSettingsConnectionId] = useState<string | null>(
    null,
  );
  const queryIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const pollInFlightRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const targetSegmentNames = useCallback((): string[] => {
    const ids = allConnectionIds(groups);
    if (
      selectedSegments.length > 0 &&
      selectedSegments.length < ids.length
    ) {
      return selectedSegments;
    }
    return ids;
  }, [selectedSegments, groups]);

  const pollJob = useCallback(
    async (queryId: string) => {
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      try {
        const job = await api.getQueryJob(queryId);
        setSegmentRunStatus(job.segments);
        setResults(job.results);
        if (job.status !== 'running') {
          stopPolling();
          setRunning(false);
          queryIdRef.current = null;
        }
      } catch (e) {
        stopPolling();
        setRunning(false);
        queryIdRef.current = null;
        setError(e instanceof Error ? e.message : 'Query poll failed');
      } finally {
        pollInFlightRef.current = false;
      }
    },
    [stopPolling],
  );

  const cancelQuery = useCallback(
    async (segment?: string) => {
      const queryId = queryIdRef.current;
      if (!queryId) return;

      if (segment) {
        setSegmentRunStatus((prev) => ({
          ...prev,
          [segment]: 'cancelled',
        }));
      } else {
        setSegmentRunStatus((prev) =>
          Object.fromEntries(
            Object.keys(prev).map((name) => [name, 'cancelled' as SegmentRunStatus]),
          ),
        );
      }

      try {
        await api.cancelQuery(queryId, segment ? [segment] : undefined);
        await pollJob(queryId);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Cancel failed');
      }
    },
    [pollJob],
  );

  useEffect(() => () => stopPolling(), [stopPolling]);

  const checkSegmentHealth = useCallback(async () => {
    setHealthChecking(true);
    try {
      const health = await api.getSegmentsHealth();
      setSegmentHealth(health.segments);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Segment health check failed');
    } finally {
      setHealthChecking(false);
    }
  }, []);

  const loadInitial = useCallback(async () => {
    try {
      const [st, segs, sch] = await Promise.all([
        api.getStatus(),
        api.getSegments(),
        api.getSchema(),
      ]);
      setStatus(st);
      setGroups(segs.groups);
      setSchema(sch.schema);
      setSchemaSource(sch.source);
      setConnected(true);
      setError(null);
      void checkSegmentHealth();
    } catch (e) {
      setConnected(false);
      setError(e instanceof Error ? e.message : 'Failed to connect to API');
    }
  }, [checkSegmentHealth]);

  const applyCredentialsStatus = useCallback(
    (status: CredentialsStatusResponse, segs: ConnectionGroup[]) => {
      setCredentialsStatus(status);
      setGroups(segs);

      if (status.vault_segments.length === 0) {
        setCredentialsReady(true);
        setCredentialsOpen(false);
        return false;
      }

      if (status.needs_setup) {
        setCredentialsMode('setup');
        setCredentialsOpen(true);
        setCredentialsReady(false);
        return false;
      }

      if (!status.unlocked) {
        setCredentialsMode('unlock');
        setCredentialsOpen(true);
        setCredentialsReady(false);
        return false;
      }

      if (status.missing.length > 0) {
        setCredentialsMode('missing');
        setCredentialsOpen(true);
        setCredentialsReady(false);
        return false;
      }

      setCredentialsOpen(false);
      setCredentialsReady(true);
      return true;
    },
    [],
  );

  const bootstrap = useCallback(async () => {
    try {
      const [st, creds, segs] = await Promise.all([
        api.getStatus(),
        api.getCredentialsStatus(),
        api.getSegments(),
      ]);
      setStatus(st);
      setConnected(true);
      setError(null);
      const ready = applyCredentialsStatus(creds, segs.groups);
      if (ready) {
        await loadInitial();
      }
    } catch (e) {
      setConnected(false);
      setError(e instanceof Error ? e.message : 'Failed to connect to API');
    }
  }, [applyCredentialsStatus, loadInitial]);

  const handleCredentialsSubmit = useCallback(
    async ({
      masterPassword,
      passwords,
    }: {
      masterPassword: string;
      passwords: Record<string, string>;
    }) => {
      setCredentialsSubmitting(true);
      setCredentialsError(null);
      try {
        let result;
        if (credentialsMode === 'setup') {
          result = await api.setupCredentials(masterPassword, passwords);
        } else if (credentialsMode === 'unlock') {
          result = await api.unlockCredentials(masterPassword);
          if (result.missing.length > 0) {
            const status = await api.getCredentialsStatus();
            setCredentialsStatus(status);
            setCredentialsMode('missing');
            setCredentialsSubmitting(false);
            return;
          }
        } else {
          result = await api.saveCredentials(
            passwords,
            masterPassword || undefined,
          );
        }

        const status = await api.getCredentialsStatus();
        const segs = await api.getSegments();
        const ready = applyCredentialsStatus(status, segs.groups);
        if (ready) {
          const sch = await api.reloadSchema();
          setSchema(sch.schema);
          setSchemaSource(sch.source);
          await loadInitial();
        } else if (result.missing.length > 0) {
          setCredentialsMode('missing');
        }
        setCredentialsError(null);
      } catch (e) {
        setCredentialsError(
          e instanceof Error ? e.message : 'Не удалось сохранить пароли',
        );
      } finally {
        setCredentialsSubmitting(false);
      }
    },
    [credentialsMode, applyCredentialsStatus, loadInitial],
  );

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

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
      selectedSegments.length < allConnectionIds(groups).length
        ? selectedSegments
        : [];

    const targets = targetSegmentNames();
    const initialStatus = Object.fromEntries(
      targets.map((name) => [name, 'pending' as SegmentRunStatus]),
    );

    setRunning(true);
    setResults([]);
    setSegmentRunStatus(initialStatus);
    stopPolling();

    try {
      const start = await api.executeQuery({
        sql: trimmed,
        segments: segmentFilter,
        stop_on_first_match: stopOnFirstMatch,
        autocommit: true,
      });
      queryIdRef.current = start.query_id;
      pollTimerRef.current = window.setInterval(() => {
        void pollJob(start.query_id);
      }, 500);
      void pollJob(start.query_id);
      setError(null);
    } catch (e) {
      stopPolling();
      setRunning(false);
      queryIdRef.current = null;
      setSegmentRunStatus({});
      setError(e instanceof Error ? e.message : 'Query failed');
    }
  }, [
    sql,
    selectedSegments,
    groups,
    stopOnFirstMatch,
    targetSegmentNames,
    pollJob,
    stopPolling,
  ]);

  const insertColumn = (table: TableDef, columnName: string) => {
    const snippet = `${quoteIdent(table.name)}.${quoteIdent(columnName)}`;
    setSql((prev) => (prev.trim() ? `${prev}\n${snippet}` : snippet));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!running && connected && credentialsReady) void runQuery();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [runQuery, running, connected, credentialsReady]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <Toolbar
          status={status}
          connected={connected}
          running={running}
          onRun={runQuery}
          onCancel={() => void cancelQuery()}
        />

        {error && !connected && (
          <Alert severity="error" sx={{ mx: 2, mt: 1 }}>
            {error}. Start backend:{' '}
            <code>python main.py --config segments.json --port 8080</code>
          </Alert>
        )}

        <CredentialsDialog
          open={credentialsOpen}
          mode={credentialsMode}
          groups={groups}
          missingIds={credentialsStatus?.missing ?? []}
          credentialsPath={credentialsStatus?.credentials_path ?? 'credentials.enc'}
          submitting={credentialsSubmitting}
          error={credentialsError}
          onSubmit={(payload) => void handleCredentialsSubmit(payload)}
        />

        <ConnectionSettingsDialog
          connectionId={settingsConnectionId}
          open={settingsConnectionId !== null}
          onClose={() => setSettingsConnectionId(null)}
          onSaved={() => {
            void checkSegmentHealth();
            void api.getCredentialsStatus().then((status) => {
              setCredentialsStatus(status);
            });
          }}
        />

        <Box
          sx={{
            flex: 1,
            display: 'flex',
            minHeight: 0,
            visibility: credentialsReady ? 'visible' : 'hidden',
          }}
        >
          <ResizableSplit
            direction="horizontal"
            initialFirstSize={320}
            minFirstSize={240}
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
                  initialFirstSize={260}
                  minFirstSize={120}
                  maxFirstSize={2000}
                  storageKey="multiSegmentBD.connectionsHeight"
                  first={
                    <ConnectionsPanel
                      groups={groups}
                      selected={selectedSegments}
                      stopOnFirstMatch={stopOnFirstMatch}
                      segmentRunStatus={segmentRunStatus}
                      segmentHealth={segmentHealth}
                      healthChecking={healthChecking}
                      onSelectedChange={setSelectedSegments}
                      onStopOnFirstMatchChange={setStopOnFirstMatch}
                      onCancelSegment={(name) => void cancelQuery(name)}
                      onRefreshHealth={() => void checkSegmentHealth()}
                      onOpenSettings={setSettingsConnectionId}
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
        open={!!error && connected && !isSqlPolicyError(error ?? '')}
        autoHideDuration={6000}
        onClose={() => setError(null)}
        message={error}
      />

      {error && connected && isSqlPolicyError(error) && (
        <Box
          sx={{
            position: 'fixed',
            inset: 0,
            zIndex: (theme) => theme.zIndex.modal + 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'rgba(0, 0, 0, 0.25)',
            pointerEvents: 'auto',
          }}
          onClick={() => setError(null)}
        >
          <Alert
            severity="error"
            variant="filled"
            onClose={() => setError(null)}
            onClick={(e) => e.stopPropagation()}
            sx={{
              maxWidth: 480,
              mx: 2,
              boxShadow: 6,
            }}
          >
            <Typography variant="body1" fontWeight={600}>
              {error}
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.9 }}>
              Разрешен только Select
            </Typography>
          </Alert>
        </Box>
      )}
    </ThemeProvider>
  );
}

function quoteIdent(name: string): string {
  if (/^[a-z_][a-z0-9_]*$/i.test(name)) return name;
  return `"${name.replace(/"/g, '""')}"`;
}

export default App;
