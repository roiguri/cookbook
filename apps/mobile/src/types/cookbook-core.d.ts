declare module '@cookbook/core' {
  // recipe-model.js
  export const CATEGORY_IDS: readonly string[];
  export const CATEGORY_MAP: Readonly<Record<string, string>>;
  export const COMMON_FRACTIONS: readonly any[];
  export const DIFFICULTIES: readonly string[];
  export const MAX_PHOTOS: number;
  export const MAX_RELATED_RECIPES: number;
  export const MEDIA_IMAGE_TYPES: readonly string[];
  export const MEDIA_MAX_BYTES: number;
  export const MEDIA_TYPES: readonly string[];
  export const MEDIA_VIDEO_TYPES: readonly string[];
  export const MIN_SECTIONS: number;
  export const PHOTO_MAX_BYTES: number;
  export const PHOTO_TYPES: readonly string[];
  export const RECIPE_CONTENT_FIELDS: readonly string[];
  export const RECIPE_NUMBER_LIMITS: Record<string, any>;
  export const STAGE: { TO_TRY: 'to-try'; TESTED: 'tested' };
  export const VISIBILITY: { PUBLISHED: 'published'; PRIVATE: 'private' };
  export function buildImageEntry(input: any): any;
  export function buildMediaEntry(input: any): any;
  export function generateImageId(): string;
  export function generateMediaInstructionId(): string;
  export function imageFileName(id: string, ext?: string): string;
  export function mediaFileName(id: string, name?: string): string;
  export function mediaTypeOf(mimeType: string): 'image' | 'video' | null;
  export function missingRequiredFields(data: any): string[];
  export function normalizeRecipeContent(data: any): any;
  export function parseAmount(raw: any): number | null;
  export function recipeImagesFolder(recipeId: string): string;
  export function recipeMediaFolder(recipeId: string): string;
  export function submissionRecord(params: any): any;
  export function suggestionImagesFolder(suggestionId: string): string;
  export function suggestionMediaFolder(suggestionId: string): string;
  export function withModelFields(data: any, defaults?: any): any;

  // push-devices.js
  export const MAX_PUSH_TOKEN_LENGTH: number;
  export const MAX_PUSH_UA_LENGTH: number;
  export const PUSH_PLATFORMS: { WEB: 'web'; ANDROID: 'android'; IOS: 'ios' };
  export const PUSH_PLATFORM_LIST: readonly string[];
  export function buildDeviceRecord(params: {
    token: string;
    platform: 'web' | 'android' | 'ios';
    updatedAt: any;
    ua?: string;
  }): Record<string, any>;
  export function deviceIdForToken(token: string): string;
  export function isValidPushPlatform(platform: string): boolean;

  // filter-utils.js
  export const FilterUtils: {
    searchRecipes(recipes: any[], query: string): any[];
    applyFilters(recipes: any[], filters: any): any[];
    extractFilterOptions(recipes: any[]): any;
    sortRecipes?(recipes: any[], sortBy: string): any[];
  };

  // youtube-url.js
  export function parseYouTubeUrl(url?: string | null): {
    videoId: string;
    canonicalUrl: string;
    embedUrl: string;
    thumbnailUrl: string;
  } | null;

  // lru-cache.js
  export class LRUCache<K = string, V = any> {
    constructor(maxSize?: number);
    get(key: K): V | undefined;
    set(key: K, value: V): void;
    has(key: K): boolean;
    delete(key: K): boolean;
    clear(): void;
  }

  // avatar/avatar-url.js
  export function isBuiltAvatarUrl(url?: string | null): boolean;

  // recipe-utils/library-views.js
  export const LIBRARY_VIEW: Record<string, string>;
  export function buildLibraryViews(params: any): any;

  // recipe-utils/recipe-data-utils.js
  export const CATEGORY_ICONS: Record<string, string>;
  export function calculateTotalTime(prep?: number, wait?: number): number;
  export function extractIngredientNamesFromSections(recipe: any): string[];
  export function formatCookingTime(minutes?: number): string;
  export function formatRecipeData(data: any): any;
  export function getCategoryIcon(category: string): string;
  export function getDifficultyClass(difficulty: string): string;
  export function getLocalizedCategoryName(category: string): string;
  export function getTimeClass(minutes: number): string;
  export function validateRecipeData(data: any): { valid: boolean; errors: string[] };

  // recipe-utils/recipe-diff-utils.js
  export function buildApplyPayload(recipe: any, proposedChanges: any): any;
  export function buildRecipeDiffModel(before: any, after: any): any;

  // recipe-utils/recipe-image-utils.js
  export function getImageStoragePath(img: any, recipeId?: string): string | null;
  export function getPlaceholderImageUrl(): string;
  export function getPrimaryImage(recipe: any): any;
  export function getRecipeImages(recipe: any): any[];
  export function validateImageFile(file: any): { valid: boolean; error?: string };

  // recipe-utils/recipe-ingredients-utils.js
  export const HEBREW_UNITS: readonly string[];
  export function createEmptyIngredient(): { item: string; amount: string; unit: string };
  export function extractIngredientNames(ingredients: any[]): string[];
  export function formatAmount(amount: any): string;
  export function formatIngredientAmount(amount: any): string;
  export function isValidAmount(amount: any): boolean;
  export function scaleIngredients(
    ingredients: any[],
    originalServings: number,
    targetServings: number,
  ): any[];

  // recipe-utils/recipe-media-utils.js
  export function validateMediaFile(file: any): { valid: boolean; error?: string };
  export function validateMediaInstructionData(data: any): { valid: boolean; errors: string[] };

  // recipe-utils/recipe-status.js
  export const RECIPE_STATUS: Record<string, string>;
  export const RECIPE_STATUS_LABELS: Record<string, string>;
  export function getRecipeStatus(recipe: any, submission?: any): string;

  // recipe-utils/recipe-text.js
  export function ingredientLine(ing: any): string;
  export function recipeShareText(recipe: any, url?: string): string;

  // recipe-utils/storage-paths.js
  export function isRecipeStoragePath(path: string, recipeId?: string): boolean;
  export function rewriteStoragePaths(obj: any, mapping: Record<string, string>): any;
}

declare module '@cookbook/core/recipe-model' {
  export {
    CATEGORY_IDS,
    CATEGORY_MAP,
    COMMON_FRACTIONS,
    DIFFICULTIES,
    MAX_PHOTOS,
    MAX_RELATED_RECIPES,
    MEDIA_IMAGE_TYPES,
    MEDIA_MAX_BYTES,
    MEDIA_TYPES,
    MEDIA_VIDEO_TYPES,
    MIN_SECTIONS,
    PHOTO_MAX_BYTES,
    PHOTO_TYPES,
    RECIPE_CONTENT_FIELDS,
    RECIPE_NUMBER_LIMITS,
    STAGE,
    VISIBILITY,
    buildImageEntry,
    buildMediaEntry,
    generateImageId,
    generateMediaInstructionId,
    imageFileName,
    mediaFileName,
    mediaTypeOf,
    missingRequiredFields,
    normalizeRecipeContent,
    parseAmount,
    recipeImagesFolder,
    recipeMediaFolder,
    submissionRecord,
    suggestionImagesFolder,
    suggestionMediaFolder,
    withModelFields,
  } from '@cookbook/core';
}

declare module '@cookbook/core/push-devices' {
  export {
    MAX_PUSH_TOKEN_LENGTH,
    MAX_PUSH_UA_LENGTH,
    PUSH_PLATFORMS,
    PUSH_PLATFORM_LIST,
    buildDeviceRecord,
    deviceIdForToken,
    isValidPushPlatform,
  } from '@cookbook/core';
}

declare module '@cookbook/core/filter-utils' {
  export { FilterUtils } from '@cookbook/core';
}

declare module '@cookbook/core/youtube-url' {
  export { parseYouTubeUrl } from '@cookbook/core';
}

declare module '@cookbook/core/lru-cache' {
  export { LRUCache } from '@cookbook/core';
}

declare module '@cookbook/core/avatar/avatar-url' {
  export { isBuiltAvatarUrl } from '@cookbook/core';
}

declare module '@cookbook/core/avatar/chef-avatar' {
  export const AVATAR_COLORS: Record<string, readonly any[]>;
  export const AVATAR_CONFIG_VERSION: number;
  export const AVATAR_PARTS: Record<string, readonly any[]>;
  export const DEFAULT_AVATAR_CONFIG: any;
  export const HAT_FIT: Record<string, any>;
  export function describeAvatarSchema(): any;
  export function normalizeAvatarConfig(cfg?: any): any;
  export function randomAvatarConfig(): any;
  export function renderAvatarSvg(cfg?: any): string;
  export function renderKitchenPropSvg(id: string): string;
}

declare module '@cookbook/core/recipe-utils/library-views' {
  export { LIBRARY_VIEW, buildLibraryViews } from '@cookbook/core';
}

declare module '@cookbook/core/recipe-utils/recipe-data-utils' {
  export {
    CATEGORY_ICONS,
    CATEGORY_MAP,
    calculateTotalTime,
    extractIngredientNamesFromSections,
    formatCookingTime,
    formatRecipeData,
    getCategoryIcon,
    getDifficultyClass,
    getLocalizedCategoryName,
    getTimeClass,
    validateRecipeData,
  } from '@cookbook/core';
}

declare module '@cookbook/core/recipe-utils/recipe-diff-utils' {
  export { buildApplyPayload, buildRecipeDiffModel } from '@cookbook/core';
}

declare module '@cookbook/core/recipe-utils/recipe-image-utils' {
  export {
    generateImageId,
    getImageStoragePath,
    getPlaceholderImageUrl,
    getPrimaryImage,
    getRecipeImages,
    validateImageFile,
  } from '@cookbook/core';
}

declare module '@cookbook/core/recipe-utils/recipe-ingredients-utils' {
  export {
    COMMON_FRACTIONS,
    HEBREW_UNITS,
    createEmptyIngredient,
    extractIngredientNames,
    formatAmount,
    formatIngredientAmount,
    isValidAmount,
    parseAmount,
    scaleIngredients,
  } from '@cookbook/core';
}

declare module '@cookbook/core/recipe-utils/recipe-media-utils' {
  export {
    generateMediaInstructionId,
    validateMediaFile,
    validateMediaInstructionData,
  } from '@cookbook/core';
}

declare module '@cookbook/core/recipe-utils/recipe-status' {
  export { RECIPE_STATUS, RECIPE_STATUS_LABELS, getRecipeStatus } from '@cookbook/core';
}

declare module '@cookbook/core/recipe-utils/recipe-text' {
  export { ingredientLine, recipeShareText } from '@cookbook/core';
}

declare module '@cookbook/core/recipe-utils/storage-paths' {
  export {
    isRecipeStoragePath,
    recipeImagesFolder,
    recipeMediaFolder,
    rewriteStoragePaths,
    suggestionImagesFolder,
    suggestionMediaFolder,
  } from '@cookbook/core';
}
