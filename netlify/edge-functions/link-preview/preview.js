/**
 * Link previews: the <head> tags that WhatsApp, Telegram, iMessage and the like
 * read when a link is pasted. Their bots don't run our JavaScript, so the edge
 * function (index.js) writes these into the HTML before it's returned.
 *
 * Pure helpers (no Netlify or Deno APIs), so Jest tests them directly.
 * Plan: docs/feature-plans/recipe-sharing.md (R2).
 */
import {
  CATEGORY_MAP,
  formatCookingTime,
} from '../../../src/js/utils/recipes/recipe-data-utils.js';

export const SITE_DESCRIPTION = 'ספר המתכונים של המשפחה';

/** The branded card for pages without a photo of their own (public/img/og/). */
export const FALLBACK_IMAGE = { path: '/img/og/link-preview-v1.jpg', width: 1200, height: 630 };

const DESCRIPTION_MAX = 200;

/** The recipe id in a `/recipe/:id` path, or null for any other page. */
export function recipeIdFromPath(pathname) {
  const match = /^\/recipe\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/** A Firestore REST value (`{stringValue: …}`, `{mapValue: …}`, …) as plain JS. */
export function fromFirestoreValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in value) return fromFirestoreFields(value.mapValue.fields);
  return null;
}

export function fromFirestoreFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, fromFirestoreValue(value)]),
  );
}

const RECIPE_FIELDS = [
  'name',
  'description',
  'category',
  'prepTime',
  'servings',
  'images',
  'visibility',
];

/**
 * A published recipe, read signed out through the Firestore REST API, or null.
 * The security rules refuse private recipes (403) and report missing ones (404);
 * the visibility check below is a second guard.
 * @param {string} recipeId
 * @param {{projectId: string, apiKey: string}} site
 * @param {typeof fetch} [fetchImpl]
 */
export async function fetchPublishedRecipe(recipeId, site, fetchImpl = fetch) {
  const mask = RECIPE_FIELDS.map((field) => `mask.fieldPaths=${field}`).join('&');
  const url =
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(site.projectId)}` +
    `/databases/(default)/documents/recipes/${encodeURIComponent(recipeId)}` +
    `?key=${encodeURIComponent(site.apiKey)}&${mask}`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout?.(2000) });
  if (!response.ok) return null;
  const recipe = fromFirestoreFields((await response.json()).fields);
  return recipe.visibility === 'published' ? recipe : null;
}

/**
 * The recipe's primary public photo as its 1080px WebP variant (made by the
 * resize extension), or null. Family-only photos (`access` other than
 * 'public') never appear in a preview.
 */
export function previewImagePath(recipe) {
  const images = (recipe.images || []).filter(
    (image) => image && typeof image === 'object' && image.access === 'public' && image.full,
  );
  const image = images.find((candidate) => candidate.isPrimary) || images[0];
  return image ? image.full.replace(/\.[^./]+$/, '_1080x1080.webp') : null;
}

/** A public Storage file's download URL (recipe photos are publicly readable). */
export function storageUrl(bucket, path) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media`;
}

function recipeDescription(recipe) {
  const own = (recipe.description || '').trim().replace(/\s+/g, ' ');
  if (own) {
    return own.length > DESCRIPTION_MAX ? `${own.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…` : own;
  }
  const line = [
    CATEGORY_MAP[recipe.category] || '',
    recipe.prepTime ? `${formatCookingTime(recipe.prepTime)} הכנה` : '',
    recipe.servings ? `${recipe.servings} מנות` : '',
  ].filter(Boolean);
  return line.length ? line.join(' · ') : SITE_DESCRIPTION;
}

/**
 * What a page previews as: its <title> and its meta tags.
 * @param {Object} params
 * @param {Object|null} params.recipe - The published recipe, or null for any
 *   other page (and for private or missing recipes).
 * @param {URL} params.url - The requested page.
 * @param {{title: string, bucket: string}} params.site
 * @returns {{title: string, tags: Array<[string, string, string]>}} Tags as
 *   [attribute, key, content], e.g. ['property', 'og:title', '…'].
 */
export function previewFor({ recipe, url, site }) {
  const pageUrl = `${url.origin}${url.pathname}`;
  const photo = recipe && previewImagePath(recipe);
  const image = photo
    ? { url: storageUrl(site.bucket, photo) }
    : { ...FALLBACK_IMAGE, url: `${url.origin}${FALLBACK_IMAGE.path}` };
  const title = recipe ? recipe.name : site.title;
  const description = recipe ? recipeDescription(recipe) : SITE_DESCRIPTION;

  const tags = [
    ['name', 'description', description],
    ['property', 'og:type', recipe ? 'article' : 'website'],
    ['property', 'og:site_name', site.title],
    ['property', 'og:locale', 'he_IL'],
    ['property', 'og:title', title],
    ['property', 'og:description', description],
    ['property', 'og:url', pageUrl],
    ['property', 'og:image', image.url],
    ...(image.width
      ? [
          ['property', 'og:image:width', String(image.width)],
          ['property', 'og:image:height', String(image.height)],
        ]
      : []),
    ['property', 'og:image:alt', title],
    ['name', 'twitter:card', 'summary_large_image'],
  ];
  return { title: recipe ? `${recipe.name} - ${site.title}` : site.title, tags };
}

const escapeHtml = (text) =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const BLOCK = /<!-- link-preview:start -->[\s\S]*?<!-- link-preview:end -->/;

/**
 * The page with its preview: the <title> replaced, and the default tags between
 * index.html's `link-preview` markers swapped for this page's.
 */
export function injectPreview(html, { title, tags }) {
  const block = [
    '<!-- link-preview:start -->',
    ...tags.map(
      ([attribute, key, content]) =>
        `<meta ${attribute}="${escapeHtml(key)}" content="${escapeHtml(content)}" />`,
    ),
    '<!-- link-preview:end -->',
  ].join('\n    ');
  // Replacer functions, so a `$` in a recipe name isn't read as a pattern.
  const withTitle = html.replace(
    /<title>[\s\S]*?<\/title>/,
    () => `<title>${escapeHtml(title)}</title>`,
  );
  return BLOCK.test(withTitle)
    ? withTitle.replace(BLOCK, () => block)
    : withTitle.replace('</head>', () => `    ${block}\n  </head>`);
}
