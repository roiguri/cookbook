import type React from 'react';
import type { RecipeDoc } from '@/services/recipes/recipe-service';

export { ImageCarousel, type ImageCarouselProps } from './ImageCarousel';
export {
  FullscreenMediaModal,
  type FullscreenMediaItem,
  type FullscreenMediaModalProps,
} from './FullscreenMediaModal';
export {
  CookModePanel,
  COOK_MODE_WAKE_TAG,
  useCookModeWakeLock,
  type CookModeIngredientPeekItem,
  type CookModePanelProps,
  type CookModeStep,
} from './CookModePanel';
export {
  ShareMenuSheet,
  buildCanonicalRecipeUrl,
  buildRecipeShareMessage,
  shareRecipeAsText,
  shareRecipeLink,
  type ShareMenuSheetProps,
  type ShareMode,
} from './ShareMenuSheet';
export { OwnerActionsSheet, type OwnerActionsSheetProps } from './OwnerActionsSheet';

/**
 * Extension slot allowing Slice 06 (`SuggestEditModal`) to plug into Recipe Detail
 * cleanly without circular imports.
 */
export interface SuggestEditModalRendererProps {
  visible: boolean;
  recipeId: string;
  recipe?: RecipeDoc | null;
  onClose: () => void;
  onSubmitted: () => void;
}

export type SuggestEditModalRenderer = (props: SuggestEditModalRendererProps) => React.ReactNode;

let registeredSuggestEditRenderer: SuggestEditModalRenderer | null = null;
const suggestEditListeners = new Set<() => void>();

export function registerSuggestEditModalRenderer(fn: SuggestEditModalRenderer | null): void {
  registeredSuggestEditRenderer = fn;
  for (const listener of Array.from(suggestEditListeners)) {
    try {
      listener();
    } catch {
      // Never let a subscriber failure disrupt registration
    }
  }
}

export function getSuggestEditModalRenderer(): SuggestEditModalRenderer | null {
  return registeredSuggestEditRenderer;
}

export function subscribeSuggestEditModalRenderer(listener: () => void): () => void {
  suggestEditListeners.add(listener);
  return () => {
    suggestEditListeners.delete(listener);
  };
}
