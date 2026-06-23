import type {
  QueryRequest,
  QueryResponse,
  SchemaResponse,
  SegmentsResponse,
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
  getSchema: () => request<SchemaResponse>('/api/schema'),
  reloadSchema: () =>
    request<SchemaResponse>('/api/schema/reload', { method: 'POST' }),
  executeQuery: (body: QueryRequest) =>
    request<QueryResponse>('/api/query', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
