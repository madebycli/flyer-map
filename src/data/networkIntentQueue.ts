import type { NetworkIntent } from '../domain/networkSelection.ts';

type QueuedIntent = {
  key: string;
  scope: string;
  campaignId: string;
  intent: NetworkIntent;
  enqueuedAt: number;
  sequence?: number;
  blocked?: string;
};

type QueueMeta = { scope: string; nextSequence: number };

const QUEUE_DATABASE = 'flyer-map-network-intents';
const QUEUE_DATABASE_VERSION = 2;

function openQueue(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(QUEUE_DATABASE, QUEUE_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('intents')) db.createObjectStore('intents', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'scope' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await openQueue();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('intents', mode);
      const request = operation(tx.objectStore('intents'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Persist a per-scope sequence in the same IndexedDB transaction as the intent.
 * Date.now() remains useful display/debug metadata but is not an ordering oracle:
 * browsers can enqueue multiple user actions in one millisecond.
 */
export async function enqueueNetworkIntent(scope: string, campaignId: string, intent: NetworkIntent) {
  const db = await openQueue();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['intents', 'meta'], 'readwrite');
      const intents = tx.objectStore('intents');
      const meta = tx.objectStore('meta');
      const metaRequest = meta.get(scope);

      metaRequest.onsuccess = () => {
        const current = metaRequest.result as QueueMeta | undefined;
        const sequence = Number.isSafeInteger(current?.nextSequence) && current!.nextSequence > 0
          ? current!.nextSequence
          : 1;
        intents.put({
          key: `${scope}:${intent.id}`,
          scope,
          campaignId,
          intent,
          enqueuedAt: Date.now(),
          sequence,
        } satisfies QueuedIntent);
        meta.put({ scope, nextSequence: sequence + 1 } satisfies QueueMeta);
      };
      metaRequest.onerror = () => reject(metaRequest.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function queuedNetworkIntents(scope: string) {
  return (await transact('readonly', store => store.getAll()) as QueuedIntent[])
    .filter(item => item.scope === scope)
    .sort((a, b) =>
      a.enqueuedAt - b.enqueuedAt
      || (a.sequence ?? 0) - (b.sequence ?? 0)
      || a.key.localeCompare(b.key));
}

export async function discardNetworkIntent(key: string) {
  await transact('readwrite', store => store.delete(key));
}

const flushing = new Map<string, Promise<void>>();

export function flushNetworkIntents(scope: string, onApplied: () => Promise<unknown>) {
  const existing = flushing.get(scope);
  if (existing) return existing;
  const operation = (async () => {
    for (const item of await queuedNetworkIntents(scope)) {
      if (item.blocked) break;
      const response = await fetch(`/api/campaigns/${encodeURIComponent(item.campaignId)}/network`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(item.intent),
        signal: AbortSignal.timeout(25000),
      });
      if (response.ok) {
        await discardNetworkIntent(item.key);
        await onApplied();
        continue;
      }
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        const body = await response.json().catch(() => ({}));
        await transact('readwrite', store => store.put({
          ...item,
          blocked: typeof body.code === 'string' ? body.code : 'network_conflict',
        }));
        break;
      }
      throw new Error('network_retry');
    }
  })().finally(() => flushing.delete(scope));
  flushing.set(scope, operation);
  return operation;
}
