import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from './supabase';

export type OfflineMember = { id: string; name: string; owner_id?: string; created_at?: string };
export type OfflineCategory = {
  id: string; owner_id: string; name: string; kind: 'expense' | 'saving';
  icon: string | null; is_active: boolean; created_at?: string;
};
export type OfflineTransaction = {
  id: string; owner_id: string; member_id: string; category_id: string | null;
  type: 'income' | 'expense' | 'saving_deposit' | 'saving_withdrawal';
  amount: number | string; occurred_on: string; note: string | null;
  created_at?: string; updated_at?: string;
};
export type OfflineSnapshot = {
  members: OfflineMember[];
  categories: OfflineCategory[];
  transactions: OfflineTransaction[];
};
type QueueItem = {
  id: string;
  table: 'transactions' | 'categories';
  action: 'upsert' | 'delete';
  payload?: Record<string, unknown>;
  recordId: string;
};
type StoredData = {
  snapshot: OfflineSnapshot;
  queue: QueueItem[];
  hasSnapshot: boolean;
  lastSyncedAt: string | null;
};

const KEY_PREFIX = '@expense-tracker/offline/v1/';
const emptySnapshot = (): OfflineSnapshot => ({ members: [], categories: [], transactions: [] });
const emptyStored = (): StoredData => ({ snapshot: emptySnapshot(), queue: [], hasSnapshot: false, lastSyncedAt: null });

export function makeLocalId(): string {
  // UUID v4-compatible generator without requiring a native crypto module.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function storageKey(ownerId: string) { return `${KEY_PREFIX}${ownerId}`; }

async function readStored(ownerId: string): Promise<StoredData> {
  const raw = await AsyncStorage.getItem(storageKey(ownerId));
  if (!raw) return emptyStored();
  try {
    const parsed = JSON.parse(raw) as Partial<StoredData>;
    return {
      snapshot: { ...emptySnapshot(), ...(parsed.snapshot ?? {}) },
      queue: Array.isArray(parsed.queue) ? parsed.queue : [],
      hasSnapshot: Boolean(parsed.hasSnapshot),
      lastSyncedAt: parsed.lastSyncedAt ?? null,
    };
  } catch {
    return emptyStored();
  }
}

async function writeStored(ownerId: string, stored: StoredData) {
  await AsyncStorage.setItem(storageKey(ownerId), JSON.stringify(stored));
}

export async function isOnlineNow(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return state.isConnected === true && state.isInternetReachable !== false;
}

export async function getOfflineStatus(ownerId: string) {
  const [online, stored] = await Promise.all([isOnlineNow(), readStored(ownerId)]);
  return {
    online,
    pendingCount: stored.queue.length,
    lastSyncedAt: stored.lastSyncedAt,
  };
}

function applyPendingQueue(snapshot: OfflineSnapshot, queue: QueueItem[]): OfflineSnapshot {
  const result: OfflineSnapshot = {
    members: [...snapshot.members],
    categories: [...snapshot.categories],
    transactions: [...snapshot.transactions],
  };
  for (const item of queue) {
    const rows = (item.table === 'categories' ? result.categories : result.transactions) as unknown as Array<Record<string, unknown>>;
    if (item.action === 'delete') {
      const remaining = rows.filter((row) => row.id !== item.recordId);
      if (item.table === 'categories') result.categories = remaining as unknown as OfflineCategory[];
      else result.transactions = remaining as unknown as OfflineTransaction[];
    } else if (item.payload) {
      const index = rows.findIndex((row) => row.id === item.recordId);
      if (index >= 0) rows[index] = { ...rows[index], ...item.payload };
      else rows.push(item.payload);
    }
  }
  return result;
}

export async function getCachedSnapshot(ownerId: string): Promise<OfflineSnapshot | null> {
  const stored = await readStored(ownerId);
  if (!stored.hasSnapshot) return null;
  return applyPendingQueue(stored.snapshot, stored.queue);
}

export async function getDashboardSnapshot(ownerId: string): Promise<{
  snapshot: OfflineSnapshot;
  online: boolean;
  pendingCount: number;
  lastSyncedAt: string | null;
}> {
  const online = await isOnlineNow();
  const stored = await readStored(ownerId);

  if (online) {
    try {
      const [memberResult, categoryResult, transactionResult] = await Promise.all([
        supabase.from('members').select('id, name, owner_id, created_at').eq('owner_id', ownerId).order('created_at'),
        supabase.from('categories').select('id, name, kind, icon, is_active, owner_id, created_at').eq('owner_id', ownerId).order('name'),
        supabase.from('transactions').select('id, owner_id, member_id, category_id, type, amount, occurred_on, note, created_at, updated_at').eq('owner_id', ownerId).order('occurred_on', { ascending: false }).order('created_at', { ascending: false }),
      ]);
      if (memberResult.error) throw memberResult.error;
      if (categoryResult.error) throw categoryResult.error;
      if (transactionResult.error) throw transactionResult.error;

      const remoteSnapshot: OfflineSnapshot = {
        members: (memberResult.data ?? []) as OfflineMember[],
        categories: (categoryResult.data ?? []) as OfflineCategory[],
        transactions: (transactionResult.data ?? []) as OfflineTransaction[],
      };
      const latest = await readStored(ownerId);
      latest.snapshot = remoteSnapshot;
      latest.hasSnapshot = true;
      latest.lastSyncedAt = new Date().toISOString();
      await writeStored(ownerId, latest);
      return {
        snapshot: applyPendingQueue(remoteSnapshot, latest.queue),
        online: true,
        pendingCount: latest.queue.length,
        lastSyncedAt: latest.lastSyncedAt,
      };
    } catch (error) {
      // A connectivity check can succeed while the server is unreachable.
      if (!stored.hasSnapshot) throw error;
    }
  }

  if (!stored.hasSnapshot) {
    throw new Error('No offline data is saved on this phone yet. Connect to the internet once to load your household data, then offline use will be available.');
  }
  return {
    snapshot: applyPendingQueue(stored.snapshot, stored.queue),
    online: false,
    pendingCount: stored.queue.length,
    lastSyncedAt: stored.lastSyncedAt,
  };
}

export async function cacheRows(
  ownerId: string,
  table: 'members' | 'categories' | 'transactions',
  rows: Array<Record<string, unknown>>,
) {
  const stored = await readStored(ownerId);
  if (table === 'members') stored.snapshot.members = rows as unknown as OfflineMember[];
  else if (table === 'categories') stored.snapshot.categories = rows as unknown as OfflineCategory[];
  else stored.snapshot.transactions = rows as unknown as OfflineTransaction[];
  stored.hasSnapshot = true;
  await writeStored(ownerId, stored);
}

export async function cacheUpsert(
  ownerId: string,
  table: 'categories' | 'transactions',
  row: Record<string, unknown>,
  queueForSync = false,
) {
  const stored = await readStored(ownerId);
  const rows = (table === 'categories' ? stored.snapshot.categories : stored.snapshot.transactions) as unknown as Array<Record<string, unknown>>;
  const index = rows.findIndex((item) => item.id === row.id);
  if (index >= 0) rows[index] = { ...rows[index], ...row };
  else rows.push(row);
  stored.hasSnapshot = true;
  if (queueForSync) stored.queue.push({ id: makeLocalId(), table, action: 'upsert', payload: row, recordId: String(row.id) });
  await writeStored(ownerId, stored);
}

export async function cacheDelete(
  ownerId: string,
  table: 'categories' | 'transactions',
  recordId: string,
  queueForSync = false,
) {
  const stored = await readStored(ownerId);
  const rows = (table === 'categories' ? stored.snapshot.categories : stored.snapshot.transactions) as unknown as Array<Record<string, unknown>>;
  const remaining = rows.filter((item) => item.id !== recordId);
  if (table === 'categories') stored.snapshot.categories = remaining as unknown as OfflineCategory[];
  else stored.snapshot.transactions = remaining as unknown as OfflineTransaction[];
  stored.hasSnapshot = true;
  if (queueForSync) stored.queue.push({ id: makeLocalId(), table, action: 'delete', recordId });
  await writeStored(ownerId, stored);
}

let activeSync: Promise<number> | null = null;

export async function syncPendingChanges(ownerId: string): Promise<number> {
  if (activeSync) return activeSync;
  activeSync = performSync(ownerId);
  try { return await activeSync; } finally { activeSync = null; }
}

async function performSync(ownerId: string): Promise<number> {
  if (!(await isOnlineNow())) return (await readStored(ownerId)).queue.length;
  let stored = await readStored(ownerId);
  while (stored.queue.length > 0) {
    const item = stored.queue[0];
    let error: { message?: string } | null = null;
    if (item.action === 'upsert' && item.payload) {
      const result = await supabase.from(item.table).upsert(item.payload, { onConflict: 'id' });
      error = result.error;
    } else {
      const result = await supabase.from(item.table).delete().eq('id', item.recordId).eq('owner_id', ownerId);
      error = result.error;
    }
    if (error) break;
    stored.queue = stored.queue.filter((queued) => queued.id !== item.id);
    stored.lastSyncedAt = new Date().toISOString();
    await writeStored(ownerId, stored);
    stored = await readStored(ownerId);
  }
  return stored.queue.length;
}
