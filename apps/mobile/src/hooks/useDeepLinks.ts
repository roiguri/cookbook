import { useEffect, useRef, useState } from 'react';
import * as Linking from 'expo-linking';
import { router, usePathname, useRootNavigationState, type Href } from 'expo-router';
import { useSession } from '@/context/SessionContext';
import { captureError } from '@/services/logger';

const APP_SCHEMES = new Set(['cookbook-e2e', 'cookbook-staging', 'cookbook']);
const WEB_SCHEMES = new Set(['http', 'https']);

export interface ResolvedAppRoute {
  href: Href;
  canonicalPathname: string;
  hasParams: boolean;
  requiresAuthHydration: boolean;
}

interface PendingDeepLink {
  id: number;
  source: 'initial' | 'event';
  route: ResolvedAppRoute;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

function parseQueryString(queryStr: string): Record<string, string> {
  const params: Record<string, string> = {};
  if (!queryStr) return params;
  const cleaned = queryStr.startsWith('?') ? queryStr.slice(1) : queryStr;
  for (const pair of cleaned.split('&')) {
    if (!pair) continue;
    const eqIdx = pair.indexOf('=');
    const rawKey = eqIdx === -1 ? pair : pair.slice(0, eqIdx);
    const rawVal = eqIdx === -1 ? '' : pair.slice(eqIdx + 1);
    const key = safeDecode(rawKey).trim();
    if (!key) continue;
    params[key] = safeDecode(rawVal);
  }
  return params;
}

function extractPathAndQuery(
  rawUrl: string,
): { path: string; query: Record<string, string> } | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  const hashIdx = trimmed.indexOf('#');
  const withoutHash = hashIdx === -1 ? trimmed : trimmed.slice(0, hashIdx);

  const qIdx = withoutHash.indexOf('?');
  const beforeQuery = qIdx === -1 ? withoutHash : withoutHash.slice(0, qIdx);
  const queryStr = qIdx === -1 ? '' : withoutHash.slice(qIdx + 1);
  const query = parseQueryString(queryStr);

  // Relative in-app route (e.g. from FCM push data.url = '/dashboard' or '/(tabs)/dashboard')
  if (beforeQuery.startsWith('/')) {
    return { path: beforeQuery, query };
  }

  const schemeMatch = beforeQuery.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(.*)$/);
  if (!schemeMatch) {
    return null;
  }

  const scheme = schemeMatch[1].toLowerCase();
  const rest = schemeMatch[2];

  if (APP_SCHEMES.has(scheme)) {
    // Supports both `cookbook-e2e://recipe/123` and `cookbook-e2e:///recipe/123`
    const normalized = rest.replace(/^\/+/, '');
    return { path: `/${normalized}`, query };
  }

  if (WEB_SCHEMES.has(scheme)) {
    const firstSlash = rest.indexOf('/');
    const pathname = firstSlash === -1 ? '/' : rest.slice(firstSlash);
    return { path: pathname, query };
  }

  if (scheme === 'exp' || scheme === 'exps') {
    const markerIdx = rest.indexOf('/--/');
    if (markerIdx === -1) return null;
    const afterMarker = rest.slice(markerIdx + 4).replace(/^\/+/, '');
    return { path: `/${afterMarker}`, query };
  }

  return null;
}

/**
 * Pure URL-to-Expo-Router resolver shared between deep links and push notification taps.
 * Handles custom schemes (`cookbook-e2e://`, `cookbook-staging://`, `cookbook://`),
 * HTTPS App Links / Universal Links, and relative push payload paths.
 */
export function resolveAppRoute(rawUrl: string): ResolvedAppRoute | null {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;

  const extracted = extractPathAndQuery(rawUrl);
  if (!extracted) return null;

  const { query } = extracted;
  const cleanPath = extracted.path.replace(/^\/\(tabs\)(?=\/|$)/, '').replace(/\/+$/, '') || '/';

  // /recipe/:id -> /recipe/<id>
  if (cleanPath.startsWith('/recipe/')) {
    const rawId = cleanPath.slice('/recipe/'.length).split('/')[0] || '';
    const id = safeDecode(rawId).trim();
    if (!id) return null;
    const encodedId = encodeURIComponent(id);
    return {
      href: `/recipe/${encodedId}` as Href,
      canonicalPathname: `/recipe/${id}`,
      hasParams: false,
      requiresAuthHydration: false,
    };
  }

  // /categories?category=...&q=...&favorites=true
  if (cleanPath === '/categories') {
    const params: Record<string, string> = {};
    if (query.category) params.category = query.category;
    if (query.q) params.q = query.q;
    if (query.favorites) {
      params.favorites = query.favorites === '1' ? 'true' : query.favorites;
    }
    if (query.focusSearch) params.focusSearch = query.focusSearch;
    const hasParams = Object.keys(params).length > 0;
    return {
      href: hasParams
        ? ({ pathname: '/(tabs)/categories', params } as Href)
        : ('/(tabs)/categories' as Href),
      canonicalPathname: '/categories',
      hasParams,
      requiresAuthHydration: params.favorites === 'true',
    };
  }

  // /my-recipes?view=all|mine|saved|shared|to-try
  if (cleanPath === '/my-recipes') {
    const params: Record<string, string> = {};
    if (query.view) params.view = query.view;
    if (query.category) params.category = query.category;
    if (query.q) params.q = query.q;
    const hasParams = Object.keys(params).length > 0;
    return {
      href: hasParams
        ? ({ pathname: '/(tabs)/my-recipes', params } as Href)
        : ('/(tabs)/my-recipes' as Href),
      canonicalPathname: '/my-recipes',
      hasParams,
      requiresAuthHydration: true,
    };
  }

  // /my-meal
  if (cleanPath === '/my-meal') {
    return {
      href: '/(tabs)/my-meal' as Href,
      canonicalPathname: '/my-meal',
      hasParams: false,
      requiresAuthHydration: true,
    };
  }

  // /grandmas-cooking
  if (cleanPath === '/grandmas-cooking') {
    return {
      href: '/(tabs)/grandmas-cooking' as Href,
      canonicalPathname: '/grandmas-cooking',
      hasParams: false,
      requiresAuthHydration: true,
    };
  }

  // /dashboard (including ?fromPush=1)
  if (cleanPath === '/dashboard') {
    return {
      href: '/(tabs)/dashboard' as Href,
      canonicalPathname: '/dashboard',
      hasParams: false,
      requiresAuthHydration: true,
    };
  }

  // /games
  if (cleanPath === '/games') {
    return {
      href: '/games' as Href,
      canonicalPathname: '/games',
      hasParams: false,
      requiresAuthHydration: false,
    };
  }

  // /propose-recipe?importUrl=...
  if (cleanPath === '/propose-recipe') {
    const params: Record<string, string> = {};
    const importUrl = query.importUrl || query.importurl || '';
    if (importUrl) params.importUrl = importUrl;
    const hasParams = Object.keys(params).length > 0;
    return {
      href: hasParams
        ? ({ pathname: '/(tabs)/propose-recipe', params } as Href)
        : ('/(tabs)/propose-recipe' as Href),
      canonicalPathname: '/propose-recipe',
      hasParams,
      requiresAuthHydration: true,
    };
  }

  // /home
  if (cleanPath === '/home') {
    return {
      href: '/(tabs)/home' as Href,
      canonicalPathname: '/home',
      hasParams: false,
      requiresAuthHydration: false,
    };
  }

  return null;
}

/**
 * Handles both cold-start (`getInitialURL`) and warm-resume (`addEventListener('url')`)
 * deep links across custom schemes and HTTPS App Links / Universal Links.
 * Defers gated routes until SessionContext auth & profile hydration completes.
 */
export function useDeepLinks(): void {
  const { loading: sessionLoading } = useSession();
  const rootNavState = useRootNavigationState();
  const pathname = usePathname();

  const [pendingLink, setPendingLink] = useState<PendingDeepLink | null>(null);
  const seqRef = useRef(0);
  const initialHandledRef = useRef(false);
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const navReady = Boolean(rootNavState?.key);

  useEffect(() => {
    let active = true;

    const enqueueUrl = (rawUrl: string | null | undefined, source: 'initial' | 'event') => {
      if (!active || !rawUrl) return;
      const route = resolveAppRoute(rawUrl);
      if (!route) return;
      seqRef.current += 1;
      setPendingLink({ id: seqRef.current, source, route });
    };

    if (!initialHandledRef.current) {
      initialHandledRef.current = true;
      Linking.getInitialURL()
        .then((initialUrl) => {
          enqueueUrl(initialUrl, 'initial');
        })
        .catch((err) => {
          captureError(err, { service: 'deep-links', op: 'getInitialURL' });
        });
    }

    const sub = Linking.addEventListener('url', ({ url }) => {
      enqueueUrl(url, 'event');
    });

    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (!pendingLink || !navReady) return;
    if (pendingLink.route.requiresAuthHydration && sessionLoading) return;

    const { route, source } = pendingLink;
    setPendingLink(null);

    // Avoid stacking a duplicate route on cold start when Expo Router already
    // resolved the exact parameterless target screen natively.
    if (
      source === 'initial' &&
      !route.hasParams &&
      pathnameRef.current === route.canonicalPathname
    ) {
      return;
    }

    try {
      router.push(route.href);
    } catch (err) {
      captureError(err, { service: 'deep-links', op: 'navigate' });
    }
  }, [pendingLink, navReady, sessionLoading]);
}
