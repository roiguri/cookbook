import React, { useEffect, useMemo, useState } from 'react';
import { Dimensions, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FilterUtils } from '@cookbook/core/filter-utils';
import { DIFFICULTIES } from '@cookbook/core/recipe-model';
import { colors, fontFamilies, radii, spacing, typeScale } from '@/theme';
import { Button, Chip, ModalSheet, PressableScale } from '@/components/ui';
import type { RecipeDoc } from '@/services/recipes/recipe-service';

export interface RecipeFilters {
  cookingTime: '' | '0-30' | '31-60' | '61';
  difficulty: string;
  mainIngredient: string;
  tags: string[];
  favoritesOnly: boolean;
}

export const EMPTY_FILTERS: RecipeFilters = {
  cookingTime: '',
  difficulty: '',
  mainIngredient: '',
  tags: [],
  favoritesOnly: false,
};

export function countActiveFilters(filters: RecipeFilters): number {
  let count = 0;
  if (filters.cookingTime) count += 1;
  if (filters.difficulty) count += 1;
  if (filters.mainIngredient) count += 1;
  if (filters.tags.length > 0) count += filters.tags.length;
  if (filters.favoritesOnly) count += 1;
  return count;
}

const COOKING_TIME_BUCKETS: ReadonlyArray<{
  value: '0-30' | '31-60' | '61';
  label: string;
}> = [
  { value: '0-30', label: '0-30 דקות' },
  { value: '31-60', label: '31-60 דקות' },
  { value: '61', label: 'מעל שעה' },
];

export interface FilterSheetProps {
  visible: boolean;
  recipes: RecipeDoc[];
  currentFilters: RecipeFilters;
  favoriteIds: string[];
  isAuthenticated: boolean;
  onApply: (filters: RecipeFilters) => void;
  onClear: () => void;
  onClose: () => void;
}

const MAX_SCROLL_HEIGHT = Math.min(440, Math.round(Dimensions.get('window').height * 0.54));

export function FilterSheet({
  visible,
  recipes,
  currentFilters,
  favoriteIds,
  isAuthenticated,
  onApply,
  onClear,
  onClose,
}: FilterSheetProps) {
  const [draft, setDraft] = useState<RecipeFilters>(currentFilters);
  const [tagSearch, setTagSearch] = useState('');
  const [matchingCount, setMatchingCount] = useState<number>(recipes.length);

  // Sync draft state whenever sheet opens
  useEffect(() => {
    if (visible) {
      const nextDraft: RecipeFilters = {
        cookingTime: currentFilters.cookingTime,
        difficulty: currentFilters.difficulty,
        mainIngredient: currentFilters.mainIngredient,
        tags: [...currentFilters.tags],
        favoritesOnly: isAuthenticated ? currentFilters.favoritesOnly : false,
      };
      setDraft(nextDraft);
      setTagSearch('');
      const initialMatched = (FilterUtils as any).applyFilters(
        recipes,
        nextDraft,
        favoriteIds,
      ) as RecipeDoc[];
      setMatchingCount(initialMatched.length);
    }
  }, [visible, currentFilters, isAuthenticated, recipes, favoriteIds]);

  const availableOptions = useMemo(() => {
    const extracted = FilterUtils.extractFilterOptions(recipes) as {
      mainIngredients?: string[];
      tags?: string[];
    };
    return {
      mainIngredients: Array.isArray(extracted?.mainIngredients) ? extracted.mainIngredients : [],
      tags: Array.isArray(extracted?.tags) ? extracted.tags : [],
    };
  }, [recipes]);

  // Debounced live match count using `@cookbook/core/filter-utils` FilterUtils.applyFilters
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      const matched = (FilterUtils as any).applyFilters(recipes, draft, favoriteIds) as RecipeDoc[];
      setMatchingCount(matched.length);
    }, 140);
    return () => clearTimeout(timer);
  }, [visible, recipes, draft, favoriteIds]);

  const filteredTags = useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    if (!q) return availableOptions.tags;
    return availableOptions.tags.filter((t) => t.toLowerCase().includes(q));
  }, [availableOptions.tags, tagSearch]);

  const toggleDifficulty = (diff: string) => {
    setDraft((prev) => ({
      ...prev,
      difficulty: prev.difficulty === diff ? '' : diff,
    }));
  };

  const toggleCookingTime = (bucket: '0-30' | '31-60' | '61') => {
    setDraft((prev) => ({
      ...prev,
      cookingTime: prev.cookingTime === bucket ? '' : bucket,
    }));
  };

  const toggleMainIngredient = (ingredient: string) => {
    setDraft((prev) => ({
      ...prev,
      mainIngredient: prev.mainIngredient === ingredient ? '' : ingredient,
    }));
  };

  const toggleTag = (tag: string) => {
    setDraft((prev) => {
      const exists = prev.tags.includes(tag);
      return {
        ...prev,
        tags: exists ? prev.tags.filter((t) => t !== tag) : [...prev.tags, tag],
      };
    });
  };

  const toggleFavoritesOnly = () => {
    setDraft((prev) => ({
      ...prev,
      favoritesOnly: !prev.favoritesOnly,
    }));
  };

  const handleClear = () => {
    setDraft({ ...EMPTY_FILTERS, tags: [] });
    onClear();
  };

  const handleApply = () => {
    onApply({
      ...draft,
      tags: [...draft.tags],
      favoritesOnly: isAuthenticated ? draft.favoritesOnly : false,
    });
    onClose();
  };

  return (
    <ModalSheet
      visible={visible}
      title="סינון מתכונים"
      onClose={onClose}
      testID="filter-sheet"
      scrollable={false}
    >
      <View style={styles.counterBar}>
        <Text testID="filter-match-count" style={styles.counterText}>
          {matchingCount} מתכונים תואמים
        </Text>
      </View>

      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Cooking Time (exact 3 buckets) */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>זמן הכנה</Text>
          <View style={styles.chipsWrap}>
            {COOKING_TIME_BUCKETS.map((bucket) => (
              <Chip
                key={bucket.value}
                label={bucket.label}
                selected={draft.cookingTime === bucket.value}
                onPress={() => toggleCookingTime(bucket.value)}
                testID={`filter-time-${bucket.value}`}
              />
            ))}
          </View>
        </View>

        {/* Difficulty */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>רמת קושי</Text>
          <View style={styles.chipsWrap}>
            {DIFFICULTIES.map((diff) => (
              <Chip
                key={diff}
                label={diff}
                selected={draft.difficulty === diff}
                onPress={() => toggleDifficulty(diff)}
                testID={`filter-difficulty-${diff}`}
              />
            ))}
          </View>
        </View>

        {/* Favorites Only (signed-in only) */}
        {isAuthenticated ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>מועדפים</Text>
            <PressableScale
              variant="card"
              testID="filter-favorites-toggle"
              accessibilityRole="switch"
              accessibilityState={{ checked: draft.favoritesOnly }}
              onPress={toggleFavoritesOnly}
              style={[styles.toggleRow, draft.favoritesOnly && styles.toggleRowActive]}
            >
              <View style={styles.toggleLabelWrap}>
                <Ionicons
                  name={draft.favoritesOnly ? 'heart' : 'heart-outline'}
                  size={18}
                  color={draft.favoritesOnly ? colors.secondary : colors.ink2}
                />
                <Text style={styles.toggleLabel}>רק מתכונים ששמרתי</Text>
              </View>
              <Switch
                value={draft.favoritesOnly}
                onValueChange={toggleFavoritesOnly}
                trackColor={{ false: colors.hairlineStrong, true: colors.primaryBright }}
                thumbColor={draft.favoritesOnly ? colors.primaryDark : colors.surface1}
              />
            </PressableScale>
          </View>
        ) : null}

        {/* Main Ingredient (dynamic from FilterUtils.extractFilterOptions) */}
        {availableOptions.mainIngredients.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>מרכיב עיקרי</Text>
            <View style={styles.chipsWrap}>
              {availableOptions.mainIngredients.map((ingredient) => (
                <Chip
                  key={ingredient}
                  label={ingredient}
                  selected={draft.mainIngredient === ingredient}
                  onPress={() => toggleMainIngredient(ingredient)}
                />
              ))}
            </View>
          </View>
        ) : null}

        {/* Tags (multi-select AND semantics) */}
        {availableOptions.tags.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>
              תגיות{draft.tags.length > 0 ? ` (${draft.tags.length} נבחרו)` : ''}
            </Text>
            {availableOptions.tags.length > 8 ? (
              <TextInput
                value={tagSearch}
                onChangeText={setTagSearch}
                placeholder="סינון תגיות..."
                placeholderTextColor={colors.ink4}
                style={styles.tagSearchInput}
              />
            ) : null}
            <View style={styles.chipsWrap}>
              {filteredTags.map((tag) => (
                <Chip
                  key={tag}
                  label={tag}
                  selected={draft.tags.includes(tag)}
                  onPress={() => toggleTag(tag)}
                />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* Sticky Footer */}
      <View style={styles.footer}>
        <Button
          label="אפס הכל"
          variant="secondary"
          onPress={handleClear}
          testID="filter-clear-btn"
          style={styles.footerBtn}
        />
        <Button
          label="הצג תוצאות"
          variant="primary"
          onPress={handleApply}
          testID="filter-apply-btn"
          style={styles.footerApplyBtn}
        />
      </View>
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  counterBar: {
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    marginBottom: spacing.sm,
  },
  counterText: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink3,
    textAlign: 'left',
    includeFontPadding: false,
  },
  scrollArea: {
    maxHeight: MAX_SCROLL_HEIGHT,
  },
  scrollContent: {
    gap: spacing.lg,
    paddingBottom: spacing.lg,
  },
  section: {
    gap: spacing.sm,
  },
  sectionLabel: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyBold,
    color: colors.ink2,
    textAlign: 'left',
    includeFontPadding: false,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  toggleRowActive: {
    borderColor: colors.primary,
    backgroundColor: colors.surface2,
  },
  toggleLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  toggleLabel: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink,
    textAlign: 'left',
    includeFontPadding: false,
  },
  tagSearchInput: {
    backgroundColor: colors.surface1,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.body,
    color: colors.ink,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.md,
    marginTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  footerBtn: {
    flex: 1,
  },
  footerApplyBtn: {
    flex: 1.6,
  },
});
