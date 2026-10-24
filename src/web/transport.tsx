import { useEffect, useState, type ReactNode } from 'react';
import type { BrowserRuntime } from './browser-runtime.js';

export const browserOnly = import.meta.env.MODE === 'public';
let token = '';
let runtimePromise: Promise<BrowserRuntime> | undefined;
export function browserRuntime() {
  return (runtimePromise ??= import('./browser-runtime.js').then(({ BrowserRuntime }) => {
    let storage: Storage | undefined;
    try {
      storage = window.localStorage;
    } catch {}
    return new BrowserRuntime(storage);
  }));
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  if (browserOnly) return (await browserRuntime()).request<T>(path, body);
  const response = await fetch(
    `/api${path}`,
    body === undefined
      ? { signal: AbortSignal.timeout(10000) }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Gamefield-Token': token },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Request failed.');
  if (path === '/health') token = data.token;
  return data;
}

export function subscribe<T>(path: string, listener: (record: T) => void, onError?: () => void) {
  if (browserOnly) {
    let closed = false;
    let unsubscribe: (() => void) | undefined;
    void browserRuntime()
      .then((runtime) => {
        if (!closed) unsubscribe = runtime.subscribe(path, listener);
      })
      .catch(() => onError?.());
    return () => {
      closed = true;
      unsubscribe?.();
    };
  }
  const source = new EventSource(`/api${path}/events`);
  source.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (path.startsWith('/matches/')) {
      if (data.type === 'snapshot') listener(data.match);
    } else listener(data);
  };
  source.onerror = () => onError?.();
  return () => source.close();
}

export function ExportLink({ path, children }: { path: string; children: ReactNode }) {
  const [error, setError] = useState('');
  return (
    <>
      <a
        href={browserOnly ? '#download' : `/api${path}`}
        download
        onClick={
          browserOnly
            ? (event) => {
                event.preventDefault();
                void browserRuntime()
                  .then((runtime) => {
                    const file = runtime.export(path);
                    const url = URL.createObjectURL(new Blob([file.content], { type: file.type }));
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = file.filename;
                    link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                    setError('');
                  })
                  .catch((error: Error) => setError(error.message));
              }
            : undefined
        }
      >
        {children}
      </a>
      {error && <span role="alert">{error}</span>}
    </>
  );
}

export function BrowserNotice() {
  const [warning, setWarning] = useState('');
  useEffect(() => {
    if (!browserOnly) return;
    let closed = false;
    let unsubscribe: (() => void) | undefined;
    void browserRuntime().then((runtime) => {
      if (closed) return;
      const update = () => setWarning(runtime.storageWarning);
      update();
      unsubscribe = runtime.subscribe('storage', update);
    });
    return () => {
      closed = true;
      unsubscribe?.();
    };
  }, []);
  if (!browserOnly) return null;
  return (
    <p className={warning ? 'notice' : 'muted'} role="status">
      {warning ||
        'Free play runs in your browser. Games save here when browser storage is available. Download a replay to keep a copy.'}
    </p>
  );
}
