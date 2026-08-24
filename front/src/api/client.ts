import type {
  QueryJobResponse,
  QueryRequest,
  QueryStartResponse,
  SchemaResponse,
  SegmentsResponse,
  SegmentsHealthResponse,
  StatusResponse,
  CredentialsStatusResponse,
  CredentialsUnlockResponse,
  ConnectionSettingsResponse,
  ConnectionTestResponse,
} from '../types';
import { encryptSecret } from '../utils/transportCrypto';

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
  getCredentialsStatus: () =>
    request<CredentialsStatusResponse>('/api/credentials/status'),
  unlockCredentials: async (master_password: string) => {
    const encrypted_master_password = await encryptSecret(master_password);
    return request<CredentialsUnlockResponse>('/api/credentials/unlock', {
      method: 'POST',
      body: JSON.stringify({ encrypted_master_password }),
    });
  },
  setupCredentials: async (master_password: string, passwords: Record<string, string>) => {
    const encrypted_master_password = await encryptSecret(master_password);
    return request<CredentialsUnlockResponse>('/api/credentials/setup', {
      method: 'POST',
      body: JSON.stringify({ encrypted_master_password, passwords }),
    });
  },
  saveCredentials: async (
    passwords: Record<string, string>,
    master_password?: string,
  ) => {
    const body: Record<string, unknown> = { passwords };
    if (master_password) {
      body.encrypted_master_password = await encryptSecret(master_password);
    }
    return request<CredentialsUnlockResponse>('/api/credentials/save', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  lockCredentials: () =>
    request<{ ok: boolean; unlocked: boolean }>('/api/credentials/lock', {
      method: 'POST',
    }),
  getConnectionSettings: (connectionId: string) =>
    request<ConnectionSettingsResponse>(
      `/api/connections/${connectionId}/settings`,
    ),
  saveConnectionPassword: async (connectionId: string, password: string) => {
    const encrypted_password = await encryptSecret(password);
    return request<{ ok: boolean; password_configured: boolean }>(
      `/api/connections/${connectionId}/password`,
      {
        method: 'POST',
        body: JSON.stringify({ encrypted_password }),
      },
    );
  },
  testConnection: async (connectionId: string, password?: string) => {
    const body: Record<string, string> = {};
    if (password) {
      body.encrypted_password = await encryptSecret(password);
    }
    return request<ConnectionTestResponse>(
      `/api/connections/${connectionId}/test`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
  },
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
