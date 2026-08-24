export interface TransportKeyResponse {
  algorithm: string;
  public_key: string;
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

async function fetchTransportPublicKey(): Promise<string> {
  const apiBase = resolveApiBase();
  const res = await fetch(`${apiBase}/api/credentials/transport-key`);
  if (!res.ok) {
    throw new Error('Не удалось получить ключ шифрования');
  }
  const body = (await res.json()) as TransportKeyResponse;
  return body.public_key;
}

function pemToSpkiDer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function importPublicKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki',
    pemToSpkiDer(pem),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function encryptSecret(value: string): Promise<string> {
  const pem = await fetchTransportPublicKey();
  const key = await importPublicKey(pem);
  const encoded = new TextEncoder().encode(value);
  const encrypted = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, encoded);
  return bytesToBase64(new Uint8Array(encrypted));
}

declare global {
  interface Window {
    __APP_CONFIG__?: {
      apiBase?: string;
    };
  }
}
