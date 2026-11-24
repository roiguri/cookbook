import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { Image as ExpoImage } from 'expo-image';
import { IS_DTU_MODE } from '../_firebase/firebase-app';
import { getDocument } from '../_firebase/firestore-adapter';
import { getStorageDownloadUrl } from '../_firebase/storage-adapter';
import { captureError } from '../logger';

export const GRANDMA_COOKBOOK_COLLECTION = 'cookbook';
export const GRANDMA_COOKBOOK_DOC = 'recipes';
export const GRANDMA_STORAGE_PREFIX = 'grandmas_cookbook/original/';
export const DEFAULT_TOTAL_PAGES = 92;

const PAGE_INDEX_CACHE_PREFIX = 'cookbook:pdf_index:v1:';
const PAGE_URL_CACHE_KEY = 'cookbook:pdf_page_urls:v1';
const LAST_PAGE_STORAGE_PREFIX = 'cookbook:grandma_last_page:v1:';
const FIRESTORE_READ_TIMEOUT_MS = 8_000;

export interface PdfCategoryRange {
  startPage: number;
  endPage?: number;
}

export interface PdfPageIndex {
  categories: Record<string, PdfCategoryRange>;
  recipes: Record<string, number>;
}

export interface TocRecipeEntry {
  name: string;
  page: number;
}

export interface TocCategorySection {
  index: number;
  name: string;
  startPage: number;
  endPage: number;
  recipes: TocRecipeEntry[];
}

const urlMemoryCache = new Map<string, string>();
const urlInFlight = new Map<string, Promise<string>>();
let persistedUrlsHydrated = false;
let persistedUrlsHydrationPromise: Promise<void> | null = null;

function pageIndexCacheKey(collection: string, fileName: string): string {
  return `${PAGE_INDEX_CACHE_PREFIX}${collection}/${fileName}`;
}

function lastPageKey(uid?: string | null): string {
  return `${LAST_PAGE_STORAGE_PREFIX}${uid || 'default'}`;
}

function isNetOffline(state: NetInfoState | null | undefined): boolean {
  if (!state) return false;
  return state.isConnected === false || state.type === 'none';
}

async function isCurrentlyOnline(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return !isNetOffline(state);
  } catch {
    return true;
  }
}

function isPermissionDeniedError(err: unknown): boolean {
  const code = String((err as any)?.code || '').toLowerCase();
  return code === 'permission-denied' || code === 'firestore/permission-denied';
}

function isNetworkOrOfflineError(err: unknown): boolean {
  const code = String((err as any)?.code || '').toLowerCase();
  const msg = String((err as any)?.message || '').toLowerCase();
  return (
    code === 'unavailable' ||
    code === 'firestore/unavailable' ||
    code === 'deadline-exceeded' ||
    msg.includes('offline') ||
    msg.includes('network') ||
    msg.includes('failed to get document') ||
    msg.includes('timeout')
  );
}

function normalizePageIndex(raw: any): PdfPageIndex {
  const categories: Record<string, PdfCategoryRange> = {};
  const rawCategories = raw?.categories;
  if (rawCategories && typeof rawCategories === 'object') {
    for (const [name, range] of Object.entries(rawCategories)) {
      if (!name || !range || typeof range !== 'object') continue;
      const startPage = Number((range as any).startPage);
      const endPageRaw = (range as any).endPage;
      const endPage =
        endPageRaw !== undefined && endPageRaw !== null ? Number(endPageRaw) : undefined;
      if (Number.isFinite(startPage) && startPage > 0) {
        categories[name] = {
          startPage,
          ...(endPage !== undefined && Number.isFinite(endPage) && endPage >= startPage
            ? { endPage }
            : {}),
        };
      }
    }
  }

  const recipes: Record<string, number> = {};
  const rawRecipes = raw?.recipes;
  if (rawRecipes && typeof rawRecipes === 'object') {
    for (const [name, pageVal] of Object.entries(rawRecipes)) {
      if (!name) continue;
      const page = Number(pageVal);
      if (Number.isFinite(page) && page > 0) {
        recipes[name] = page;
      }
    }
  }

  return { categories, recipes };
}

async function readCachedIndex(collection: string, fileName: string): Promise<PdfPageIndex | null> {
  try {
    const raw = await AsyncStorage.getItem(pageIndexCacheKey(collection, fileName));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return normalizePageIndex(parsed);
  } catch {
    return null;
  }
}

async function writeCachedIndex(
  collection: string,
  fileName: string,
  index: PdfPageIndex,
): Promise<void> {
  try {
    await AsyncStorage.setItem(pageIndexCacheKey(collection, fileName), JSON.stringify(index));
  } catch {
    // Best-effort offline cache
  }
}

async function hydratePersistedUrls(): Promise<void> {
  if (persistedUrlsHydrated) return;
  if (persistedUrlsHydrationPromise) {
    await persistedUrlsHydrationPromise;
    return;
  }
  persistedUrlsHydrationPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(PAGE_URL_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          for (const [path, url] of Object.entries(parsed)) {
            if (typeof path === 'string' && typeof url === 'string' && url.length > 0) {
              if (!urlMemoryCache.has(path)) {
                urlMemoryCache.set(path, url);
              }
            }
          }
        }
      }
    } catch {
      // Ignore malformed cache
    } finally {
      persistedUrlsHydrated = true;
      persistedUrlsHydrationPromise = null;
    }
  })();
  await persistedUrlsHydrationPromise;
}

async function persistUrlCache(): Promise<void> {
  try {
    const obj: Record<string, string> = {};
    urlMemoryCache.forEach((url, path) => {
      obj[path] = url;
    });
    await AsyncStorage.setItem(PAGE_URL_CACHE_KEY, JSON.stringify(obj));
  } catch {
    // Best-effort offline cache
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('PdfService request timeout'));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * PdfService — Scanned Grandma's Cookbook Reads & Caching
 *
 * Mirrors Web `src/js/services/pdf/pdf-service.js` while adding mobile offline
 * caching (AsyncStorage manifest + URL cache + `expo-image` disk prefetching)
 * and last-viewed-page persistence.
 */
export class PdfService {
  /**
   * Fetch a scanned PDF's page-index manifest from Firestore (e.g. `cookbook/recipes`).
   * Persists the latest manifest to AsyncStorage and falls back gracefully when offline.
   */
  static async getPageIndex(collection: string, fileName: string): Promise<PdfPageIndex | null> {
    if (!collection || !fileName) {
      throw new Error('PdfService.getPageIndex: collection and fileName are required');
    }

    const online = await isCurrentlyOnline();
    if (!online) {
      return readCachedIndex(collection, fileName);
    }

    try {
      const doc = await withTimeout(
        getDocument<PdfPageIndex>(collection, fileName),
        FIRESTORE_READ_TIMEOUT_MS,
      );
      if (!doc) return null;
      const normalized = normalizePageIndex(doc);
      void writeCachedIndex(collection, fileName, normalized);
      return normalized;
    } catch (err) {
      if (isPermissionDeniedError(err)) {
        captureError(err, { service: 'pdf', op: 'getPageIndex', collection, fileName });
        throw err;
      }

      const cached = await readCachedIndex(collection, fileName);
      if (cached) {
        return cached;
      }

      if (!isNetworkOrOfflineError(err)) {
        captureError(err, { service: 'pdf', op: 'getPageIndex', collection, fileName });
      }
      throw err;
    }
  }

  /**
   * Read the cached manifest directly from AsyncStorage (caller must still enforce role gate).
   */
  static async getCachedPageIndex(
    collection: string,
    fileName: string,
  ): Promise<PdfPageIndex | null> {
    if (!collection || !fileName) return null;
    return readCachedIndex(collection, fileName);
  }

  /**
   * Derive total page count:
   * - Staging / Production: 92 (matching `documents-page.html` `total-pages="92"`).
   * - DTU E2E mode: `Math.max(...categoryEndPages, ...categoryStartPages, ...recipePages, 1)`
   *   (yielding `3` for seeded DTU fixtures).
   */
  static getTotalPages(pageIndex: PdfPageIndex | null | undefined): number {
    if (!IS_DTU_MODE) {
      return DEFAULT_TOTAL_PAGES;
    }
    const pages: number[] = [1];
    if (pageIndex?.categories) {
      for (const range of Object.values(pageIndex.categories)) {
        const start = Number(range?.startPage);
        const end = Number(range?.endPage);
        if (Number.isFinite(start) && start > 0) pages.push(start);
        if (Number.isFinite(end) && end > 0) pages.push(end);
      }
    }
    if (pageIndex?.recipes) {
      for (const pageVal of Object.values(pageIndex.recipes)) {
        const page = Number(pageVal);
        if (Number.isFinite(page) && page > 0) pages.push(page);
      }
    }
    return Math.max(...pages, 1);
  }

  /**
   * Build the Storage path for a 1-based scanned cookbook page image.
   */
  static getPageStoragePath(pageNumber: number, prefix: string = GRANDMA_STORAGE_PREFIX): string {
    return `${prefix}page.${pageNumber}.jpg`;
  }

  /**
   * Synchronously read an already-resolved page URL from memory for flicker-free turning.
   */
  static getCachedPageUrlSync(pageNumber: number): string | null {
    return urlMemoryCache.get(PdfService.getPageStoragePath(pageNumber)) ?? null;
  }

  /**
   * Resolve a download URL for a scanned-PDF page image stored in Firebase Storage
   * (e.g. `grandmas_cookbook/original/page.1.jpg`), with memory + AsyncStorage caching.
   */
  static async getPageImageUrl(path: string): Promise<string> {
    if (!path) {
      throw new Error('PdfService.getPageImageUrl: path is required');
    }

    await hydratePersistedUrls();

    const cached = urlMemoryCache.get(path);
    if (cached) {
      return cached;
    }

    const existing = urlInFlight.get(path);
    if (existing) {
      return existing;
    }

    const req = (async () => {
      try {
        const url = await getStorageDownloadUrl(path);
        urlMemoryCache.set(path, url);
        void persistUrlCache();
        return url;
      } catch (err) {
        if (!isNetworkOrOfflineError(err)) {
          captureError(err, { service: 'pdf', op: 'getPageImageUrl' });
        }
        throw err;
      } finally {
        urlInFlight.delete(path);
      }
    })();

    urlInFlight.set(path, req);
    return req;
  }

  /**
   * Resolve download URL for a 1-based Grandma's Cookbook page number.
   */
  static async getPageUrl(pageNumber: number): Promise<string> {
    return PdfService.getPageImageUrl(PdfService.getPageStoragePath(pageNumber));
  }

  /**
   * Invalidate a cached URL (e.g., if a Storage download token expired) so retry fetches fresh.
   */
  static async invalidatePageImageUrl(path: string): Promise<void> {
    if (!path) return;
    urlMemoryCache.delete(path);
    await persistUrlCache();
  }

  /**
   * Prefetch adjacent pages (`n - 1` and `n + 1`) into `expo-image` disk cache for
   * smooth, flicker-free page turns and offline revisits.
   */
  static async prefetchAdjacentPages(currentPage: number, totalPages: number): Promise<void> {
    const candidates = [currentPage - 1, currentPage + 1].filter((p) => p >= 1 && p <= totalPages);
    if (candidates.length === 0) return;

    const urls: string[] = [];
    await Promise.all(
      candidates.map(async (pageNum) => {
        try {
          const url = await PdfService.getPageUrl(pageNum);
          if (url) urls.push(url);
        } catch {
          // Best-effort background prefetch
        }
      }),
    );

    if (urls.length > 0) {
      try {
        await ExpoImage.prefetch(urls, 'disk');
      } catch {
        // Best-effort disk prefetch
      }
    }
  }

  /**
   * Read the user's last viewed page number from AsyncStorage, clamped to `1..totalPages`.
   */
  static async getLastViewedPage(totalPages: number, uid?: string | null): Promise<number> {
    const maxPage = Math.max(1, totalPages);
    try {
      const raw = await AsyncStorage.getItem(lastPageKey(uid));
      if (!raw) return 1;
      const parsed = parseInt(raw, 10);
      if (!Number.isFinite(parsed)) return 1;
      return Math.max(1, Math.min(parsed, maxPage));
    } catch {
      return 1;
    }
  }

  /**
   * Persist the user's current page number locally so revisiting resumes where they left off.
   */
  static async saveLastViewedPage(pageNumber: number, uid?: string | null): Promise<void> {
    if (!Number.isFinite(pageNumber) || pageNumber < 1) return;
    try {
      await AsyncStorage.setItem(lastPageKey(uid), String(Math.floor(pageNumber)));
    } catch {
      // Best-effort local persistence
    }
  }

  /**
   * Build sorted 2-level Table of Contents sections matching Web `pdf_viewer.js`:
   * categories sorted ascending by `startPage`, each containing recipes falling
   * within its `[startPage, endPage]` range sorted by page number.
   */
  static buildTocSections(
    pageIndex: PdfPageIndex | null | undefined,
    totalPages: number,
  ): TocCategorySection[] {
    if (!pageIndex) return [];

    const sortedCategories = Object.entries(pageIndex.categories || {}).sort(
      ([, a], [, b]) => Number(a.startPage) - Number(b.startPage),
    );

    const sections: TocCategorySection[] = sortedCategories.map(([name, range], idx) => {
      const startPage = Math.max(1, Number(range.startPage) || 1);
      const nextStart =
        idx + 1 < sortedCategories.length ? Number(sortedCategories[idx + 1][1].startPage) : null;
      const derivedEnd =
        typeof range.endPage === 'number' && Number.isFinite(range.endPage)
          ? Math.max(startPage, range.endPage)
          : nextStart && Number.isFinite(nextStart)
            ? Math.max(startPage, nextStart - 1)
            : Math.max(startPage, totalPages);

      return {
        index: idx,
        name,
        startPage,
        endPage: derivedEnd,
        recipes: [],
      };
    });

    const orphanRecipes: TocRecipeEntry[] = [];
    for (const [recipeName, pageVal] of Object.entries(pageIndex.recipes || {})) {
      const page = Number(pageVal);
      if (!Number.isFinite(page) || page < 1) continue;
      const target = sections.find((s) => page >= s.startPage && page <= s.endPage);
      if (target) {
        target.recipes.push({ name: recipeName, page });
      } else {
        orphanRecipes.push({ name: recipeName, page });
      }
    }

    for (const section of sections) {
      section.recipes.sort((a, b) => a.page - b.page || a.name.localeCompare(b.name, 'he'));
    }

    if (orphanRecipes.length > 0) {
      orphanRecipes.sort((a, b) => a.page - b.page || a.name.localeCompare(b.name, 'he'));
      sections.push({
        index: sections.length,
        name: 'מתכונים נוספים',
        startPage: orphanRecipes[0].page,
        endPage: orphanRecipes[orphanRecipes.length - 1].page,
        recipes: orphanRecipes,
      });
    }

    return sections;
  }

  static getCategoryForPage(
    sections: TocCategorySection[],
    pageNumber: number,
  ): TocCategorySection | null {
    return sections.find((s) => pageNumber >= s.startPage && pageNumber <= s.endPage) ?? null;
  }

  static getRecipesForPage(sections: TocCategorySection[], pageNumber: number): TocRecipeEntry[] {
    const matches: TocRecipeEntry[] = [];
    for (const section of sections) {
      for (const recipe of section.recipes) {
        if (recipe.page === pageNumber) {
          matches.push(recipe);
        }
      }
    }
    return matches;
  }
}

export const pdfService = PdfService;
