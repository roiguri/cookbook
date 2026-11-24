import React from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { VISIBILITY } from '@cookbook/core/recipe-model';
import { recipeShareText } from '@cookbook/core/recipe-utils/recipe-text';
import { colors, fontFamilies, radii, spacing, typeScale } from '@/theme';
import { ModalSheet, PressableScale, type ToastTone } from '@/components/ui';
import { captureError } from '@/services/logger';
import type { RecipeDoc } from '@/services/recipes/recipe-service';

export type ShareMode = 'published' | 'family' | 'text';

export interface ShareMenuSheetProps {
  visible: boolean;
  mode: ShareMode;
  recipe: RecipeDoc | null;
  servings?: number;
  onClose: () => void;
  onOpenFamilyShare: () => void;
  onShowToast: (message: string, tone?: ToastTone) => void;
}

const formatShareText = recipeShareText as unknown as (
  recipe: any,
  options?: { servings?: number; url?: string },
) => string;

/**
 * Builds the canonical public URL for a published recipe.
 * NEVER used for private recipes (P0 isolation invariant).
 */
export function buildCanonicalRecipeUrl(recipeId: string): string {
  const configuredBase = process.env.EXPO_PUBLIC_CANONICAL_URL || process.env.EXPO_PUBLIC_WEB_URL;
  if (configuredBase && /^https?:\/\//i.test(configuredBase.trim())) {
    return `${configuredBase.trim().replace(/\/+$/, '')}/recipe/${encodeURIComponent(recipeId)}`;
  }
  return `https://cookbook.example.com/recipe/${encodeURIComponent(recipeId)}`;
}

/**
 * Formats recipe share text using `@cookbook/core/recipe-utils/recipe-text` verbatim.
 * P0: Published recipes include canonical URL; private recipes NEVER include a public URL.
 */
export function buildRecipeShareMessage(recipe: RecipeDoc, servings?: number): string {
  const isPublished = recipe?.visibility === VISIBILITY.PUBLISHED;
  const url = isPublished && recipe?.id ? buildCanonicalRecipeUrl(recipe.id) : undefined;
  return formatShareText(recipe, {
    servings: servings && servings > 0 ? servings : recipe?.servings,
    url,
  });
}

export async function shareRecipeLink(
  recipe: RecipeDoc,
  showToast: (message: string, tone?: ToastTone) => void,
): Promise<void> {
  if (!recipe || recipe.visibility !== VISIBILITY.PUBLISHED) return;
  const url = buildCanonicalRecipeUrl(recipe.id);
  try {
    await Share.share({
      title: recipe.name || 'מתכון מהספר המשפחתי',
      message: recipe.name ? `${recipe.name}\n${url}` : url,
      url,
    });
  } catch {
    try {
      await Clipboard.setStringAsync(url);
      showToast('הקישור הועתק', 'success');
    } catch (err) {
      captureError(err, { service: 'recipeShare', op: 'shareLink', recipeId: recipe.id });
      showToast('לא הצלחנו להעתיק. נסו שוב.', 'error');
    }
  }
}

export async function shareRecipeAsText(
  recipe: RecipeDoc,
  servings: number | undefined,
  showToast: (message: string, tone?: ToastTone) => void,
): Promise<void> {
  if (!recipe) return;
  const text = buildRecipeShareMessage(recipe, servings);
  try {
    await Share.share({
      title: recipe.name || 'מתכון מהספר המשפחתי',
      message: text,
    });
  } catch {
    try {
      await Clipboard.setStringAsync(text);
      showToast('המתכון הועתק', 'success');
    } catch (err) {
      captureError(err, { service: 'recipeShare', op: 'shareText', recipeId: recipe.id });
      showToast('לא הצלחנו להעתיק. נסו שוב.', 'error');
    }
  }
}

export function ShareMenuSheet({
  visible,
  mode,
  recipe,
  servings,
  onClose,
  onOpenFamilyShare,
  onShowToast,
}: ShareMenuSheetProps) {
  if (!recipe) return null;

  const isPublished = mode === 'published' && recipe.visibility === VISIBILITY.PUBLISHED;
  const isFamily = mode === 'family' && recipe.visibility !== VISIBILITY.PUBLISHED;

  const handleLinkPress = () => {
    onClose();
    void shareRecipeLink(recipe, onShowToast);
  };

  const handleTextPress = () => {
    onClose();
    void shareRecipeAsText(recipe, servings, onShowToast);
  };

  const handleFamilyPress = () => {
    onClose();
    onOpenFamilyShare();
  };

  return (
    <ModalSheet
      visible={visible}
      title="שיתוף המתכון"
      onClose={onClose}
      testID="share-menu-sheet"
      scrollable={false}
    >
      <View style={styles.list}>
        {isFamily ? (
          <PressableScale
            testID="recipe-share-family-btn"
            accessibilityRole="button"
            accessibilityLabel="שיתוף עם בני משפחה"
            onPress={handleFamilyPress}
            style={styles.optionRow}
          >
            <View style={styles.optionIconCircle}>
              <Ionicons name="people-outline" size={20} color={colors.primaryDark} />
            </View>
            <View style={styles.optionTextCol}>
              <Text style={styles.optionTitle}>שיתוף עם בני משפחה</Text>
              <Text style={styles.optionSub}>בחירת בני משפחה שיוכלו לצפות במתכון הפרטי</Text>
            </View>
            <Ionicons name="chevron-back" size={18} color={colors.ink3} />
          </PressableScale>
        ) : null}

        {isPublished ? (
          <PressableScale
            testID="recipe-share-link-btn"
            accessibilityRole="button"
            accessibilityLabel="שליחת קישור"
            onPress={handleLinkPress}
            style={styles.optionRow}
          >
            <View style={styles.optionIconCircle}>
              <Ionicons name="link-outline" size={20} color={colors.primaryDark} />
            </View>
            <View style={styles.optionTextCol}>
              <Text style={styles.optionTitle}>שליחת קישור</Text>
              <Text style={styles.optionSub}>שיתוף קישור ישיר למתכון בספר המשפחתי</Text>
            </View>
            <Ionicons name="chevron-back" size={18} color={colors.ink3} />
          </PressableScale>
        ) : null}

        <PressableScale
          testID="recipe-share-text-btn"
          accessibilityRole="button"
          accessibilityLabel="שליחת המתכון כטקסט"
          onPress={handleTextPress}
          style={styles.optionRow}
        >
          <View style={styles.optionIconCircle}>
            <Ionicons name="document-text-outline" size={20} color={colors.primaryDark} />
          </View>
          <View style={styles.optionTextCol}>
            <Text style={styles.optionTitle}>שליחת המתכון כטקסט</Text>
            <Text style={styles.optionSub}>
              {isPublished
                ? 'מצרכים מותאמים למנות, שלבים וקישור לוואטסאפ'
                : 'מצרכים מותאמים למנות ושלבי הכנה כטקסט בלבד'}
            </Text>
          </View>
          <Ionicons name="chevron-back" size={18} color={colors.ink3} />
        </PressableScale>
      </View>
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: 62,
  },
  optionIconCircle: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionTextCol: {
    flex: 1,
    gap: 2,
  },
  optionTitle: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyBold,
    color: colors.ink,
    textAlign: 'left',
    includeFontPadding: false,
  },
  optionSub: {
    fontSize: 12.5,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    textAlign: 'left',
    lineHeight: 18,
  },
});
