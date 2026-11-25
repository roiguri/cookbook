import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radii, spacing } from '@/theme';
import { Skeleton } from '@/components/ui';
import type { RecipeDoc } from '@/services/recipes/recipe-service';
import { RecipeCard } from './RecipeCard';

export interface RecipeStripProps {
  recipes: RecipeDoc[];
  loading?: boolean;
  compactIfNoImages?: boolean;
  dense?: boolean;
  hideStatuses?: string[];
  favoriteIds?: Set<string>;
  showFavorite?: boolean;
  showAddToMeal?: boolean;
  onPressRecipe?: (recipe: RecipeDoc) => void;
  onToggleFavorite?: (recipe: RecipeDoc) => void;
  onAddToMeal?: (recipe: RecipeDoc) => void;
  afterSlot?: React.ReactNode;
  afterSlotFullWidth?: boolean;
  testID?: string;
}

function hasAnyImage(recipe: RecipeDoc): boolean {
  return Array.isArray(recipe?.images) && recipe.images.length > 0;
}

export function RecipeStrip({
  recipes,
  loading = false,
  compactIfNoImages = false,
  dense = false,
  hideStatuses,
  favoriteIds,
  showFavorite = true,
  showAddToMeal = false,
  onPressRecipe,
  onToggleFavorite,
  onAddToMeal,
  afterSlot,
  afterSlotFullWidth = false,
  testID,
}: RecipeStripProps) {
  if (loading) {
    return (
      <View testID={testID} style={styles.grid}>
        <View style={styles.row}>
          {[0, 1].map((idx) => (
            <View key={idx} style={[styles.cell, styles.skeletonCard]}>
              <Skeleton height={158} radius={radii.md} />
              <View style={styles.skeletonBody}>
                <Skeleton width="45%" height={12} />
                <Skeleton width="85%" height={16} />
                <Skeleton width="60%" height={12} />
              </View>
            </View>
          ))}
        </View>
      </View>
    );
  }

  const allWithoutImages =
    compactIfNoImages && recipes.length > 0 && recipes.every((r) => !hasAnyImage(r));

  if (recipes.length === 0 && afterSlot && afterSlotFullWidth) {
    return (
      <View testID={testID} style={styles.grid}>
        {afterSlot}
      </View>
    );
  }

  // Build flat tile entries (recipe cards + optional inline afterSlot)
  const cells: React.ReactNode[] = recipes.map((recipe) => (
    <RecipeCard
      key={recipe.id}
      recipe={recipe}
      compact={allWithoutImages}
      dense={dense}
      hideStatuses={hideStatuses}
      isFavorite={favoriteIds ? favoriteIds.has(recipe.id) : false}
      showFavorite={showFavorite}
      showAddToMeal={showAddToMeal}
      onPress={onPressRecipe}
      onToggleFavorite={onToggleFavorite}
      onAddToMeal={onAddToMeal}
      style={styles.cardFill}
    />
  ));

  if (afterSlot && !afterSlotFullWidth) {
    cells.push(
      <View key="__after_slot__" style={styles.afterSlotCell}>
        {afterSlot}
      </View>,
    );
  }

  const rows: React.ReactNode[][] = [];
  for (let i = 0; i < cells.length; i += 2) {
    rows.push(cells.slice(i, i + 2));
  }

  return (
    <View testID={testID} style={styles.grid}>
      {rows.map((pair, rowIndex) => (
        <View key={rowIndex} style={styles.row}>
          <View style={styles.cell}>{pair[0]}</View>
          <View style={styles.cell}>{pair[1] ?? <View style={styles.emptySpacer} />}</View>
        </View>
      ))}
      {afterSlot && afterSlotFullWidth && recipes.length > 0 ? afterSlot : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'stretch',
  },
  cell: {
    flex: 1,
    minWidth: 0,
  },
  cardFill: {
    flex: 1,
  },
  afterSlotCell: {
    flex: 1,
  },
  emptySpacer: {
    flex: 1,
  },
  skeletonCard: {
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: 'hidden',
    padding: spacing.xs,
  },
  skeletonBody: {
    padding: spacing.sm,
    gap: spacing.sm,
  },
});
