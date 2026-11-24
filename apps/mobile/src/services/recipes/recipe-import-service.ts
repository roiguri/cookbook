import { parseAmount } from '@cookbook/core/recipe-utils/recipe-ingredients-utils';
import { parseYouTubeUrl } from '@cookbook/core/youtube-url';
import { callCloudFunction } from '../_firebase/functions-adapter';
import { captureError } from '../logger';

export type RecipeImportMode = 'image' | 'url' | 'video';

export interface ImportImagePayload {
  base64: string;
  mimeType?: string;
}

export interface ExtractedIngredient {
  item?: string;
  amount?: string | number | null;
  unit?: string;
}

export interface ExtractedIngredientSection {
  title?: string;
  items?: ExtractedIngredient[];
}

export interface ExtractedStage {
  title?: string;
  instructions?: string[];
}

export interface ExtractedRecipeData {
  name?: string;
  category?: string;
  mainIngredient?: string;
  prepTime?: number | null;
  waitTime?: number | null;
  servings?: number | null;
  difficulty?: string;
  description?: string;
  servingsUnit?: string;
  attribution?: string;
  comments?: string[];
  tags?: string[];
  ingredients?: ExtractedIngredient[] | null;
  ingredientSections?: ExtractedIngredientSection[] | null;
  instructions?: string[] | null;
  stages?: ExtractedStage[] | null;
  recipe?: ExtractedRecipeData;
}

export interface MappedRecipeFormData {
  name: string;
  category: string;
  mainIngredient: string;
  prepTime: number | null;
  waitTime: number | null;
  servings: number | null;
  difficulty: string;
  description: string;
  servingsUnit: string;
  attribution: string;
  comments: string[];
  tags: string[];
  ingredients?: Array<{ item: string; amount: number | null; unit: string }> | null;
  ingredientSections?: Array<{
    title: string;
    items: Array<{ item: string; amount: number | null; unit: string }>;
  }> | null;
  instructions?: string[] | null;
  stages?: Array<{ title: string; instructions: string[] }> | null;
}

export interface ExtractCallOptions {
  signal?: AbortSignal;
}

function createAbortError(): Error {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}

function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(createAbortError());

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(createAbortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

function normalizeYouTubeResult(raw: string): string | null {
  const parsed = parseYouTubeUrl(raw) as {
    videoId: string;
    normalizedUrl?: string;
    canonicalUrl?: string;
  } | null;
  if (!parsed || !parsed.videoId) return null;
  return (
    parsed.normalizedUrl ||
    parsed.canonicalUrl ||
    `https://www.youtube.com/watch?v=${parsed.videoId}`
  );
}

/**
 * Extracts a structured Hebrew recipe from 1–5 base64-encoded images via
 * the `extractRecipeFromImage` Cloud Function callable.
 */
export async function extractFromImages(
  images: ImportImagePayload[],
  opts: ExtractCallOptions = {},
): Promise<ExtractedRecipeData> {
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error('invalid-argument: At least one image is required');
  }
  const normalized = images.slice(0, 5).map((img) => ({
    base64: String(img.base64 || '').replace(/^data:[^;]+;base64,/, ''),
    mimeType: img.mimeType || 'image/jpeg',
  }));

  try {
    return await raceWithAbort(
      callCloudFunction<
        { images: Array<{ base64: string; mimeType: string }> },
        ExtractedRecipeData
      >('extractRecipeFromImage', { images: normalized }, { timeoutMs: 120_000 }),
      opts.signal,
    );
  } catch (err: any) {
    if (err?.name !== 'AbortError') {
      captureError(err, {
        service: 'recipe-import',
        op: 'extractFromImages',
        imageCount: normalized.length,
      });
    }
    throw err;
  }
}

/**
 * Extracts a structured Hebrew recipe from a web URL via the
 * `extractRecipeFromUrl` Cloud Function callable.
 * Server-side failures are automatically logged into `failed_url_extractions`.
 */
export async function extractFromUrl(
  url: string,
  opts: ExtractCallOptions = {},
): Promise<ExtractedRecipeData> {
  const trimmed = String(url || '').trim();
  if (!trimmed) {
    throw new Error('invalid-argument: URL is required');
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('invalid-argument: Unsupported URL protocol');
    }
  } catch {
    throw new Error('invalid-argument: Invalid URL');
  }

  try {
    return await raceWithAbort(
      callCloudFunction<{ url: string }, ExtractedRecipeData>(
        'extractRecipeFromUrl',
        { url: trimmed },
        { timeoutMs: 120_000 },
      ),
      opts.signal,
    );
  } catch (err: any) {
    if (err?.name !== 'AbortError') {
      captureError(err, {
        service: 'recipe-import',
        op: 'extractFromUrl',
      });
    }
    throw err;
  }
}

/**
 * Extracts a structured Hebrew recipe from a YouTube video/Shorts URL via
 * the `extractRecipeFromVideo` Cloud Function callable.
 * Server-side failures are automatically logged into `failed_url_extractions`.
 */
export async function extractFromVideo(
  url: string,
  opts: ExtractCallOptions = {},
): Promise<ExtractedRecipeData> {
  const trimmed = String(url || '').trim();
  if (!normalizeYouTubeResult(trimmed)) {
    throw new Error('invalid-argument: Invalid YouTube URL');
  }

  try {
    return await raceWithAbort(
      callCloudFunction<{ url: string }, ExtractedRecipeData>(
        'extractRecipeFromVideo',
        { url: trimmed },
        { timeoutMs: 300_000 },
      ),
      opts.signal,
    );
  } catch (err: any) {
    if (err?.name !== 'AbortError') {
      captureError(err, {
        service: 'recipe-import',
        op: 'extractFromVideo',
      });
    }
    throw err;
  }
}

/**
 * Maps raw Gemini extraction output into the normalized RecipeForm population shape.
 * Matches Web Semport oracle `src/js/utils/recipe-extractor-utils.js` 1:1.
 */
export function mapExtractedDataToForm(
  extractedData: ExtractedRecipeData | null | undefined,
): MappedRecipeFormData {
  const source: ExtractedRecipeData =
    extractedData && extractedData.recipe && !extractedData.name
      ? extractedData.recipe
      : extractedData || {};

  const mappedData: MappedRecipeFormData = {
    name: typeof source.name === 'string' ? source.name : '',
    category: typeof source.category === 'string' ? source.category : '',
    mainIngredient: typeof source.mainIngredient === 'string' ? source.mainIngredient : '',
    // Leave missing numeric fields null so the form flags them instead of fabricating 0 / 1
    prepTime: source.prepTime ?? null,
    waitTime: source.waitTime ?? null,
    servings: source.servings ?? null,
    difficulty:
      typeof source.difficulty === 'string' && source.difficulty ? source.difficulty : 'בינונית',
    description: typeof source.description === 'string' ? source.description : '',
    servingsUnit:
      typeof source.servingsUnit === 'string' && source.servingsUnit ? source.servingsUnit : 'מנות',
    attribution: typeof source.attribution === 'string' ? source.attribution : '',
    comments: Array.isArray(source.comments)
      ? source.comments.filter((c): c is string => typeof c === 'string')
      : [],
    tags: Array.isArray(source.tags)
      ? source.tags.filter((t): t is string => typeof t === 'string')
      : [],
  };

  // Map ingredients — prioritize sections when present
  if (Array.isArray(source.ingredientSections) && source.ingredientSections.length > 0) {
    mappedData.ingredientSections = source.ingredientSections.map((section) => ({
      title: section?.title || 'כללי',
      items: (Array.isArray(section?.items) ? section.items : []).map((ing) => ({
        item: ing?.item || '',
        amount: parseAmount(ing?.amount),
        unit: ing?.unit || '',
      })),
    }));
    mappedData.ingredients = null;
  } else if (Array.isArray(source.ingredients)) {
    mappedData.ingredients = source.ingredients.map((ing) => ({
      item: ing?.item || '',
      amount: parseAmount(ing?.amount),
      unit: ing?.unit || '',
    }));
    mappedData.ingredientSections = null;
  } else {
    mappedData.ingredients = [];
  }

  // Map instructions — prioritize stages when present
  if (Array.isArray(source.stages) && source.stages.length > 0) {
    mappedData.stages = source.stages.map((stage) => ({
      title: stage?.title || 'שלב',
      instructions: Array.isArray(stage?.instructions)
        ? stage.instructions.filter((s): s is string => typeof s === 'string')
        : [],
    }));
    mappedData.instructions = null;
  } else if (Array.isArray(source.instructions)) {
    mappedData.instructions = source.instructions.filter((s): s is string => typeof s === 'string');
    mappedData.stages = null;
  } else {
    mappedData.instructions = [];
  }

  return mappedData;
}

/**
 * Mode-aware Hebrew error message mapping matching Web `recipe_import_modal.js`
 * plus graceful handling of Gemini rate-limit / empty-response faults.
 */
export function mapImportErrorToHebrew(error: unknown, mode: RecipeImportMode): string {
  const defaultByMode: Record<RecipeImportMode, string> = {
    image: 'אירעה שגיאה בעיבוד התמונה. אנא נסה שוב.',
    url: 'אירעה שגיאה בייבוא המתכון מהכתובת. אנא נסה שוב.',
    video: 'אירעה שגיאה בייבוא המתכון מהסרטון. אנא נסה שוב.',
  };
  const invalidArgByMode: Record<RecipeImportMode, string> = {
    image: 'התמונה שנשלחה אינה תקינה.',
    url: 'כתובת ה-URL אינה תקינה.',
    video: 'הקישור אינו סרטון YouTube תקין.',
  };
  const couldNotExtractByMode: Record<RecipeImportMode, string> = {
    image: 'לא ניתן לחלץ מתכון מהתמונה.',
    url: 'לא ניתן לחלץ מתכון מכתובת זו.',
    video: 'לא ניתן לחלץ מתכון מסרטון זה. ייתכן שהוא פרטי, מוגבל גיל, או אינו מכיל מתכון.',
  };

  const errObj = error as { code?: string; message?: string; details?: string } | null;
  const raw =
    `${errObj?.code || ''} ${errObj?.message || ''} ${errObj?.details || ''}`.toLowerCase();

  if (raw.includes('permission-denied') || raw.includes('unauthenticated')) {
    return 'אין לך הרשאה לבצע פעולה זו.';
  }
  if (raw.includes('invalid-argument')) {
    return invalidArgByMode[mode] || invalidArgByMode.image;
  }
  if (
    raw.includes('quota-exceeded') ||
    raw.includes('resource-exhausted') ||
    raw.includes('rate-limit') ||
    raw.includes('429')
  ) {
    return 'הגענו למכסת השימוש הזמנית. אנא נסה שוב בעוד רגע.';
  }
  if (raw.includes('could not extract') || raw.includes('empty')) {
    return couldNotExtractByMode[mode] || couldNotExtractByMode.image;
  }
  if (raw.includes('deadline-exceeded') || raw.includes('timeout')) {
    return 'הפעולה לקחה זמן רב מדי. אנא נסה שוב.';
  }
  if (raw.includes('not-found')) {
    return 'השירות אינו זמין כעת (404).';
  }
  if (raw.includes('internal')) {
    return 'שגיאה בשרת העיבוד. אנא נסה שוב.';
  }
  return defaultByMode[mode] || defaultByMode.image;
}

export const RecipeImportService = {
  extractFromImages,
  extractFromUrl,
  extractFromVideo,
  mapExtractedDataToForm,
  mapImportErrorToHebrew,
};
