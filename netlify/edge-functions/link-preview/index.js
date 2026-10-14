/**
 * Netlify Edge Function: link previews for every page.
 *
 * Runs before a page's HTML is returned. On /recipe/:id it reads the recipe
 * (signed out, so only published recipes come back) and writes its name,
 * description and photo into the <head>; every other page gets the site's
 * default preview. Visitors see no difference — the app renders as before.
 * If anything fails, the page is returned unchanged (`onError: 'bypass'`).
 *
 * `site.generated.js` holds the Firebase project, API key, bucket and site title
 * of the deploy; the Vite build writes it (vite.config.js, linkPreviewConfigPlugin).
 */
import { site } from './site.generated.js';
import { fetchPublishedRecipe, injectPreview, previewFor, recipeIdFromPath } from './preview.js';

export default async (request, context) => {
  const response = await context.next();
  const type = response.headers.get('content-type') || '';
  if (response.status !== 200 || !type.includes('text/html')) return response;

  const url = new URL(request.url);
  const recipeId = recipeIdFromPath(url.pathname);
  let recipe = null;
  if (recipeId) {
    try {
      recipe = await fetchPublishedRecipe(recipeId, site);
    } catch (error) {
      console.error('link-preview: recipe read failed', error);
    }
  }

  const html = injectPreview(await response.text(), previewFor({ recipe, url, site }));
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(html, { status: response.status, headers });
};

export const config = {
  path: '/*',
  // Pages only: files and API routes go straight through.
  excludedPath: [
    '/assets/*',
    '/img/*',
    '/src/*',
    '/api/*',
    '/.netlify/*',
    '/*.js',
    '/*.css',
    '/*.json',
    '/*.map',
    '/*.png',
    '/*.jpg',
    '/*.webp',
    '/*.svg',
    '/*.ico',
    '/*.txt',
    '/*.xml',
  ],
  onError: 'bypass',
};
