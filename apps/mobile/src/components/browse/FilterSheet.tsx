import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FilterUtils } from '@cookbook/core/filter-utils';
import { DIFFICULTIES } from '@cookbook/core/recipe-model';
import { colors, fontFamilies, radii, shadows, spacing, typeScale } from '@/theme';
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

interface CountedOption {
  value: string;
  count: number;
}

const MAX_SCROLL_HEIGHT = Math.min(520, Math.round(Dimensions.get('window').height * 0.62));

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
  const scrollRef = useRef<ScrollView | null>(null);
  const [draft, setDraft] = useState<RecipeFilters>(currentFilters);
  const [ingredientDropdownOpen, setIngredientDropdownOpen] = useState(false);
  const [ingredientSearch, setIngredientSearch] = useState('');
  const [tagsDropdownOpen, setTagsDropdownOpen] = useState(false);
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
      setIngredientDropdownOpen(false);
      setIngredientSearch('');
      setTagsDropdownOpen(false);
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

    const ingCounts = new Map<string, number>();
    const tagCounts = new Map<string, number>();
    for (const r of recipes) {
      const ing = typeof r?.mainIngredient === 'string' ? r.mainIngredient.trim() : '';
      if (ing) {
        ingCounts.set(ing, (ingCounts.get(ing) || 0) + 1);
      }
      if (Array.isArray(r?.tags)) {
        const seenInRecipe = new Set<string>();
        for (const rawTag of r.tags) {
          const t = typeof rawTag === 'string' ? rawTag.trim() : '';
          if (t && !seenInRecipe.has(t)) {
            seenInRecipe.add(t);
            tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
          }
        }
      }
    }

    const rawIngredients = Array.isArray(extracted?.mainIngredients)
      ? extracted.mainIngredients
      : [];
    const rawTags = Array.isArray(extracted?.tags) ? extracted.tags : [];

    const sortByPopularityThenHe = (a: CountedOption, b: CountedOption) =>
      b.count - a.count || a.value.localeCompare(b.value, 'he');

    const mainIngredients: CountedOption[] = rawIngredients
      .map((value) => ({ value, count: ingCounts.get(value) || 0 }))
      .sort(sortByPopularityThenHe);

    const tags: CountedOption[] = rawTags
      .map((value) => ({ value, count: tagCounts.get(value) || 0 }))
      .sort(sortByPopularityThenHe);

    return { mainIngredients, tags };
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

  const filteredMainIngredients = useMemo(() => {
    const q = ingredientSearch.trim().toLowerCase();
    if (!q) return availableOptions.mainIngredients;
    return availableOptions.mainIngredients.filter((opt) => opt.value.toLowerCase().includes(q));
  }, [availableOptions.mainIngredients, ingredientSearch]);

  const filteredUnselectedTags = useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    return availableOptions.tags.filter((opt) => {
      if (draft.tags.includes(opt.value)) return false;
      if (!q) return true;
      return opt.value.toLowerCase().includes(q);
    });
  }, [availableOptions.tags, draft.tags, tagSearch]);

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

  const handleSelectMainIngredient = (ingredient: string) => {
    setDraft((prev) => ({
      ...prev,
      mainIngredient: ingredient,
    }));
    setIngredientDropdownOpen(false);
    setIngredientSearch('');
  };

  const handleClearMainIngredient = (e: GestureResponderEvent) => {
    e.stopPropagation?.();
    setDraft((prev) => ({ ...prev, mainIngredient: '' }));
  };

  const handleAddTag = (tag: string) => {
    setDraft((prev) => {
      if (prev.tags.includes(tag)) return prev;
      return { ...prev, tags: [...prev.tags, tag] };
    });
    setTagSearch('');
  };

  const handleRemoveTag = (tag: string) => {
    setDraft((prev) => ({
      ...prev,
      tags: prev.tags.filter((t) => t !== tag),
    }));
  };

  const toggleFavoritesOnly = () => {
    setDraft((prev) => ({
      ...prev,
      favoritesOnly: !prev.favoritesOnly,
    }));
  };

  const handleClear = () => {
    setDraft({ ...EMPTY_FILTERS, tags: [] });
    setIngredientDropdownOpen(false);
    setIngredientSearch('');
    setTagsDropdownOpen(false);
    setTagSearch('');
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

  const showTagsDropdown = tagsDropdownOpen || tagSearch.trim().length > 0;

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
        ref={scrollRef}
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
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

        {/* Main Ingredient (compact searchable dropdown picker) */}
        {availableOptions.mainIngredients.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>מרכיב עיקרי</Text>

            <PressableScale
              variant="card"
              testID="filter-main-ingredient-trigger"
              accessibilityRole="button"
              accessibilityLabel="בחירת מרכיב עיקרי"
              accessibilityState={{ expanded: ingredientDropdownOpen }}
              onPress={() => {
                setIngredientDropdownOpen((open) => {
                  const next = !open;
                  if (next) setTagsDropdownOpen(false);
                  return next;
                });
              }}
              style={[
                styles.pickerTrigger,
                Boolean(draft.mainIngredient) && styles.pickerTriggerActive,
                ingredientDropdownOpen && styles.pickerTriggerOpen,
              ]}
            >
              <Text
                style={[
                  styles.pickerTriggerText,
                  Boolean(draft.mainIngredient) && styles.pickerTriggerTextActive,
                ]}
                numberOfLines={1}
              >
                {draft.mainIngredient || 'הכל'}
              </Text>

              <View style={styles.pickerTriggerActions}>
                {draft.mainIngredient ? (
                  <Pressable
                    testID="filter-main-ingredient-clear"
                    onPress={handleClearMainIngredient}
                    accessibilityRole="button"
                    accessibilityLabel="נקה מרכיב עיקרי"
                    hitSlop={8}
                    style={styles.inlineClearBtn}
                  >
                    <Ionicons name="close-circle" size={18} color={colors.ink3} />
                  </Pressable>
                ) : null}
                <Ionicons
                  name={ingredientDropdownOpen ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={colors.ink3}
                />
              </View>
            </PressableScale>

            {ingredientDropdownOpen ? (
              <View style={[styles.dropdownPanel, shadows.level1]}>
                {availableOptions.mainIngredients.length > 5 ? (
                  <View style={styles.dropdownSearchRow}>
                    <Ionicons name="search-outline" size={16} color={colors.ink3} />
                    <TextInput
                      testID="filter-main-ingredient-search"
                      value={ingredientSearch}
                      onChangeText={setIngredientSearch}
                      placeholder="חיפוש מרכיב עיקרי..."
                      placeholderTextColor={colors.ink4}
                      autoCorrect={false}
                      style={styles.dropdownSearchInput}
                    />
                    {ingredientSearch.length > 0 ? (
                      <Pressable
                        onPress={() => setIngredientSearch('')}
                        hitSlop={8}
                        accessibilityLabel="נקה חיפוש מרכיב"
                      >
                        <Ionicons name="close-circle" size={16} color={colors.ink3} />
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}

                <ScrollView
                  style={styles.dropdownList}
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                >
                  {ingredientSearch.trim().length === 0 ? (
                    <Pressable
                      onPress={() => handleSelectMainIngredient('')}
                      style={[
                        styles.dropdownOption,
                        !draft.mainIngredient && styles.dropdownOptionSelected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.dropdownOptionText,
                          !draft.mainIngredient && styles.dropdownOptionTextSelected,
                        ]}
                      >
                        הכל
                      </Text>
                      {!draft.mainIngredient ? (
                        <Ionicons name="checkmark" size={17} color={colors.primaryDark} />
                      ) : null}
                    </Pressable>
                  ) : null}

                  {filteredMainIngredients.length > 0 ? (
                    filteredMainIngredients.map((opt) => {
                      const isSelected = draft.mainIngredient === opt.value;
                      return (
                        <Pressable
                          key={opt.value}
                          onPress={() => handleSelectMainIngredient(opt.value)}
                          style={[
                            styles.dropdownOption,
                            isSelected && styles.dropdownOptionSelected,
                          ]}
                        >
                          <Text
                            style={[
                              styles.dropdownOptionText,
                              isSelected && styles.dropdownOptionTextSelected,
                            ]}
                            numberOfLines={1}
                          >
                            {opt.value}
                          </Text>
                          <View style={styles.optionTrailing}>
                            {opt.count > 0 ? (
                              <View style={styles.optionCountPill}>
                                <Text style={styles.optionCountText} allowFontScaling={false}>
                                  {opt.count}
                                </Text>
                              </View>
                            ) : null}
                            {isSelected ? (
                              <Ionicons name="checkmark" size={17} color={colors.primaryDark} />
                            ) : null}
                          </View>
                        </Pressable>
                      );
                    })
                  ) : (
                    <Text style={styles.dropdownEmptyText}>לא נמצאו מרכיבים תואמים</Text>
                  )}
                </ScrollView>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Tags (searchable autocomplete input + removable selected tag pills) */}
        {availableOptions.tags.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionLabel}>
                תגיות{draft.tags.length > 0 ? ` (${draft.tags.length} נבחרו)` : ''}
              </Text>
              {draft.tags.length > 0 ? (
                <Pressable onPress={() => setDraft((prev) => ({ ...prev, tags: [] }))} hitSlop={6}>
                  <Text style={styles.clearInlineLink} allowFontScaling={false}>
                    נקה תגיות
                  </Text>
                </Pressable>
              ) : null}
            </View>

            {/* Selected Removable Tag Pills */}
            {draft.tags.length > 0 ? (
              <View style={styles.selectedTagsWrap}>
                {draft.tags.map((tag) => (
                  <PressableScale
                    key={tag}
                    variant="button"
                    testID={`filter-selected-tag-${tag}`}
                    accessibilityRole="button"
                    accessibilityLabel={`הסר תגית ${tag}`}
                    onPress={() => handleRemoveTag(tag)}
                    style={styles.selectedTagPill}
                  >
                    <Text style={styles.selectedTagText} allowFontScaling={false}>
                      {tag}
                    </Text>
                    <Ionicons name="close" size={14} color={colors.buttonColor} />
                  </PressableScale>
                ))}
              </View>
            ) : null}

            {/* Searchable Autocomplete Input */}
            <View
              style={[styles.autocompleteInputRow, showTagsDropdown && styles.pickerTriggerOpen]}
            >
              <Ionicons name="search-outline" size={17} color={colors.ink3} />
              <TextInput
                testID="filter-tag-search-input"
                value={tagSearch}
                onChangeText={(text) => {
                  setTagSearch(text);
                  if (!tagsDropdownOpen) {
                    setTagsDropdownOpen(true);
                    setIngredientDropdownOpen(false);
                  }
                }}
                onFocus={() => {
                  setTagsDropdownOpen(true);
                  setIngredientDropdownOpen(false);
                  setTimeout(() => {
                    scrollRef.current?.scrollToEnd({ animated: true });
                  }, 120);
                }}
                placeholder="חפש והוסף תגיות..."
                placeholderTextColor={colors.ink4}
                autoCorrect={false}
                style={styles.autocompleteInput}
              />
              {tagSearch.length > 0 ? (
                <Pressable
                  onPress={() => setTagSearch('')}
                  hitSlop={8}
                  accessibilityLabel="נקה חיפוש תגית"
                >
                  <Ionicons name="close-circle" size={17} color={colors.ink3} />
                </Pressable>
              ) : null}
              <Pressable
                testID="filter-tags-toggle"
                onPress={() => {
                  setTagsDropdownOpen((open) => {
                    const next = !open;
                    if (next) setIngredientDropdownOpen(false);
                    return next;
                  });
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={showTagsDropdown ? 'סגור רשימת תגיות' : 'פתח רשימת תגיות'}
                style={styles.dropdownChevronBtn}
              >
                <Ionicons
                  name={showTagsDropdown ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={colors.ink3}
                />
              </Pressable>
            </View>

            {showTagsDropdown ? (
              <View style={[styles.dropdownPanel, shadows.level1]}>
                <ScrollView
                  style={styles.dropdownList}
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                >
                  {filteredUnselectedTags.length > 0 ? (
                    filteredUnselectedTags.map((opt) => (
                      <Pressable
                        key={opt.value}
                        onPress={() => handleAddTag(opt.value)}
                        style={styles.dropdownOption}
                      >
                        <Text style={styles.dropdownOptionText} numberOfLines={1}>
                          {opt.value}
                        </Text>
                        <View style={styles.optionTrailing}>
                          {opt.count > 0 ? (
                            <View style={styles.optionCountPill}>
                              <Text style={styles.optionCountText} allowFontScaling={false}>
                                {opt.count}
                              </Text>
                            </View>
                          ) : null}
                          <Ionicons
                            name="add-circle-outline"
                            size={18}
                            color={colors.primaryDark}
                          />
                        </View>
                      </Pressable>
                    ))
                  ) : (
                    <Text style={styles.dropdownEmptyText}>
                      {tagSearch.trim() ? 'לא נמצאו תגיות תואמות' : 'כל התגיות כבר נבחרו'}
                    </Text>
                  )}
                </ScrollView>
              </View>
            ) : null}
          </View>
        ) : null}

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
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sectionLabel: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyBold,
    color: colors.ink2,
    textAlign: 'left',
    includeFontPadding: false,
  },
  clearInlineLink: {
    fontSize: 12,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.primaryDark,
    includeFontPadding: false,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pickerTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    gap: spacing.sm,
  },
  pickerTriggerActive: {
    borderColor: colors.primary,
    backgroundColor: colors.surface2,
  },
  pickerTriggerOpen: {
    borderColor: colors.primary,
  },
  pickerTriggerText: {
    flex: 1,
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    textAlign: 'left',
    includeFontPadding: false,
  },
  pickerTriggerTextActive: {
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
  },
  pickerTriggerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  inlineClearBtn: {
    padding: 2,
  },
  autocompleteInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    gap: spacing.xs,
  },
  autocompleteInput: {
    flex: 1,
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink,
    paddingVertical: 9,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  dropdownChevronBtn: {
    padding: 2,
  },
  dropdownPanel: {
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    overflow: 'hidden',
  },
  dropdownSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    backgroundColor: colors.surface0,
  },
  dropdownSearchInput: {
    flex: 1,
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.body,
    color: colors.ink,
    paddingVertical: 4,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  dropdownList: {
    maxHeight: 192,
  },
  dropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  dropdownOptionSelected: {
    backgroundColor: colors.surface2,
  },
  dropdownOptionText: {
    flex: 1,
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink,
    textAlign: 'left',
  },
  dropdownOptionTextSelected: {
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
  },
  optionTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  optionCountPill: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionCountText: {
    fontSize: 11,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink3,
    includeFontPadding: false,
  },
  dropdownEmptyText: {
    padding: spacing.md,
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    textAlign: 'center',
  },
  selectedTagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  selectedTagPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingVertical: 6,
    paddingHorizontal: 11,
  },
  selectedTagText: {
    fontSize: 12.5,
    fontFamily: fontFamilies.bodyBold,
    color: colors.buttonColor,
    includeFontPadding: false,
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
