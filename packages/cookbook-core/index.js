/**
 * @cookbook/core — Pure domain logic shared across Web SPA, Cloud Functions, and Native Mobile.
 *
 * Intentionally excludes `./avatar/chef-avatar` (which pulls @dicebear/avataaars) so callers
 * importing the root barrel never bloat their main shell bundle; import
 * `@cookbook/core/avatar/chef-avatar` lazily when opening the avatar builder.
 */
export * from './recipe-model.js';
export * from './push-devices.js';
export * from './recipe-utils/library-views.js';
export * from './recipe-utils/recipe-data-utils.js';
export * from './recipe-utils/recipe-diff-utils.js';
export * from './recipe-utils/recipe-image-utils.js';
export * from './recipe-utils/recipe-ingredients-utils.js';
export * from './recipe-utils/recipe-media-utils.js';
export * from './recipe-utils/recipe-status.js';
export * from './recipe-utils/recipe-text.js';
export * from './recipe-utils/storage-paths.js';
export * from './filter-utils.js';
export * from './youtube-url.js';
export * from './lru-cache.js';
export * from './avatar/avatar-url.js';
