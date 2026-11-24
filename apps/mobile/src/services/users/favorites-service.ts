import AsyncStorage from '@react-native-async-storage/async-storage';
import { arrayRemove, arrayUnion } from '../_firebase/firestore-adapter';
import { captureError } from '../logger';
import { UserService } from './user-service';

export interface FavoriteChangeDetail {
  recipeId: string;
  isFavorite: boolean;
  userId: string;
}

type FavoriteChangeListener = (detail: FavoriteChangeDetail) => void;

const CACHE_KEY_PREFIX = 'cookbook:cache:favorites:';

interface FavoritesCacheState {
  uid: string | null;
  ids: string[];
  loaded: boolean;
}

let cache: FavoritesCacheState = {
  uid: null,
  ids: [],
  loaded: false,
};

let inFlightUid: string | null = null;
let inFlightPromise: Promise<string[]> | null = null;
const listeners = new Set<FavoriteChangeListener>();

function emitFavoriteChange(detail: FavoriteChangeDetail): void {
  for (const listener of Array.from(listeners)) {
    try {
      listener(detail);
    } catch {
      // Never let one subscriber break others
    }
  }
}

async function saveOfflineFavorites(uid: string, ids: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(`${CACHE_KEY_PREFIX}${uid}`, JSON.stringify(ids));
  } catch {
    // Best-effort offline cache
  }
}

async function readOfflineFavorites(uid: string): Promise<string[] | null> {
  try {
    const raw = await AsyncStorage.getItem(`${CACHE_KEY_PREFIX}${uid}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

function updateMemoryCache(uid: string, recipeId: string, isFavorite: boolean): string[] {
  if (cache.uid !== uid) {
    cache = { uid, ids: [], loaded: false };
  }
  const nextSet = new Set(cache.ids);
  if (isFavorite) {
    nextSet.add(recipeId);
  } else {
    nextSet.delete(recipeId);
  }
  cache.ids = Array.from(nextSet);
  return [...cache.ids];
}

export const FavoritesService = {
  /**
   * Fetch user's favorite recipe IDs from `users/{uid}.favorites` with in-memory
   * deduplication and AsyncStorage offline fallback.
   */
  async getFavoriteIds(uid: string): Promise<string[]> {
    if (!uid) return [];

    if (cache.uid === uid && cache.loaded) {
      return [...cache.ids];
    }

    if (inFlightPromise && inFlightUid === uid) {
      return inFlightPromise;
    }

    inFlightUid = uid;
    inFlightPromise = (async () => {
      try {
        const userDoc = await UserService.get(uid);
        const ids = Array.isArray(userDoc?.favorites)
          ? userDoc.favorites.filter((id): id is string => typeof id === 'string')
          : [];
        cache = { uid, ids, loaded: true };
        void saveOfflineFavorites(uid, ids);
        return [...ids];
      } catch (err) {
        const offline = await readOfflineFavorites(uid);
        if (offline) {
          cache = { uid, ids: offline, loaded: true };
          return [...offline];
        }
        captureError(err, { service: 'favorites', op: 'getFavoriteIds', uid });
        return cache.uid === uid ? [...cache.ids] : [];
      } finally {
        if (inFlightUid === uid) {
          inFlightUid = null;
          inFlightPromise = null;
        }
      }
    })();

    return inFlightPromise;
  },

  /**
   * Toggle membership of `recipeId` in `users/{uid}.favorites` via `UserService`
   * with immediate optimistic broadcast and rollback on error.
   * Returns the new favorite state (`true` = favorited, `false` = removed).
   */
  async toggleFavorite(
    uid: string,
    recipeId: string,
    currentFavorites?: string[],
  ): Promise<boolean> {
    if (!uid) throw new Error('FavoritesService.toggleFavorite: uid is required');
    if (!recipeId) throw new Error('FavoritesService.toggleFavorite: recipeId is required');

    let baseline: string[];
    if (Array.isArray(currentFavorites)) {
      baseline = [...currentFavorites];
      if (cache.uid !== uid || !cache.loaded) {
        cache = { uid, ids: [...baseline], loaded: true };
      }
    } else {
      baseline = await FavoritesService.getFavoriteIds(uid);
    }

    const wasFavorite = baseline.includes(recipeId);
    const nextIsFavorite = !wasFavorite;

    // Optimistic update + immediate cross-screen broadcast
    const optimisticIds = updateMemoryCache(uid, recipeId, nextIsFavorite);
    emitFavoriteChange({ recipeId, isFavorite: nextIsFavorite, userId: uid });

    try {
      await UserService.update(uid, {
        favorites: (nextIsFavorite ? arrayUnion(recipeId) : arrayRemove(recipeId)) as any,
      });
      void saveOfflineFavorites(uid, optimisticIds);
      return nextIsFavorite;
    } catch (err) {
      // Roll back memory cache and notify subscribers
      updateMemoryCache(uid, recipeId, wasFavorite);
      emitFavoriteChange({ recipeId, isFavorite: wasFavorite, userId: uid });
      captureError(err, { service: 'favorites', op: 'toggleFavorite', uid, recipeId });
      throw err;
    }
  },

  /**
   * Subscribe to cross-screen favorite toggle broadcasts (Home, Categories, My Recipes).
   */
  subscribeFavoriteChanges(cb: FavoriteChangeListener): () => void {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },

  /**
   * Clear cached favorites (e.g. on sign-out or user switch).
   */
  clearCache(): void {
    cache = { uid: null, ids: [], loaded: false };
    inFlightUid = null;
    inFlightPromise = null;
  },
};
