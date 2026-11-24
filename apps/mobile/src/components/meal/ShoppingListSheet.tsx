import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import {
  formatIngredientAmount,
  scaleIngredients,
} from '@cookbook/core/recipe-utils/recipe-ingredients-utils';
import { ingredientLine } from '@cookbook/core/recipe-utils/recipe-text';
import { colors, fontFamilies, radii, shadows, spacing, statusColors, typeScale } from '@/theme';
import { PressableScale, useToast } from '@/components/ui';
import type { RecipeMealState } from '@/services/meals/active-meal-service';

export interface MealIngredient {
  amount?: number | string | null;
  unit?: string;
  item: string;
}

export interface MealIngredientSection {
  title?: string;
  items: MealIngredient[];
}

export interface MealRecipeStage {
  title?: string;
  instructions: string[];
}

export interface MealRecipe {
  id: string;
  name: string;
  category?: string;
  prepTime?: number;
  waitTime?: number;
  difficulty?: string;
  description?: string;
  servings: number;
  servingsUnit?: string;
  ingredients?: MealIngredient[];
  ingredientSections?: MealIngredientSection[];
  instructions?: string[];
  stages?: MealRecipeStage[];
  comments?: string[];
}

export type ShoppingViewMode = 'all' | 'current';

/**
 * Formats an ingredient amount and isolates mixed fractions (e.g. "1 1/2")
 * with Unicode LRI/PDI so Android/iOS RTL paragraphs never reorder them to "1/2 1".
 */
export function formatBidiSafeAmount(rawAmount: number | string | null | undefined): string {
  const formatted = formatIngredientAmount(rawAmount);
  if (!formatted) return '';
  return formatted.includes(' ') ? `\u2066${formatted}\u2069` : formatted;
}

export function getIngredientKey(
  recipeId: string,
  sectionIndex: number,
  itemIndex: number,
): string {
  return `${recipeId}-${sectionIndex}-${itemIndex}`;
}

export function getRecipeIngredientKeys(recipe: MealRecipe, recipeId: string): string[] {
  const keys: string[] = [];
  if (recipe.ingredientSections && recipe.ingredientSections.length > 0) {
    recipe.ingredientSections.forEach((section, sIndex) => {
      (section.items || []).forEach((_, iIndex) => {
        keys.push(getIngredientKey(recipeId, sIndex, iIndex));
      });
    });
  } else if (Array.isArray(recipe.ingredients)) {
    recipe.ingredients.forEach((_, iIndex) => {
      keys.push(getIngredientKey(recipeId, 0, iIndex));
    });
  }
  return keys;
}

function getScaledSectionsForRecipe(
  recipe: MealRecipe,
  targetServings: number,
): Array<{ sectionIndex: number; title?: string; items: MealIngredient[] }> {
  const baseServings = recipe.servings > 0 ? recipe.servings : 1;
  const effectiveTarget = targetServings > 0 ? targetServings : baseServings;

  if (recipe.ingredientSections && recipe.ingredientSections.length > 0) {
    const scaled = scaleIngredients(
      recipe.ingredientSections,
      baseServings,
      effectiveTarget,
    ) as MealIngredientSection[];
    return scaled.map((sec, sIndex) => ({
      sectionIndex: sIndex,
      title: sec.title,
      items: Array.isArray(sec.items) ? sec.items : [],
    }));
  }

  const scaled = scaleIngredients(
    recipe.ingredients || [],
    baseServings,
    effectiveTarget,
  ) as MealIngredient[];
  return [
    {
      sectionIndex: 0,
      items: Array.isArray(scaled) ? scaled : [],
    },
  ];
}

/**
 * Formats selected scaled ingredients for Clipboard / Native Share matching Web `my-meal-page.js` verbatim.
 */
export function buildShoppingListText(params: {
  view: ShoppingViewMode;
  recipeIds: string[];
  activeRecipeId: string | null;
  recipes: Record<string, MealRecipe>;
  recipeStates: Record<string, RecipeMealState>;
  unselectedSet: Set<string>;
}): string {
  const { view, recipeIds, activeRecipeId, recipes, recipeStates, unselectedSet } = params;
  const targetIds = view === 'current' ? (activeRecipeId ? [activeRecipeId] : []) : recipeIds;

  let text = 'רשימת מצרכים:\n\n';

  targetIds.forEach((id) => {
    const recipe = recipes[id];
    if (!recipe) return;

    const allKeys = getRecipeIngredientKeys(recipe, id);
    const hasSelected = allKeys.some((key) => !unselectedSet.has(key));
    if (!hasSelected) return;

    text += `${recipe.name}\n`;
    text += '-'.repeat(Math.max(3, recipe.name.length)) + '\n';

    const state = recipeStates?.[id];
    const targetServings = state?.servings || recipe.servings || 1;
    const sections = getScaledSectionsForRecipe(recipe, targetServings);
    const hasNamedSections = Boolean(
      recipe.ingredientSections && recipe.ingredientSections.length > 0,
    );

    if (hasNamedSections) {
      sections.forEach((section) => {
        let sectionHasItems = false;
        let sectionText = '';
        if (section.title) {
          sectionText += `\n${section.title}:\n`;
        }
        section.items.forEach((item, iIndex) => {
          const key = getIngredientKey(id, section.sectionIndex, iIndex);
          if (!unselectedSet.has(key)) {
            sectionText += `- ${ingredientLine(item)}\n`;
            sectionHasItems = true;
          }
        });
        if (sectionHasItems) {
          text += sectionText;
        }
      });
    } else {
      sections[0]?.items.forEach((item, iIndex) => {
        const key = getIngredientKey(id, 0, iIndex);
        if (!unselectedSet.has(key)) {
          text += `- ${ingredientLine(item)}\n`;
        }
      });
    }

    text += '\n';
  });

  return text;
}

interface ShoppingListSheetProps {
  visible: boolean;
  onClose: () => void;
  recipeIds: string[];
  activeRecipeId: string | null;
  recipes: Record<string, MealRecipe>;
  recipeStates: Record<string, RecipeMealState>;
  unselectedSet: Set<string>;
  onToggleIngredient: (recipeId: string, key: string) => void;
  onBulkSelectRecipes: (shouldSelect: boolean, targetRecipeIds: string[]) => void;
}

export function ShoppingListSheet({
  visible,
  onClose,
  recipeIds,
  activeRecipeId,
  recipes,
  recipeStates,
  unselectedSet,
  onToggleIngredient,
  onBulkSelectRecipes,
}: ShoppingListSheetProps) {
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const [view, setView] = useState<ShoppingViewMode>('all');
  const [copiedFeedback, setCopiedFeedback] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const visibleRecipeIds = useMemo(() => {
    if (view === 'current') {
      return activeRecipeId ? [activeRecipeId] : [];
    }
    return recipeIds;
  }, [view, activeRecipeId, recipeIds]);

  const { totalCount, selectedCount } = useMemo(() => {
    let total = 0;
    let selected = 0;
    visibleRecipeIds.forEach((id) => {
      const recipe = recipes[id];
      if (!recipe) return;
      const keys = getRecipeIngredientKeys(recipe, id);
      total += keys.length;
      keys.forEach((k) => {
        if (!unselectedSet.has(k)) selected += 1;
      });
    });
    return { totalCount: total, selectedCount: selected };
  }, [visibleRecipeIds, recipes, unselectedSet]);

  const handleCopy = async () => {
    const text = buildShoppingListText({
      view,
      recipeIds,
      activeRecipeId,
      recipes,
      recipeStates,
      unselectedSet,
    });
    try {
      await Clipboard.setStringAsync(text);
      setCopiedFeedback(true);
      showToast('רשימת המצרכים הועתקה ללוח', 'success');
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedFeedback(false), 1800);
    } catch {
      showToast('העתקת הרשימה נכשלה', 'error');
    }
  };

  const handleShare = async () => {
    const text = buildShoppingListText({
      view,
      recipeIds,
      activeRecipeId,
      recipes,
      recipeStates,
      unselectedSet,
    });
    try {
      await Share.share({
        title: 'רשימת מצרכים',
        message: text,
      });
    } catch {
      // User cancelled or share failed gracefully
    }
  };

  let flatItemIndex = 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View
          testID="shopping-list-sheet"
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
        >
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.titleBlock}>
              <Text style={styles.title}>רשימת מצרכים</Text>
              {totalCount > 0 ? (
                <Text style={styles.countMeta}>{`${selectedCount} מתוך ${totalCount} נבחרו`}</Text>
              ) : null}
            </View>

            <View style={styles.headerActions}>
              <PressableScale
                variant="icon"
                testID="shopping-copy-btn"
                onPress={handleCopy}
                accessibilityRole="button"
                accessibilityLabel="העתק ללוח"
                style={styles.iconBtn}
              >
                <Ionicons
                  name={copiedFeedback ? 'checkmark' : 'copy-outline'}
                  size={18}
                  color={copiedFeedback ? colors.primaryDark : colors.ink2}
                />
              </PressableScale>

              <PressableScale
                variant="icon"
                testID="shopping-share-btn"
                onPress={handleShare}
                accessibilityRole="button"
                accessibilityLabel="שתף"
                style={styles.iconBtn}
              >
                <Ionicons name="share-social-outline" size={18} color={colors.ink2} />
              </PressableScale>

              <PressableScale
                variant="icon"
                testID="shopping-list-close-btn"
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="סגור"
                style={styles.iconBtn}
              >
                <Ionicons name="close" size={20} color={colors.ink2} />
              </PressableScale>
            </View>
          </View>

          {/* View Mode Segmented Pills & Bulk Controls */}
          <View style={styles.controls}>
            <View style={styles.segmented}>
              <PressableScale
                testID="shopping-view-all-btn"
                onPress={() => setView('all')}
                accessibilityRole="button"
                accessibilityState={{ selected: view === 'all' }}
                style={[styles.segmentBtn, view === 'all' && styles.segmentBtnActive]}
              >
                <Text
                  style={[styles.segmentLabel, view === 'all' && styles.segmentLabelActive]}
                  allowFontScaling={false}
                >
                  כל המצרכים
                </Text>
              </PressableScale>

              <PressableScale
                testID="shopping-view-current-btn"
                onPress={() => setView('current')}
                accessibilityRole="button"
                accessibilityState={{ selected: view === 'current' }}
                style={[styles.segmentBtn, view === 'current' && styles.segmentBtnActive]}
              >
                <Text
                  style={[styles.segmentLabel, view === 'current' && styles.segmentLabelActive]}
                  allowFontScaling={false}
                >
                  מתכון נוכחי
                </Text>
              </PressableScale>
            </View>

            <View style={styles.bulkRow}>
              <PressableScale
                testID="shopping-select-all-btn"
                onPress={() => onBulkSelectRecipes(true, visibleRecipeIds)}
                accessibilityRole="button"
                style={styles.bulkBtn}
              >
                <Text style={styles.bulkText} allowFontScaling={false}>
                  בחר הכל
                </Text>
              </PressableScale>

              <Text style={styles.bulkDivider}>|</Text>

              <PressableScale
                testID="shopping-deselect-all-btn"
                onPress={() => onBulkSelectRecipes(false, visibleRecipeIds)}
                accessibilityRole="button"
                style={styles.bulkBtn}
              >
                <Text style={styles.bulkText} allowFontScaling={false}>
                  בטל הכל
                </Text>
              </PressableScale>
            </View>
          </View>

          {/* Ingredients List */}
          <ScrollView
            style={styles.listScroll}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {visibleRecipeIds.map((id) => {
              const recipe = recipes[id];
              if (!recipe) {
                return (
                  <View key={id} style={styles.missingRecipeBox}>
                    <Text style={styles.missingRecipeText}>טוען מצרכים...</Text>
                  </View>
                );
              }

              const recipeKeys = getRecipeIngredientKeys(recipe, id);
              const allSelected =
                recipeKeys.length > 0 && recipeKeys.every((k) => !unselectedSet.has(k));
              const someSelected = recipeKeys.some((k) => !unselectedSet.has(k));
              const indeterminate = someSelected && !allSelected;

              const state = recipeStates?.[id];
              const targetServings = state?.servings || recipe.servings || 1;
              const sections = getScaledSectionsForRecipe(recipe, targetServings);
              const hasNamedSections = Boolean(
                recipe.ingredientSections && recipe.ingredientSections.length > 0,
              );

              return (
                <View key={id} style={styles.recipeGroup}>
                  {view === 'all' ? (
                    <PressableScale
                      variant="card"
                      onPress={() => onBulkSelectRecipes(!allSelected, [id])}
                      accessibilityRole="checkbox"
                      accessibilityState={{
                        checked: allSelected ? true : indeterminate ? 'mixed' : false,
                      }}
                      style={styles.recipeHeaderRow}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          styles.recipeCheckbox,
                          (allSelected || indeterminate) && styles.checkboxChecked,
                        ]}
                      >
                        {allSelected ? (
                          <Ionicons name="checkmark" size={14} color={colors.buttonColor} />
                        ) : indeterminate ? (
                          <Ionicons name="remove" size={14} color={colors.buttonColor} />
                        ) : null}
                      </View>
                      <Text style={styles.recipeHeaderTitle} numberOfLines={2}>
                        {recipe.name}
                      </Text>
                      <View style={styles.servingsPill}>
                        <Text style={styles.servingsPillText} allowFontScaling={false}>
                          {`${targetServings} ${recipe.servingsUnit || 'מנות'}`}
                        </Text>
                      </View>
                    </PressableScale>
                  ) : null}

                  {sections.map((section) => (
                    <View key={`${id}-sec-${section.sectionIndex}`}>
                      {hasNamedSections && section.title ? (
                        <Text style={styles.sectionTitle}>{section.title}</Text>
                      ) : null}

                      {section.items.map((item, iIndex) => {
                        const key = getIngredientKey(id, section.sectionIndex, iIndex);
                        const isUnselected = unselectedSet.has(key);
                        const itemTestId = `shopping-item-${flatItemIndex}`;
                        flatItemIndex += 1;

                        const bidiAmount = formatBidiSafeAmount(item.amount);
                        const unit = (item.unit ?? '').toString().trim();
                        const itemName = (item.item ?? '').toString().trim();

                        return (
                          <Pressable
                            key={key}
                            testID={itemTestId}
                            onPress={() => onToggleIngredient(id, key)}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: !isUnselected }}
                            style={({ pressed }) => [
                              styles.ingredientRow,
                              isUnselected && styles.ingredientRowUnselected,
                              pressed && styles.ingredientRowPressed,
                            ]}
                          >
                            <View
                              style={[styles.checkbox, !isUnselected && styles.checkboxChecked]}
                            >
                              {!isUnselected ? (
                                <Ionicons name="checkmark" size={13} color={colors.buttonColor} />
                              ) : null}
                            </View>

                            <View style={styles.ingredientParts}>
                              {bidiAmount ? (
                                <Text
                                  style={[
                                    styles.amountText,
                                    isUnselected && styles.strikethroughText,
                                  ]}
                                >
                                  {bidiAmount}
                                </Text>
                              ) : null}
                              {unit ? (
                                <Text
                                  style={[
                                    styles.unitText,
                                    isUnselected && styles.strikethroughText,
                                  ]}
                                >
                                  {unit}
                                </Text>
                              ) : null}
                              <Text
                                style={[styles.itemText, isUnselected && styles.strikethroughText]}
                              >
                                {itemName}
                              </Text>
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  ))}
                </View>
              );
            })}

            {visibleRecipeIds.length === 0 ? (
              <View style={styles.emptyListBox}>
                <Text style={styles.emptyListText}>אין מצרכים להצגה</Text>
              </View>
            ) : null}
          </ScrollView>

          {/* Bottom Quick Copy/Share Bar */}
          <View style={styles.footerBar}>
            <PressableScale onPress={handleCopy} style={styles.footerPrimaryBtn}>
              <Ionicons
                name={copiedFeedback ? 'checkmark-circle-outline' : 'copy-outline'}
                size={18}
                color={colors.buttonColor}
              />
              <Text style={styles.footerPrimaryLabel} allowFontScaling={false}>
                {copiedFeedback ? 'הועתק!' : 'העתק ללוח'}
              </Text>
            </PressableScale>

            <PressableScale onPress={handleShare} style={styles.footerSecondaryBtn}>
              <Ionicons name="share-social-outline" size={18} color={colors.primaryDark} />
              <Text style={styles.footerSecondaryLabel} allowFontScaling={false}>
                שתף
              </Text>
            </PressableScale>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: statusColors.overlayBackdrop,
  },
  sheet: {
    backgroundColor: colors.surface0,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    maxHeight: '88%',
    minHeight: '55%',
    borderWidth: 1,
    borderColor: colors.hairline,
    ...shadows.level3,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.hairlineStrong,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface2,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairlineStrong,
    gap: spacing.sm,
  },
  titleBlock: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: typeScale.step2,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    textAlign: 'left',
  },
  countMeta: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    textAlign: 'left',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controls: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface1,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    gap: spacing.sm,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.hairline,
    borderRadius: radii.pill,
    padding: 3,
    gap: 2,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBtnActive: {
    backgroundColor: colors.surface1,
    ...shadows.level1,
  },
  segmentLabel: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink3,
    textAlign: 'center',
    includeFontPadding: false,
  },
  segmentLabelActive: {
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
  },
  bulkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  bulkBtn: {
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
  },
  bulkText: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
    includeFontPadding: false,
  },
  bulkDivider: {
    fontSize: typeScale.step0,
    color: colors.ink4,
    fontFamily: fontFamilies.body,
  },
  listScroll: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  recipeGroup: {
    gap: spacing.xs,
  },
  recipeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface2,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  recipeHeaderTitle: {
    flex: 1,
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyBold,
    color: colors.ink,
    textAlign: 'left',
  },
  servingsPill: {
    backgroundColor: colors.surface1,
    borderRadius: radii.pill,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  servingsPillText: {
    fontSize: 12,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink2,
    includeFontPadding: false,
  },
  sectionTitle: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyBold,
    color: colors.ink3,
    textAlign: 'left',
    marginTop: spacing.sm,
    marginBottom: 2,
  },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  ingredientRowUnselected: {
    opacity: 0.45,
  },
  ingredientRowPressed: {
    backgroundColor: colors.pressTint,
    borderRadius: radii.xs,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: radii.xs,
    borderWidth: 1.5,
    borderColor: colors.hairlineStrong,
    backgroundColor: colors.surface1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recipeCheckbox: {
    borderColor: colors.ink3,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  ingredientParts: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 5,
  },
  amountText: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
    writingDirection: 'ltr',
  },
  unitText: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink2,
  },
  itemText: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink,
    flexShrink: 1,
    textAlign: 'left',
  },
  strikethroughText: {
    textDecorationLine: 'line-through',
    color: colors.ink3,
  },
  missingRecipeBox: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  missingRecipeText: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
  },
  emptyListBox: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  emptyListText: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
  },
  footerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    backgroundColor: colors.surface1,
  },
  footerPrimaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
  },
  footerPrimaryLabel: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyBold,
    color: colors.buttonColor,
    includeFontPadding: false,
  },
  footerSecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    borderRadius: radii.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
  },
  footerSecondaryLabel: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
    includeFontPadding: false,
  },
});
