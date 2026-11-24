import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import {
  arrayRemove,
  arrayUnion,
  deleteDocument,
  deleteField,
  getDocument,
  serverTimestamp,
  setDocument,
  subscribeDocument,
  updateDocument,
} from '../_firebase/firestore-adapter';
import { captureError } from '../logger';

const ACTIVE_MEALS_COLLECTION = 'active_meals';
const MEAL_CACHE_PREFIX = 'cookbook:active_meal:v1:';
const MEAL_QUEUE_PREFIX = 'cookbook:active_meal_queue:v1:';
const ONLINE_WRITE_TIMEOUT_MS = 10_000;
const MAX_RETRY_ATTEMPTS = 5;

export interface RecipeMealState {
  servings: number;
  currentStepIndex?: number;
  unselectedIngredients: string[];
}

export interface ActiveMealDoc {
  id?: string;
  recipeIds: string[];
  activeRecipeId: string | null;
  recipeStates: Record<string, RecipeMealState>;
  lastUpdated?: any;
}

interface CachedMealEnvelope {
  exists: boolean;
  data: ActiveMealDoc | null;
  cachedAt: number;
}

type QueuedMealOp =
  | {
      id: string;
      type: 'add';
      recipeId: string;
      defaultServings?: number;
      setActive: boolean;
      ts: number;
    }
  | {
      id: string;
      type: 'remove';
      recipeId: string;
      nextActiveRecipeId: string | null;
      ts: number;
    }
  | {
      id: string;
      type: 'switch';
      recipeId: string;
      ts: number;
    }
  | {
      id: string;
      type: 'updateState';
      recipeId: string;
      partial: Partial<RecipeMealState>;
      ts: number;
    }
  | {
      id: string;
      type: 'clear';
      ts: number;
    };

interface UidSubscriptionState {
  listeners: Set<(meal: ActiveMealDoc | null) => void>;
  unsubFirestore: (() => void) | null;
  unsubNetInfo: (() => void) | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryCount: number;
  wasOffline: boolean;
}

const mealCacheByUid = new Map<string, ActiveMealDoc | null>();
const lastServerMealByUid = new Map<string, ActiveMealDoc | null>();
const queueByUid = new Map<string, QueuedMealOp[]>();
const queueLoadedByUid = new Set<string>();
const flushingByUid = new Set<string>();
const inFlightOpIdByUid = new Map<string, string>();
const queueLockByUid = new Map<string, Promise<void>>();
const subscriptionsByUid = new Map<string, UidSubscriptionState>();

async function withQueueLock<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  const prev = queueLockByUid.get(uid) || Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = prev.then(() => next);
  queueLockByUid.set(uid, chained);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (queueLockByUid.get(uid) === chained) {
      queueLockByUid.delete(uid);
    }
  }
}

let cachedOnlineStatus: boolean | null = null;

function isNetStateOffline(state: NetInfoState | null | undefined): boolean {
  if (!state) return false;
  if (state.isConnected === false) return true;
  if (state.type === 'none') return true;
  return false;
}

async function checkIsOnline(): Promise<boolean> {
  if (cachedOnlineStatus !== null) return cachedOnlineStatus;
  try {
    const state = await NetInfo.fetch();
    cachedOnlineStatus = !isNetStateOffline(state);
    return cachedOnlineStatus;
  } catch {
    return true;
  }
}

function makeOpId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function mealCacheKey(uid: string): string {
  return `${MEAL_CACHE_PREFIX}${uid}`;
}

function mealQueueKey(uid: string): string {
  return `${MEAL_QUEUE_PREFIX}${uid}`;
}

function normalizeRecipeState(raw: any): RecipeMealState {
  const servings =
    typeof raw?.servings === 'number' && Number.isFinite(raw.servings) && raw.servings > 0
      ? raw.servings
      : 0;
  const unselectedIngredients = Array.isArray(raw?.unselectedIngredients)
    ? raw.unselectedIngredients.filter((k: unknown): k is string => typeof k === 'string')
    : [];
  const state: RecipeMealState = {
    servings,
    unselectedIngredients,
  };
  if (
    typeof raw?.currentStepIndex === 'number' &&
    Number.isFinite(raw.currentStepIndex) &&
    raw.currentStepIndex >= 0
  ) {
    state.currentStepIndex = raw.currentStepIndex;
  }
  return state;
}

function normalizeMealDoc(raw: any, uid: string): ActiveMealDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const recipeIds = Array.isArray(raw.recipeIds)
    ? raw.recipeIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
    : [];
  const rawStates =
    raw.recipeStates && typeof raw.recipeStates === 'object' ? raw.recipeStates : {};
  const recipeStates: Record<string, RecipeMealState> = {};
  for (const [recipeId, state] of Object.entries(rawStates)) {
    if (state && typeof state === 'object') {
      recipeStates[recipeId] = normalizeRecipeState(state);
    }
  }
  const activeRecipeId =
    typeof raw.activeRecipeId === 'string' && recipeIds.includes(raw.activeRecipeId)
      ? raw.activeRecipeId
      : recipeIds.length > 0
        ? recipeIds[0]
        : null;

  return {
    id: raw.id || uid,
    recipeIds,
    activeRecipeId,
    recipeStates,
    lastUpdated: raw.lastUpdated ?? null,
  };
}

function serializeMealForCache(meal: ActiveMealDoc | null): CachedMealEnvelope {
  if (!meal) {
    return { exists: false, data: null, cachedAt: Date.now() };
  }
  return {
    exists: true,
    data: {
      id: meal.id,
      recipeIds: [...meal.recipeIds],
      activeRecipeId: meal.activeRecipeId,
      recipeStates: Object.fromEntries(
        Object.entries(meal.recipeStates || {}).map(([id, state]) => [
          id,
          {
            servings: state.servings,
            ...(state.currentStepIndex !== undefined
              ? { currentStepIndex: state.currentStepIndex }
              : {}),
            unselectedIngredients: [...(state.unselectedIngredients || [])],
          },
        ]),
      ),
      lastUpdated:
        typeof meal.lastUpdated?.toMillis === 'function'
          ? meal.lastUpdated.toMillis()
          : typeof meal.lastUpdated === 'number'
            ? meal.lastUpdated
            : Date.now(),
    },
    cachedAt: Date.now(),
  };
}

async function readCachedMeal(
  uid: string,
): Promise<{ found: boolean; data: ActiveMealDoc | null }> {
  try {
    const raw = await AsyncStorage.getItem(mealCacheKey(uid));
    if (!raw) return { found: false, data: null };
    const parsed = JSON.parse(raw) as CachedMealEnvelope;
    if (!parsed || typeof parsed !== 'object') return { found: false, data: null };
    if (!parsed.exists || !parsed.data) return { found: true, data: null };
    return { found: true, data: normalizeMealDoc(parsed.data, uid) };
  } catch {
    return { found: false, data: null };
  }
}

async function writeCachedMeal(uid: string, meal: ActiveMealDoc | null): Promise<void> {
  mealCacheByUid.set(uid, meal);
  try {
    await AsyncStorage.setItem(mealCacheKey(uid), JSON.stringify(serializeMealForCache(meal)));
  } catch {
    // Cache persistence is best-effort
  }
}

async function loadQueue(uid: string): Promise<QueuedMealOp[]> {
  if (queueLoadedByUid.has(uid)) {
    return queueByUid.get(uid) || [];
  }
  try {
    const raw = await AsyncStorage.getItem(mealQueueKey(uid));
    const parsed = raw ? JSON.parse(raw) : [];
    const list: QueuedMealOp[] = Array.isArray(parsed) ? parsed : [];
    const existing = queueByUid.get(uid) || [];
    const merged = [...list, ...existing];
    queueByUid.set(uid, merged);
    queueLoadedByUid.add(uid);
    return merged;
  } catch {
    queueLoadedByUid.add(uid);
    const existing = queueByUid.get(uid) || [];
    queueByUid.set(uid, existing);
    return existing;
  }
}

async function saveQueue(uid: string, ops: QueuedMealOp[]): Promise<void> {
  queueByUid.set(uid, ops);
  queueLoadedByUid.add(uid);
  try {
    if (ops.length === 0) {
      await AsyncStorage.removeItem(mealQueueKey(uid));
    } else {
      await AsyncStorage.setItem(mealQueueKey(uid), JSON.stringify(ops));
    }
  } catch {
    // Best-effort persistence
  }
}

async function enqueueOpUnlocked(uid: string, op: QueuedMealOp): Promise<void> {
  const queue = [...(await loadQueue(uid))];

  if (op.type === 'clear') {
    await saveQueue(uid, [op]);
    return;
  }

  // Coalesce consecutive state patches for the same recipe (never coalesce into an in-flight op)
  const last = queue[queue.length - 1];
  const inFlightId = inFlightOpIdByUid.get(uid);
  const canCoalesceLast = Boolean(last && last.id !== inFlightId);

  if (
    canCoalesceLast &&
    op.type === 'updateState' &&
    last.type === 'updateState' &&
    last.recipeId === op.recipeId
  ) {
    queue[queue.length - 1] = {
      ...last,
      partial: { ...last.partial, ...op.partial },
      ts: op.ts,
    };
    await saveQueue(uid, queue);
    return;
  }

  // Coalesce consecutive tab switches
  if (canCoalesceLast && op.type === 'switch' && last.type === 'switch') {
    queue[queue.length - 1] = op;
    await saveQueue(uid, queue);
    return;
  }

  queue.push(op);
  await saveQueue(uid, queue);
}

async function removeOpById(uid: string, opId: string): Promise<void> {
  await withQueueLock(uid, async () => {
    const latestOps = await loadQueue(uid);
    const remaining = latestOps.filter((o) => o.id !== opId);
    await saveQueue(uid, remaining);
  });
}

function applyOpToMeal(
  meal: ActiveMealDoc | null,
  op: QueuedMealOp,
  uid: string,
): ActiveMealDoc | null {
  switch (op.type) {
    case 'clear':
      return null;

    case 'add': {
      const base: ActiveMealDoc = meal
        ? {
            ...meal,
            recipeIds: [...meal.recipeIds],
            recipeStates: { ...meal.recipeStates },
          }
        : {
            id: uid,
            recipeIds: [],
            activeRecipeId: null,
            recipeStates: {},
            lastUpdated: op.ts,
          };

      if (!base.recipeIds.includes(op.recipeId)) {
        base.recipeIds.push(op.recipeId);
      }
      if (op.setActive || !base.activeRecipeId || !base.recipeIds.includes(base.activeRecipeId)) {
        base.activeRecipeId = op.recipeId;
      }
      if (
        typeof op.defaultServings === 'number' &&
        op.defaultServings > 0 &&
        !base.recipeStates[op.recipeId]
      ) {
        base.recipeStates[op.recipeId] = {
          servings: op.defaultServings,
          unselectedIngredients: [],
        };
      }
      base.lastUpdated = op.ts;
      return base;
    }

    case 'remove': {
      if (!meal) return null;
      const nextIds = meal.recipeIds.filter((id) => id !== op.recipeId);
      const nextStates = { ...meal.recipeStates };
      delete nextStates[op.recipeId];
      const nextActive =
        op.nextActiveRecipeId && nextIds.includes(op.nextActiveRecipeId)
          ? op.nextActiveRecipeId
          : nextIds.length > 0
            ? nextIds[0]
            : null;
      return {
        ...meal,
        recipeIds: nextIds,
        activeRecipeId: nextActive,
        recipeStates: nextStates,
        lastUpdated: op.ts,
      };
    }

    case 'switch': {
      if (!meal) return null;
      return {
        ...meal,
        activeRecipeId: op.recipeId,
        lastUpdated: op.ts,
      };
    }

    case 'updateState': {
      if (!meal) return null;
      const prev = meal.recipeStates[op.recipeId] || {
        servings: 0,
        unselectedIngredients: [],
      };
      const nextState: RecipeMealState = {
        ...prev,
        ...op.partial,
        unselectedIngredients:
          op.partial.unselectedIngredients !== undefined
            ? [...op.partial.unselectedIngredients]
            : [...(prev.unselectedIngredients || [])],
      };
      return {
        ...meal,
        recipeStates: {
          ...meal.recipeStates,
          [op.recipeId]: nextState,
        },
        lastUpdated: op.ts,
      };
    }
  }
}

function applyPendingOps(
  baseMeal: ActiveMealDoc | null,
  ops: QueuedMealOp[],
  uid: string,
): ActiveMealDoc | null {
  return ops.reduce<ActiveMealDoc | null>((acc, op) => applyOpToMeal(acc, op, uid), baseMeal);
}

function notifyListeners(uid: string, meal: ActiveMealDoc | null): void {
  const entry = subscriptionsByUid.get(uid);
  if (!entry) return;
  for (const listener of Array.from(entry.listeners)) {
    try {
      listener(meal);
    } catch {
      // Never let one subscriber break others
    }
  }
}

function computeNextActiveAfterRemove(meal: ActiveMealDoc | null, recipeId: string): string | null {
  if (!meal || !Array.isArray(meal.recipeIds)) return null;
  const idx = meal.recipeIds.indexOf(recipeId);
  const remaining = meal.recipeIds.filter((id) => id !== recipeId);
  if (remaining.length === 0) return null;

  if (
    meal.activeRecipeId &&
    meal.activeRecipeId !== recipeId &&
    remaining.includes(meal.activeRecipeId)
  ) {
    return meal.activeRecipeId;
  }
  // Previous tab (index - 1), then next tab, else null
  if (idx > 0) {
    return meal.recipeIds[idx - 1];
  }
  if (idx === 0 && meal.recipeIds.length > 1) {
    return meal.recipeIds[1];
  }
  return remaining[0] ?? null;
}

function isIgnorableMissingDocError(err: any): boolean {
  const code = String(err?.code || '');
  return code === 'not-found' || code === 'firestore/not-found';
}

function isNetworkOrOfflineError(err: any): boolean {
  const code = String(err?.code || '');
  const msg = String(err?.message || '').toLowerCase();
  return (
    code === 'unavailable' ||
    code === 'firestore/unavailable' ||
    code === 'deadline-exceeded' ||
    msg.includes('offline') ||
    msg.includes('network') ||
    msg.includes('failed to get document')
  );
}

async function runWithOfflineAbort<T>(
  work: Promise<T>,
): Promise<{ completed: boolean; value?: T }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubNet: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (unsubNet) {
        unsubNet();
        unsubNet = null;
      }
    };

    unsubNet = NetInfo.addEventListener((state) => {
      if (isNetStateOffline(state)) {
        cachedOnlineStatus = false;
        if (!settled) {
          settled = true;
          cleanup();
          resolve({ completed: false });
        }
      }
    });

    timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve({ completed: false });
      }
    }, ONLINE_WRITE_TIMEOUT_MS);

    work.then(
      (value) => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve({ completed: true, value });
        }
      },
      (err) => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(err);
        }
      },
    );
  });
}

async function executeOpOnFirestore(uid: string, op: QueuedMealOp): Promise<void> {
  switch (op.type) {
    case 'add': {
      const data: Record<string, any> = {
        recipeIds: arrayUnion(op.recipeId),
        lastUpdated: serverTimestamp(),
      };
      if (op.setActive) {
        data.activeRecipeId = op.recipeId;
      }
      if (typeof op.defaultServings === 'number' && op.defaultServings > 0) {
        data.recipeStates = {
          [op.recipeId]: {
            servings: op.defaultServings,
            unselectedIngredients: [],
          },
        };
      }
      await setDocument(ACTIVE_MEALS_COLLECTION, data, { merge: true }, uid);
      return;
    }

    case 'remove': {
      try {
        await updateDocument(
          ACTIVE_MEALS_COLLECTION,
          {
            recipeIds: arrayRemove(op.recipeId),
            activeRecipeId: op.nextActiveRecipeId,
            [`recipeStates.${op.recipeId}`]: deleteField(),
            lastUpdated: serverTimestamp(),
          },
          uid,
        );
      } catch (err) {
        if (!isIgnorableMissingDocError(err)) throw err;
      }
      return;
    }

    case 'switch': {
      try {
        await updateDocument(
          ACTIVE_MEALS_COLLECTION,
          {
            activeRecipeId: op.recipeId,
            lastUpdated: serverTimestamp(),
          },
          uid,
        );
      } catch (err) {
        if (!isIgnorableMissingDocError(err)) throw err;
      }
      return;
    }

    case 'updateState': {
      const flat: Record<string, any> = {};
      for (const [key, value] of Object.entries(op.partial)) {
        if (value !== undefined) {
          flat[`recipeStates.${op.recipeId}.${key}`] = value;
        }
      }
      if (Object.keys(flat).length === 0) return;
      flat.lastUpdated = serverTimestamp();

      try {
        await updateDocument(ACTIVE_MEALS_COLLECTION, flat, uid);
      } catch (err) {
        if (isIgnorableMissingDocError(err)) {
          // If doc did not exist yet, merge nested state cleanly without dot-keys
          const cleanPartial: Record<string, any> = {};
          for (const [key, value] of Object.entries(op.partial)) {
            if (value !== undefined) cleanPartial[key] = value;
          }
          await setDocument(
            ACTIVE_MEALS_COLLECTION,
            {
              recipeStates: { [op.recipeId]: cleanPartial },
              lastUpdated: serverTimestamp(),
            },
            { merge: true },
            uid,
          );
          return;
        }
        throw err;
      }
      return;
    }

    case 'clear': {
      try {
        await deleteDocument(ACTIVE_MEALS_COLLECTION, uid);
      } catch (err) {
        if (!isIgnorableMissingDocError(err)) throw err;
      }
      return;
    }
  }
}

function scheduleRetryFlush(uid: string): void {
  const entry = subscriptionsByUid.get(uid);
  if (!entry) return;
  if (entry.retryTimer || entry.retryCount >= MAX_RETRY_ATTEMPTS) return;
  entry.retryCount += 1;
  const delayMs = Math.min(1000 * Math.pow(2, entry.retryCount - 1), 8000);
  entry.retryTimer = setTimeout(() => {
    entry.retryTimer = null;
    void flushQueue(uid);
  }, delayMs);
}

async function flushQueue(uid: string): Promise<void> {
  if (!uid || flushingByUid.has(uid)) return;
  const online = await checkIsOnline();
  if (!online) return;

  const ops = await loadQueue(uid);
  if (ops.length === 0) return;

  flushingByUid.add(uid);
  try {
    while (true) {
      const currentOnline = await checkIsOnline();
      if (!currentOnline) break;

      const currentOps = await loadQueue(uid);
      if (currentOps.length === 0) break;

      const nextOp = currentOps[0];
      inFlightOpIdByUid.set(uid, nextOp.id);
      try {
        const res = await runWithOfflineAbort(executeOpOnFirestore(uid, nextOp));
        if (!res.completed) {
          scheduleRetryFlush(uid);
          break;
        }
        // Remove only the completed op by ID (newer ops may have arrived while awaiting)
        await removeOpById(uid, nextOp.id);

        const sub = subscriptionsByUid.get(uid);
        if (sub) sub.retryCount = 0;
      } catch (err) {
        if (isNetworkOrOfflineError(err)) {
          scheduleRetryFlush(uid);
          break;
        }
        captureError(err, { service: 'active-meal', op: `flush:${nextOp.type}`, uid });
        // Drop non-network permanent failure (e.g. permission error) to prevent infinite loop
        await removeOpById(uid, nextOp.id);
      } finally {
        inFlightOpIdByUid.delete(uid);
      }
    }
  } finally {
    flushingByUid.delete(uid);
  }
}

async function getCurrentLocalOrRemoteMeal(uid: string): Promise<ActiveMealDoc | null> {
  if (mealCacheByUid.has(uid)) {
    return mealCacheByUid.get(uid) ?? null;
  }
  const cached = await readCachedMeal(uid);
  if (cached.found) {
    const ops = await loadQueue(uid);
    const effective = applyPendingOps(cached.data, ops, uid);
    mealCacheByUid.set(uid, effective);
    return effective;
  }
  return ActiveMealService.get(uid);
}

export const ActiveMealService = {
  /**
   * Fetches `active_meals/{uid}` with seamless AsyncStorage fallback when offline.
   */
  async get(uid: string): Promise<ActiveMealDoc | null> {
    if (!uid) return null;
    const ops = await loadQueue(uid);
    const online = await checkIsOnline();

    if (online) {
      try {
        const res = await runWithOfflineAbort(
          getDocument<ActiveMealDoc>(ACTIVE_MEALS_COLLECTION, uid),
        );
        if (res.completed) {
          const normalized = normalizeMealDoc(res.value, uid);
          lastServerMealByUid.set(uid, normalized);
          const effective = applyPendingOps(normalized, ops, uid);
          await writeCachedMeal(uid, effective);
          return effective;
        }
      } catch (err) {
        if (!isNetworkOrOfflineError(err)) {
          captureError(err, { service: 'active-meal', op: 'get', uid });
        }
      }
    }

    // Offline or fallback: serve from memory or AsyncStorage cache
    if (mealCacheByUid.has(uid)) {
      return mealCacheByUid.get(uid) ?? null;
    }
    const cached = await readCachedMeal(uid);
    const effective = applyPendingOps(cached.data, ops, uid);
    mealCacheByUid.set(uid, effective);
    return effective;
  },

  /**
   * Real-time subscription to `active_meals/{uid}`:
   *  1. Hydrates immediately from in-memory / AsyncStorage cache (works with 0 network).
   *  2. Syncs live via Firestore `onSnapshot`, reconciling pending offline ops and caching every snapshot.
   *  3. Automatically flushes queued offline writes upon reconnect via NetInfo.
   */
  subscribe(uid: string, onData: (meal: ActiveMealDoc | null) => void): () => void {
    if (!uid) {
      onData(null);
      return () => {};
    }

    let entry = subscriptionsByUid.get(uid);
    const isFirstSubscriber = !entry;

    if (!entry) {
      entry = {
        listeners: new Set(),
        unsubFirestore: null,
        unsubNetInfo: null,
        retryTimer: null,
        retryCount: 0,
        wasOffline: false,
      };
      subscriptionsByUid.set(uid, entry);
    }

    entry.listeners.add(onData);

    // 1. Immediate cache hydration (sync if in memory, else async from AsyncStorage)
    let emittedFromServer = false;
    if (mealCacheByUid.has(uid)) {
      onData(mealCacheByUid.get(uid) ?? null);
    } else {
      void (async () => {
        const [cached, ops] = await Promise.all([readCachedMeal(uid), loadQueue(uid)]);
        if (emittedFromServer) return;
        if (!entry?.listeners.has(onData)) return;
        const effective = applyPendingOps(cached.data, ops, uid);
        if (cached.found || ops.length > 0) {
          mealCacheByUid.set(uid, effective);
          onData(effective);
        } else if (cachedOnlineStatus === false) {
          onData(null);
        }
      })();
    }

    if (isFirstSubscriber) {
      // 2. Wire NetInfo for automatic queue flush on reconnect
      void NetInfo.fetch()
        .then((state) => {
          const offline = isNetStateOffline(state);
          cachedOnlineStatus = !offline;
          if (entry) entry.wasOffline = offline;
          if (!offline) {
            void flushQueue(uid);
          } else if (!mealCacheByUid.has(uid)) {
            void readCachedMeal(uid).then(async (cached) => {
              const ops = await loadQueue(uid);
              const effective = applyPendingOps(cached.data, ops, uid);
              mealCacheByUid.set(uid, effective);
              notifyListeners(uid, effective);
            });
          }
        })
        .catch(() => {});

      entry.unsubNetInfo = NetInfo.addEventListener((state) => {
        const offline = isNetStateOffline(state);
        cachedOnlineStatus = !offline;
        if (!entry) return;
        if (!offline && (entry.wasOffline || (queueByUid.get(uid)?.length || 0) > 0)) {
          entry.retryCount = 0;
          void flushQueue(uid);
        }
        entry.wasOffline = offline;
      });

      // 3. Live Firestore snapshot listener
      entry.unsubFirestore = subscribeDocument<ActiveMealDoc>(
        ACTIVE_MEALS_COLLECTION,
        (docData) => {
          emittedFromServer = true;
          void (async () => {
            const normalized = normalizeMealDoc(docData, uid);
            lastServerMealByUid.set(uid, normalized);
            const ops = await loadQueue(uid);
            const effective = applyPendingOps(normalized, ops, uid);
            await writeCachedMeal(uid, effective);
            notifyListeners(uid, effective);
          })();
        },
        (err) => {
          if (!isNetworkOrOfflineError(err)) {
            captureError(err, { service: 'active-meal', op: 'subscribe', uid });
          }
        },
        uid,
      );
    }

    return () => {
      const current = subscriptionsByUid.get(uid);
      if (!current) return;
      current.listeners.delete(onData);
      if (current.listeners.size === 0) {
        if (current.unsubFirestore) current.unsubFirestore();
        if (current.unsubNetInfo) current.unsubNetInfo();
        if (current.retryTimer) clearTimeout(current.retryTimer);
        subscriptionsByUid.delete(uid);
      }
    };
  },

  /**
   * Adds a recipe to `active_meals/{uid}`. Idempotent: duplicate returns `{ success: false, reason: 'duplicate' }`.
   */
  async addToMeal(
    uid: string,
    recipeId: string,
    defaultServings?: number,
  ): Promise<{ success: boolean; reason?: 'duplicate' }> {
    if (!uid || !recipeId) {
      return { success: false };
    }

    try {
      const duplicate = await withQueueLock(uid, async () => {
        const existing = await this.get(uid);
        if (existing && existing.recipeIds.includes(recipeId)) {
          return true;
        }

        const setActive = !existing || !existing.activeRecipeId || existing.recipeIds.length === 0;
        const op: QueuedMealOp = {
          id: makeOpId(),
          type: 'add',
          recipeId,
          ...(typeof defaultServings === 'number' && defaultServings > 0
            ? { defaultServings }
            : {}),
          setActive,
          ts: Date.now(),
        };

        const optimistic = applyOpToMeal(existing, op, uid);
        await writeCachedMeal(uid, optimistic);
        notifyListeners(uid, optimistic);
        await enqueueOpUnlocked(uid, op);
        return false;
      });

      if (duplicate) {
        return { success: false, reason: 'duplicate' };
      }

      await flushQueue(uid);
      return { success: true };
    } catch (err) {
      captureError(err, { service: 'active-meal', op: 'addToMeal', uid, recipeId });
      throw err;
    }
  },

  /**
   * Removes `recipeId` from `recipeIds`, deletes `recipeStates.${recipeId}` via `deleteField()`,
   * and shifts `activeRecipeId` to `index - 1`, then next, else `null`.
   */
  async removeFromMeal(uid: string, recipeId: string): Promise<void> {
    if (!uid || !recipeId) return;

    try {
      await withQueueLock(uid, async () => {
        const current = await getCurrentLocalOrRemoteMeal(uid);
        const nextActiveRecipeId = computeNextActiveAfterRemove(current, recipeId);

        const op: QueuedMealOp = {
          id: makeOpId(),
          type: 'remove',
          recipeId,
          nextActiveRecipeId,
          ts: Date.now(),
        };

        const optimistic = applyOpToMeal(current, op, uid);
        await writeCachedMeal(uid, optimistic);
        notifyListeners(uid, optimistic);
        await enqueueOpUnlocked(uid, op);
      });

      await flushQueue(uid);
    } catch (err) {
      captureError(err, { service: 'active-meal', op: 'removeFromMeal', uid, recipeId });
      throw err;
    }
  },

  /**
   * Switches active tab (`activeRecipeId`) + updates `lastUpdated`.
   */
  async switchRecipe(uid: string, recipeId: string): Promise<void> {
    if (!uid || !recipeId) return;

    try {
      await withQueueLock(uid, async () => {
        const current = await getCurrentLocalOrRemoteMeal(uid);
        const op: QueuedMealOp = {
          id: makeOpId(),
          type: 'switch',
          recipeId,
          ts: Date.now(),
        };

        const optimistic = applyOpToMeal(current, op, uid);
        await writeCachedMeal(uid, optimistic);
        notifyListeners(uid, optimistic);
        await enqueueOpUnlocked(uid, op);
      });

      await flushQueue(uid);
    } catch (err) {
      captureError(err, { service: 'active-meal', op: 'switchRecipe', uid, recipeId });
      throw err;
    }
  },

  /**
   * Patches per-recipe state via Firestore dot-notation (`recipeStates.${recipeId}.${key}`) + `lastUpdated`.
   * Updates local AsyncStorage + optimistic listeners immediately offline and queues for automatic reconnect sync.
   */
  async updateRecipeState(
    uid: string,
    recipeId: string,
    partial: Partial<RecipeMealState>,
  ): Promise<void> {
    if (!uid || !recipeId || !partial) return;

    try {
      await withQueueLock(uid, async () => {
        const current = await getCurrentLocalOrRemoteMeal(uid);
        const op: QueuedMealOp = {
          id: makeOpId(),
          type: 'updateState',
          recipeId,
          partial,
          ts: Date.now(),
        };

        const optimistic = applyOpToMeal(current, op, uid);
        await writeCachedMeal(uid, optimistic);
        notifyListeners(uid, optimistic);
        await enqueueOpUnlocked(uid, op);
      });

      await flushQueue(uid);
    } catch (err) {
      captureError(err, { service: 'active-meal', op: 'updateRecipeState', uid, recipeId });
      throw err;
    }
  },

  /**
   * Deletes `active_meals/{uid}` and clears local cache immediately.
   */
  async clearMeal(uid: string): Promise<void> {
    if (!uid) return;

    try {
      await withQueueLock(uid, async () => {
        const op: QueuedMealOp = {
          id: makeOpId(),
          type: 'clear',
          ts: Date.now(),
        };

        await writeCachedMeal(uid, null);
        notifyListeners(uid, null);
        await enqueueOpUnlocked(uid, op);
      });

      await flushQueue(uid);
    } catch (err) {
      captureError(err, { service: 'active-meal', op: 'clearMeal', uid });
      throw err;
    }
  },

  /**
   * Flushes any queued offline operations for `uid` when connectivity is available.
   */
  async flushPendingOps(uid: string): Promise<void> {
    await flushQueue(uid);
  },
};

export const activeMealService = ActiveMealService;
