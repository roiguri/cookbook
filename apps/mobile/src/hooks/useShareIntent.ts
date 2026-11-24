import { useCallback, useEffect, useRef, useState } from 'react';
import * as Linking from 'expo-linking';
import { parseYouTubeUrl } from '@cookbook/core/youtube-url';
import type { RecipeImportMode } from '@/services/recipes/recipe-import-service';

export interface IncomingSharePayload {
  /** Auto-selected AI import tab: 'video' (YouTube), 'url' (web link), or 'image' (photo). */
  mode: RecipeImportMode;
  url?: string;
  imageUris?: string[];
  signature: string;
}

export interface ShareRouteParams {
  importUrl?: string | string[];
  url?: string | string[];
  sharedText?: string | string[];
  text?: string | string[];
  importImage?: string | string[];
  imageUri?: string | string[];
}

const HTTP_URL_RE = /(https?:\/\/[^\s"'<>]+)/i;
const IMAGE_URI_RE = /^(file:\/\/|content:\/\/|ph:\/\/|assets-library:\/\/|data:image\/)/i;

function firstParam(val?: string | string[]): string {
  if (Array.isArray(val)) return String(val[0] || '').trim();
  return typeof val === 'string' ? val.trim() : '';
}

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function extractHttpUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const match = trimmed.match(HTTP_URL_RE);
  if (match && match[1]) {
    // Trim trailing punctuation commonly attached in shared sentences
    return match[1].replace(/[),.;!?]+$/, '');
  }
  return null;
}

/**
 * Pure classifier: turns an incoming URL, shared text snippet, or local image URI
 * into a normalized `IncomingSharePayload` that auto-selects the matching AI Import tab:
 *   - YouTube URL (matched via `@cookbook/core/youtube-url` `parseYouTubeUrl`) -> `'video'`
 *   - Any other HTTP(S) URL -> `'url'`
 *   - Image URI (`file://`, `content://`, `ph://`, `data:image/`) -> `'image'`
 */
export function classifySharedInput(input: {
  url?: string;
  text?: string;
  imageUri?: string;
}): IncomingSharePayload | null {
  const imageUri = (input.imageUri || '').trim();
  if (imageUri && IMAGE_URI_RE.test(imageUri)) {
    return {
      mode: 'image',
      imageUris: [imageUri],
      signature: `image:${imageUri}`,
    };
  }

  const candidateRaw = (input.url || input.text || '').trim();
  if (!candidateRaw) return null;

  if (IMAGE_URI_RE.test(candidateRaw)) {
    return {
      mode: 'image',
      imageUris: [candidateRaw],
      signature: `image:${candidateRaw}`,
    };
  }

  const decoded =
    candidateRaw.startsWith('http%3A') || candidateRaw.startsWith('https%3A')
      ? safeDecode(candidateRaw)
      : candidateRaw;
  const extractedUrl = extractHttpUrl(decoded);
  if (!extractedUrl) return null;

  const yt = parseYouTubeUrl(extractedUrl);
  if (yt && yt.videoId) {
    return {
      mode: 'video',
      url: extractedUrl,
      signature: `video:${extractedUrl}`,
    };
  }

  try {
    const parsed = new URL(extractedUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return {
        mode: 'url',
        url: extractedUrl,
        signature: `url:${extractedUrl}`,
      };
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Parses an incoming Linking URL (e.g. `cookbook-e2e://propose-recipe?importUrl=...`,
 * `cookbook-staging://propose-recipe?importUrl=...`, or an Android share intent URI)
 * into an `IncomingSharePayload`, or `null` if the URL carries no share/import target.
 */
export function parseShareDeepLink(rawUrl: string | null | undefined): IncomingSharePayload | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  // Direct content/file image URI from Android ACTION_SEND
  if (IMAGE_URI_RE.test(trimmed)) {
    return classifySharedInput({ imageUri: trimmed });
  }

  // Raw http(s) URL passed directly
  if (/^https?:\/\//i.test(trimmed)) {
    return classifySharedInput({ url: trimmed });
  }

  try {
    const parsed = Linking.parse(trimmed);
    const qp = parsed.queryParams || {};
    const importUrl =
      firstParam(qp.importUrl as string | string[] | undefined) ||
      firstParam(qp.url as string | string[] | undefined) ||
      firstParam(qp.sharedUrl as string | string[] | undefined);
    const sharedText =
      firstParam(qp.sharedText as string | string[] | undefined) ||
      firstParam(qp.text as string | string[] | undefined) ||
      firstParam(qp['android.intent.extra.TEXT'] as string | string[] | undefined);
    const importImage =
      firstParam(qp.importImage as string | string[] | undefined) ||
      firstParam(qp.imageUri as string | string[] | undefined) ||
      firstParam(qp['android.intent.extra.STREAM'] as string | string[] | undefined);

    return classifySharedInput({
      url: importUrl,
      text: sharedText,
      imageUri: importImage,
    });
  } catch {
    return null;
  }
}

/**
 * Hook that unifies:
 *   1. Expo Router search params (`?importUrl=...`, `?importImage=...`, `?sharedText=...`)
 *      from deep-link share handoffs (`cookbook-e2e://propose-recipe?importUrl=...`,
 *      `cookbook-staging://propose-recipe?importUrl=...`).
 *   2. Cold-start & warm-start `expo-linking` events (`Linking.getInitialURL` & `addEventListener('url')`)
 *      including Android `ACTION_SEND` text/image intent URIs.
 *
 * Automatically classifies YouTube URLs (`parseYouTubeUrl`) to `mode: 'video'` (`מסרטון YouTube`),
 * standard web links to `mode: 'url'` (`מכתובת URL`), and local images to `mode: 'image'` (`מתמונה`).
 */
export function useShareIntent(routeParams?: ShareRouteParams) {
  const [pendingShare, setPendingShare] = useState<IncomingSharePayload | null>(null);
  const lastConsumedSignatureRef = useRef<string | null>(null);

  const acceptPayload = useCallback((payload: IncomingSharePayload | null) => {
    if (!payload) return;
    if (lastConsumedSignatureRef.current === payload.signature) return;
    lastConsumedSignatureRef.current = payload.signature;
    setPendingShare(payload);
  }, []);

  const routeUrl = firstParam(routeParams?.importUrl) || firstParam(routeParams?.url);
  const routeText = firstParam(routeParams?.sharedText) || firstParam(routeParams?.text);
  const routeImage = firstParam(routeParams?.importImage) || firstParam(routeParams?.imageUri);

  // 1. Watch Expo Router route search params
  useEffect(() => {
    const payload = classifySharedInput({
      url: routeUrl,
      text: routeText,
      imageUri: routeImage,
    });
    if (payload) {
      acceptPayload(payload);
    }
  }, [routeUrl, routeText, routeImage, acceptPayload]);

  // 2. Watch native Linking initial URL & live URL events (Android ACTION_SEND + iOS/Android deep links)
  useEffect(() => {
    let active = true;
    Linking.getInitialURL()
      .then((initialUrl) => {
        if (!active || !initialUrl) return;
        const payload = parseShareDeepLink(initialUrl);
        if (payload) acceptPayload(payload);
      })
      .catch(() => {});

    const sub = Linking.addEventListener('url', (event) => {
      if (!active || !event?.url) return;
      const payload = parseShareDeepLink(event.url);
      if (payload) acceptPayload(payload);
    });

    return () => {
      active = false;
      sub.remove();
    };
  }, [acceptPayload]);

  const clearPendingShare = useCallback(() => {
    setPendingShare(null);
  }, []);

  return {
    pendingShare,
    clearPendingShare,
  };
}
