import type {
  QueryJobResponse,
  QueryRequest,
  QueryStartResponse,
  SchemaResponse,
  SegmentsResponse,
  SegmentsHealthResponse,
  StatusResponse,
} from '../types';

declare global {
  interface Window {
    __APP_CONFIG__?: {
      apiBase?: string;
    };
  }
}

function resolveApiBase(): string {
  const fromConfig = window.__APP_CONFIG__?.apiBase;
  if (fromConfig !== undefined && fromConfig !== '') {
    return fromConfig.replace(/\/$/, '');
  }
  const fromEnv = process.env.REACT_APP_API_URL;
  if (fromEnv) {
    return fromEnv.replace(/\/$/, '');
  }
  return '';
}

const API_BASE = resolveApiBase();

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getStatus: () => request<StatusResponse>('/api/status'),
  getSegments: () => request<SegmentsResponse>('/api/segments'),
  getSegmentsHealth: () => request<SegmentsHealthResponse>('/api/segments/health'),
  getSchema: () => request<SchemaResponse>('/api/schema'),
  reloadSchema: () =>
    request<SchemaResponse>('/api/schema/reload', { method: 'POST' }),
  executeQuery: (body: QueryRequest) =>
    request<QueryStartResponse>('/api/query', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getQueryJob: (queryId: string) =>
    request<QueryJobResponse>(`/api/query/${encodeURIComponent(queryId)}`),
  cancelQuery: (queryId: string, segments?: string[]) =>
    request<{ ok: boolean }>(
      `/api/query/${encodeURIComponent(queryId)}/cancel`,
      {
        method: 'POST',
        body: JSON.stringify(segments ? { segments } : {}),
      },
    ),
};
