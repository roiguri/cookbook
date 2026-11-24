import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CATEGORY_MAP } from '@cookbook/core/recipe-model';
import { colors, fontFamilies, radii, spacing, typeScale } from '@/theme';
import {
  Badge,
  Button,
  Card,
  Chip,
  ConfirmDialog,
  PressableScale,
  useToast,
} from '@/components/ui';
import {
  RecipeForm,
  type RecipeFormCollectedData,
  type RecipeFormHandle,
} from '@/components/recipe-form';
import { captureError } from '@/services/logger';
import { updateRecipeWithAssets } from '@/services/recipes/recipe-edit-suggestion-service';
import type { RecipeDoc } from '@/services/recipes/recipe-service';
import { RecipeSubmissionService } from '@/services/recipes/recipe-submission-service';

const INITIAL_DISPLAY_LIMIT = 30;
const SEARCH_DEBOUNCE_MS = 150;

export interface AllRecipesSectionProps {
  recipes: RecipeDoc[];
  loading: boolean;
  refreshing: boolean;
  managerUid: string;
  onRefresh: () => void | Promise<void>;
  onMutated: () => void | Promise<void>;
}

export function AllRecipesSection({
  recipes,
  loading,
  refreshing,
  managerUid,
  onRefresh,
  onMutated,
}: AllRecipesSectionProps) {
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();

  const [expanded, setExpanded] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [showAll, setShowAll] = useState(false);

  // Edit modal state (directPublish mode)
  const formRef = useRef<RecipeFormHandle | null>(null);
  const [editingRecipe, setEditingRecipe] = useState<RecipeDoc | null>(null);
  const [isPreview, setIsPreview] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<RecipeDoc | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const trimmed = searchInput.trim();
    if (!trimmed) {
      setDebouncedQuery('');
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedQuery(trimmed.toLowerCase());
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const categories = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ key: string; label: string }> = [];
    for (const r of recipes) {
      if (r.category && !seen.has(r.category)) {
        seen.add(r.category);
        out.push({ key: r.category, label: CATEGORY_MAP[r.category] || r.category });
      }
    }
    return out.sort((a, b) => a.label.localeCompare(b.label, 'he'));
  }, [recipes]);

  const filteredRecipes = useMemo(() => {
    return recipes.filter((r) => {
      if (selectedCategory && r.category !== selectedCategory) return false;
      if (debouncedQuery) {
        const name = (r.name || '').toLowerCase();
        if (!name.includes(debouncedQuery)) return false;
      }
      return true;
    });
  }, [recipes, selectedCategory, debouncedQuery]);

  const visibleRecipes = useMemo(() => {
    if (showAll || debouncedQuery || selectedCategory) return filteredRecipes;
    return filteredRecipes.slice(0, INITIAL_DISPLAY_LIMIT);
  }, [filteredRecipes, showAll, debouncedQuery, selectedCategory]);

  const handleEditSubmit = useCallback(
    async (collected: RecipeFormCollectedData) => {
      if (!editingRecipe || !managerUid || savingEdit) return;
      setSavingEdit(true);
      try {
        const {
          images,
          imagesToDelete,
          mediaItemsOrdered,
          mediaToDelete,
          directPublish: _ignoredDirect,
          ...changes
        } = collected;

        await updateRecipeWithAssets(editingRecipe.id, {
          changes,
          images,
          imagesToDelete,
          mediaItemsOrdered,
          mediaToDelete,
          uploadedBy: managerUid,
          directPublish: true,
        });

        setEditingRecipe(null);
        setIsPreview(false);
        showToast('המתכון עודכן ופורסם בהצלחה', 'success');
        await onMutated();
      } catch (err) {
        captureError(err, {
          service: 'dashboard',
          op: 'editPublishedRecipe',
          recipeId: editingRecipe.id,
        });
        showToast('עדכון המתכון נכשל. נסו שוב.', 'error');
      } finally {
        setSavingEdit(false);
      }
    },
    [editingRecipe, managerUid, savingEdit, showToast, onMutated],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await RecipeSubmissionService.deleteRecipe(deleteTarget.id, {
        authorId: deleteTarget.authorId ?? undefined,
        images: deleteTarget.images,
      });
      setDeleteTarget(null);
      showToast('המתכון נמחק בהצלחה', 'success');
      await onMutated();
    } catch (err) {
      captureError(err, {
        service: 'dashboard',
        op: 'deletePublishedRecipe',
        recipeId: deleteTarget.id,
      });
      showToast('מחיקת המתכון נכשלה. נסו שוב.', 'error');
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, deleting, showToast, onMutated]);

  return (
    <View testID="dashboard-section-all-recipes" collapsable={false}>
      <Card style={styles.sectionCard}>
        {/* Accordion Header */}
        <View style={styles.sectionHeader}>
          <PressableScale
            testID="dashboard-section-all-recipes-toggle"
            variant="button"
            onPress={() => setExpanded((prev) => !prev)}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            style={styles.sectionToggle}
          >
            <View style={styles.sectionTitleGroup}>
              <Ionicons name="book-outline" size={20} color={colors.primaryDark} />
              <Text style={styles.sectionTitle}>כל המתכונים</Text>
              <Badge label={String(recipes.length)} tone="neutral" />
            </View>
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={colors.ink3}
            />
          </PressableScale>

          <PressableScale
            testID="dashboard-section-all-recipes-refresh"
            variant="icon"
            disabled={refreshing}
            onPress={() => {
              void onRefresh();
            }}
            accessibilityLabel="רענן את כל המתכונים"
            style={styles.refreshBtn}
          >
            {refreshing ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons name="refresh" size={18} color={colors.ink2} />
            )}
          </PressableScale>
        </View>

        {expanded ? (
          <View style={styles.sectionBody}>
            {/* Search Bar */}
            <View style={styles.searchWrap}>
              <Ionicons name="search-outline" size={18} color={colors.ink3} />
              <TextInput
                testID="all-recipes-search-input"
                value={searchInput}
                onChangeText={setSearchInput}
                placeholder="חיפוש מתכונים..."
                placeholderTextColor={colors.ink4}
                returnKeyType="search"
                style={styles.searchInput}
              />
              {searchInput.length > 0 ? (
                <PressableScale
                  variant="icon"
                  onPress={() => {
                    setSearchInput('');
                    setDebouncedQuery('');
                  }}
                  accessibilityLabel="נקה חיפוש"
                >
                  <Ionicons name="close-circle" size={18} color={colors.ink3} />
                </PressableScale>
              ) : null}
            </View>

            {/* Category Filter Chips */}
            {categories.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.categoryStrip}
              >
                <Chip
                  label="סינון לפי קטגוריה: הכל"
                  selected={selectedCategory === ''}
                  onPress={() => setSelectedCategory('')}
                />
                {categories.map((cat) => (
                  <Chip
                    key={cat.key}
                    label={cat.label}
                    selected={selectedCategory === cat.key}
                    onPress={() => setSelectedCategory((prev) => (prev === cat.key ? '' : cat.key))}
                  />
                ))}
              </ScrollView>
            ) : null}

            {/* Recipe Rows */}
            {loading && recipes.length === 0 ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.emptyText}>טוען מתכונים...</Text>
              </View>
            ) : visibleRecipes.length === 0 ? (
              <Text style={styles.emptyText}>אין מתכונים תואמים להצגה</Text>
            ) : (
              <View style={styles.list}>
                {visibleRecipes.map((recipe) => {
                  const categoryLabel = CATEGORY_MAP[recipe.category] || recipe.category || '—';
                  const totalTime = (Number(recipe.prepTime) || 0) + (Number(recipe.waitTime) || 0);

                  return (
                    <View
                      key={recipe.id}
                      testID={`all-recipes-item-${recipe.id}`}
                      collapsable={false}
                      style={styles.recipeRow}
                    >
                      <View style={styles.recipeInfo}>
                        <Text style={styles.recipeName} numberOfLines={2}>
                          {recipe.name}
                        </Text>
                        <View style={styles.chipsRow}>
                          <Badge label={categoryLabel} tone="neutral" />
                          <Badge label={`${totalTime} דק׳`} tone="neutral" />
                        </View>
                      </View>

                      <View style={styles.recipeActions}>
                        <Button
                          testID={`all-recipes-edit-${recipe.id}`}
                          label="ערוך"
                          variant="outline"
                          size="sm"
                          onPress={() => {
                            setIsPreview(false);
                            setEditingRecipe(recipe);
                          }}
                        />
                        <Button
                          testID={`all-recipes-delete-${recipe.id}`}
                          label="מחק"
                          variant="danger"
                          size="sm"
                          onPress={() => setDeleteTarget(recipe)}
                        />
                      </View>
                    </View>
                  );
                })}

                {!showAll && filteredRecipes.length > visibleRecipes.length ? (
                  <Button
                    label={`הצג את כל המתכונים (${filteredRecipes.length})`}
                    variant="secondary"
                    size="sm"
                    onPress={() => setShowAll(true)}
                  />
                ) : null}
              </View>
            )}
          </View>
        ) : null}
      </Card>

      {/* Direct-Publish Recipe Edit Modal */}
      <Modal
        visible={Boolean(editingRecipe)}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => {
          if (!savingEdit) {
            setEditingRecipe(null);
            setIsPreview(false);
          }
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[
            styles.modalRoot,
            { paddingTop: Math.max(insets.top, 8), paddingBottom: Math.max(insets.bottom, 8) },
          ]}
        >
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderText}>
              <Text style={styles.modalTitle} numberOfLines={1}>
                {isPreview ? 'תצוגה מקדימה' : 'עריכת מתכון'}
              </Text>
              {editingRecipe ? (
                <Text style={styles.modalSubtitle} numberOfLines={1}>
                  {editingRecipe.name} · פרסום ישיר לספר המשפחתי
                </Text>
              ) : null}
            </View>
            <PressableScale
              variant="icon"
              disabled={savingEdit}
              onPress={() => {
                setEditingRecipe(null);
                setIsPreview(false);
              }}
              accessibilityLabel="סגור"
              style={styles.closeBtn}
            >
              <Ionicons name="close" size={22} color={colors.ink2} />
            </PressableScale>
          </View>

          <View style={styles.modalBody}>
            {editingRecipe ? (
              <RecipeForm
                ref={formRef}
                initialRecipe={editingRecipe}
                excludeRecipeId={editingRecipe.id}
                directPublish
                showAiImport={false}
                showPreviewToggle
                submitLabel="שמור ופרסם"
                submitting={savingEdit}
                onPreviewChange={setIsPreview}
                onSubmit={handleEditSubmit}
              />
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Delete Recipe Confirmation Dialog */}
      <ConfirmDialog
        visible={Boolean(deleteTarget)}
        title="מחיקת מתכון"
        message={
          deleteTarget
            ? `האם אתה בטוח שברצונך למחוק את המתכון "${deleteTarget.name}"? פעולה זו תמחק גם את כל המדיה המשויכת ואינה ניתנת לביטול.`
            : ''
        }
        confirmLabel="מחק"
        cancelLabel="ביטול"
        destructive
        loading={deleting}
        confirmTestID="all-recipes-delete-confirm-btn"
        onConfirm={() => {
          void handleConfirmDelete();
        }}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sectionCard: {
    padding: 0,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  sectionToggle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sectionTitleGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minWidth: 0,
  },
  sectionTitle: {
    fontFamily: fontFamilies.heading,
    fontSize: typeScale.step1,
    color: colors.ink,
    textAlign: 'left',
    flexShrink: 1,
  },
  refreshBtn: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  sectionBody: {
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface0,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    paddingHorizontal: spacing.md,
    minHeight: 42,
  },
  searchInput: {
    flex: 1,
    fontFamily: fontFamilies.body,
    fontSize: typeScale.stepMinus1,
    color: colors.ink,
    paddingVertical: 8,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  categoryStrip: {
    gap: spacing.xs,
    paddingVertical: 2,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  emptyText: {
    fontFamily: fontFamilies.body,
    fontSize: typeScale.stepMinus1,
    color: colors.ink3,
    textAlign: 'left',
  },
  list: {
    gap: spacing.sm,
  },
  recipeRow: {
    backgroundColor: colors.surface0,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: spacing.md,
    gap: spacing.sm,
  },
  recipeInfo: {
    gap: 6,
  },
  recipeName: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: typeScale.step0,
    color: colors.ink,
    textAlign: 'left',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  recipeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  modalRoot: {
    flex: 1,
    backgroundColor: colors.surface0,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    backgroundColor: colors.surface1,
    gap: spacing.sm,
  },
  modalHeaderText: {
    flex: 1,
    gap: 2,
  },
  modalTitle: {
    fontFamily: fontFamilies.heading,
    fontSize: typeScale.step2,
    color: colors.ink,
    textAlign: 'left',
  },
  modalSubtitle: {
    fontFamily: fontFamilies.body,
    fontSize: typeScale.stepMinus1,
    color: colors.ink3,
    textAlign: 'left',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBody: {
    flex: 1,
  },
});
