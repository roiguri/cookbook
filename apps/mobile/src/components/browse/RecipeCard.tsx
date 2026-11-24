import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import {
  calculateTotalTime,
  formatCookingTime,
  getCategoryIcon,
  getLocalizedCategoryName,
} from '@cookbook/core/recipe-utils/recipe-data-utils';
import { getPrimaryImage } from '@cookbook/core/recipe-utils/recipe-image-utils';
import {
  getRecipeStatus,
  RECIPE_STATUS,
  RECIPE_STATUS_LABELS,
} from '@cookbook/core/recipe-utils/recipe-status';
import { colors, fontFamilies, radii, shadows, spacing, statusColors, typeScale } from '@/theme';
import { Badge, PressableScale, type BadgeTone } from '@/components/ui';
import type { RecipeDoc } from '@/services/recipes/recipe-service';
import { RecipeImageService } from '@/services/recipes/recipe-image-service';

export interface RecipeCardProps {
  recipe: RecipeDoc;
  isFavorite?: boolean;
  showFavorite?: boolean;
  showAddToMeal?: boolean;
  compact?: boolean;
  dense?: boolean;
  hideStatuses?: string[];
  onPress?: (recipe: RecipeDoc) => void;
  onToggleFavorite?: (recipe: RecipeDoc) => void;
  onAddToMeal?: (recipe: RecipeDoc) => void;
  style?: StyleProp<ViewStyle>;
}

function resolveStatusDisplay(
  recipe: RecipeDoc,
  hideStatuses?: string[],
): { label: string; tone: BadgeTone } | null {
  const sharedBy = !recipe.ownView && recipe.sharedBy ? recipe.sharedBy : null;
  const status = sharedBy ? 'shared' : getRecipeStatus(recipe);
  if (!status) return null;
  if (hideStatuses && hideStatuses.includes(status)) return null;

  if (status === 'shared') {
    const firstName = (sharedBy?.name || '').trim().split(/\s+/)[0];
    return {
      label: firstName ? `שותף · ${firstName}` : 'שותף איתי',
      tone: 'neutral',
    };
  }

  const label = RECIPE_STATUS_LABELS[status] || status;
  switch (status) {
    case RECIPE_STATUS.PUBLISHED:
      return { label, tone: 'success' };
    case RECIPE_STATUS.PENDING:
    case RECIPE_STATUS.TO_TRY:
      return { label, tone: 'warning' };
    case RECIPE_STATUS.REJECTED:
      return { label, tone: 'danger' };
    case RECIPE_STATUS.PRIVATE:
    default:
      return { label, tone: 'neutral' };
  }
}

function getDifficultyColor(difficulty?: string): string {
  if (difficulty === 'קלה') return colors.primaryDark;
  if (difficulty === 'קשה') return colors.secondary;
  return colors.caution;
}

export function RecipeCard({
  recipe,
  isFavorite = false,
  showFavorite = true,
  showAddToMeal = false,
  compact = false,
  dense = false,
  hideStatuses,
  onPress,
  onToggleFavorite,
  onAddToMeal,
  style,
}: RecipeCardProps) {
  const primaryImage = getPrimaryImage(recipe);
  const hasImages = Array.isArray(recipe.images) && recipe.images.length > 0;
  const initialDirectUrl =
    primaryImage?.preview ||
    (typeof primaryImage?.url === 'string' && primaryImage.url.startsWith('http')
      ? primaryImage.url
      : null);

  const [imageUrl, setImageUrl] = useState<string | null>(initialDirectUrl);

  useEffect(() => {
    let active = true;
    if (!hasImages) {
      setImageUrl(null);
      return;
    }

    RecipeImageService.getPrimaryImageUrl(recipe, 'thumb')
      .then((resolved) => {
        if (active) setImageUrl(resolved);
      })
      .catch(() => {
        if (active) setImageUrl(initialDirectUrl);
      });

    return () => {
      active = false;
    };
  }, [recipe.id, hasImages, primaryImage?.full, primaryImage?.url, initialDirectUrl]);

  const totalTime = calculateTotalTime(recipe.prepTime, recipe.waitTime);
  const timeText = totalTime > 0 ? formatCookingTime(totalTime) : '';
  const categoryLabel = getLocalizedCategoryName(recipe.category);
  const categoryIcon = getCategoryIcon(recipe.category);
  const statusDisplay = resolveStatusDisplay(recipe, hideStatuses);
  const isCompactMode = compact && !hasImages;

  const handleCardPress = () => {
    if (onPress) {
      onPress(recipe);
    } else {
      router.push(`/recipe/${recipe.id}`);
    }
  };

  const handleFavoritePress = (e: GestureResponderEvent) => {
    e.stopPropagation?.();
    onToggleFavorite?.(recipe);
  };

  const handleAddToMealPress = (e: GestureResponderEvent) => {
    e.stopPropagation?.();
    onAddToMeal?.(recipe);
  };

  const renderActions = () => (
    <View style={styles.actionsGroup}>
      {showFavorite ? (
        <PressableScale
          variant="icon"
          testID={`fav-btn-${recipe.id}`}
          accessibilityRole="button"
          accessibilityLabel={isFavorite ? 'הסר מהמועדפים' : 'הוסף למועדפים'}
          accessibilityState={{ selected: isFavorite }}
          hitSlop={6}
          onPress={handleFavoritePress}
          style={[styles.iconBtn, isFavorite && styles.iconBtnFavoriteActive]}
        >
          <Ionicons
            name={isFavorite ? 'heart' : 'heart-outline'}
            size={17}
            color={isFavorite ? colors.secondary : colors.ink2}
          />
        </PressableScale>
      ) : null}

      {showAddToMeal ? (
        <PressableScale
          variant="icon"
          testID={`card-add-meal-${recipe.id}`}
          accessibilityRole="button"
          accessibilityLabel="הוסף לארוחה שלי"
          hitSlop={6}
          onPress={handleAddToMealPress}
          style={styles.addMealBtn}
        >
          <Ionicons name="add" size={18} color={colors.primaryDark} />
        </PressableScale>
      ) : null}
    </View>
  );

  return (
    <PressableScale
      variant="card"
      testID={`recipe-card-${recipe.id}`}
      accessibilityRole="button"
      accessibilityLabel={recipe.name}
      onPress={handleCardPress}
      style={[styles.card, shadows.level1, isCompactMode && styles.cardCompact, style]}
    >
      {!isCompactMode ? (
        <View style={[styles.photoBox, dense && styles.photoBoxDense]}>
          {imageUrl ? (
            <Image
              source={{ uri: imageUrl }}
              style={styles.photo}
              contentFit="cover"
              transition={180}
            />
          ) : (
            <View style={styles.placeholder}>
              <Text
                style={[styles.placeholderIcon, dense && styles.placeholderIconDense]}
                allowFontScaling={false}
              >
                {categoryIcon}
              </Text>
            </View>
          )}

          {statusDisplay ? (
            <View style={styles.statusOverlay}>
              <Badge
                label={statusDisplay.label}
                tone={statusDisplay.tone}
                testID={`recipe-status-${recipe.id}`}
              />
            </View>
          ) : null}

          {showFavorite || showAddToMeal ? (
            <View style={[styles.actionsOverlay, dense && styles.actionsOverlayDense]}>
              {renderActions()}
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.compactTopRow}>
          <View style={styles.compactTopStart}>
            {statusDisplay ? (
              <Badge
                label={statusDisplay.label}
                tone={statusDisplay.tone}
                testID={`recipe-status-${recipe.id}`}
              />
            ) : (
              <Text style={styles.compactEmoji} allowFontScaling={false}>
                {categoryIcon}
              </Text>
            )}
          </View>
          {showFavorite || showAddToMeal ? renderActions() : null}
        </View>
      )}

      <View style={[styles.body, isCompactMode && styles.bodyCompact, dense && styles.bodyDense]}>
        {categoryLabel ? (
          <Text style={styles.categoryText} numberOfLines={1} allowFontScaling={false}>
            {categoryLabel}
          </Text>
        ) : null}

        <Text style={[styles.title, dense && styles.titleDense]} numberOfLines={dense ? 1 : 2}>
          {recipe.name}
        </Text>

        {!dense ? <View style={styles.divider} /> : null}

        <View style={styles.metaRow}>
          {timeText ? (
            <View style={styles.metaItem}>
              <Ionicons name="time-outline" size={13} color={colors.ink3} />
              <Text style={styles.metaText} numberOfLines={1} allowFontScaling={false}>
                {timeText}
              </Text>
            </View>
          ) : null}

          {recipe.difficulty ? (
            <Text
              style={[styles.difficultyText, { color: getDifficultyColor(recipe.difficulty) }]}
              numberOfLines={1}
              allowFontScaling={false}
            >
              {recipe.difficulty}
            </Text>
          ) : null}
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: 'hidden',
  },
  cardCompact: {
    paddingTop: spacing.sm,
  },
  photoBox: {
    width: '100%',
    height: 132,
    backgroundColor: colors.surface2,
    position: 'relative',
  },
  photoBoxDense: {
    height: 62,
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  placeholderIcon: {
    fontSize: 36,
    includeFontPadding: false,
  },
  placeholderIconDense: {
    fontSize: 24,
  },
  statusOverlay: {
    position: 'absolute',
    top: spacing.sm,
    start: spacing.sm,
    maxWidth: '58%',
  },
  actionsOverlay: {
    position: 'absolute',
    top: spacing.sm,
    end: spacing.sm,
  },
  actionsOverlayDense: {
    top: 4,
    end: 4,
  },
  actionsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: statusColors.whiteAlpha85,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnFavoriteActive: {
    borderColor: colors.secondaryLight,
  },
  addMealBtn: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: statusColors.whiteAlpha85,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
    gap: spacing.xs,
  },
  compactTopStart: {
    flexShrink: 1,
  },
  compactEmoji: {
    fontSize: 22,
    includeFontPadding: false,
  },
  body: {
    padding: spacing.md,
    gap: 5,
  },
  bodyCompact: {
    paddingTop: spacing.xs,
  },
  bodyDense: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 2,
  },
  categoryText: {
    fontSize: 11.5,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.primaryDark,
    textAlign: 'left',
    includeFontPadding: false,
  },
  title: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    lineHeight: 21,
    minHeight: 42,
    textAlign: 'left',
  },
  titleDense: {
    fontSize: 13.5,
    lineHeight: 18,
    minHeight: 18,
  },
  divider: {
    height: 1,
    backgroundColor: colors.hairline,
    marginVertical: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
    minHeight: 18,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
  },
  metaText: {
    fontSize: 11.5,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink3,
    includeFontPadding: false,
  },
  difficultyText: {
    fontSize: 11.5,
    fontFamily: fontFamilies.bodyBold,
    includeFontPadding: false,
  },
});
