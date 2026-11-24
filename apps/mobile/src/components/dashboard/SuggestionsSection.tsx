import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { CATEGORY_MAP } from '@cookbook/core/recipe-model';
import { buildRecipeDiffModel } from '@cookbook/core/recipe-utils/recipe-diff-utils';
import { formatIngredientAmount } from '@cookbook/core/recipe-utils/recipe-ingredients-utils';
import { colors, fontFamilies, radii, shadows, spacing, statusColors, typeScale } from '@/theme';
import { Badge, Button, Card, PressableScale, useToast } from '@/components/ui';
import { captureError } from '@/services/logger';
import { MediaInstructionService } from '@/services/recipes/media-instruction-service';
import {
  RecipeEditSuggestionService,
  type RecipeEditSuggestionDoc,
} from '@/services/recipes/recipe-edit-suggestion-service';
import { RecipeImageService } from '@/services/recipes/recipe-image-service';
import { RecipeService, type RecipeDoc } from '@/services/recipes/recipe-service';

export interface SuggestionsSectionProps {
  suggestions: RecipeEditSuggestionDoc[];
  allRecipesById: Record<string, RecipeDoc>;
  loading: boolean;
  refreshing: boolean;
  managerUid: string;
  onRefresh: () => void | Promise<void>;
  onApproved: () => void | Promise<void>;
  onRejected: () => void | Promise<void>;
}

interface ResolvedDiffImage {
  key: string;
  kind: 'added' | 'removed' | 'kept';
  isPrimary: boolean;
  url: string | null;
}

interface ResolvedDiffMedia {
  key: string;
  kind: 'added' | 'removed' | 'changed';
  type: 'image' | 'video';
  url: string | null;
  caption?: string;
  captionBefore?: string;
  captionAfter?: string;
}

function formatBidiAmount(rawAmount: any): string {
  const formatted = formatIngredientAmount(rawAmount);
  if (!formatted) return '';
  return formatted.includes(' ') ? `\u2066${formatted}\u2069` : formatted;
}

function formatShortDate(ts: any): string {
  if (!ts) return '';
  const d =
    typeof ts.toDate === 'function'
      ? ts.toDate()
      : typeof ts.seconds === 'number'
        ? new Date(ts.seconds * 1000)
        : new Date(ts);
  if (!d || Number.isNaN(d.getTime())) return '';
  return `${d.getDate()}.${d.getMonth() + 1}`;
}

export function SuggestionsSection({
  suggestions,
  allRecipesById,
  loading,
  refreshing,
  managerUid,
  onRefresh,
  onApproved,
  onRejected,
}: SuggestionsSectionProps) {
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();

  const [expanded, setExpanded] = useState(true);
  const [activeSuggestion, setActiveSuggestion] = useState<RecipeEditSuggestionDoc | null>(null);
  const [liveRecipe, setLiveRecipe] = useState<RecipeDoc | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [actionBusy, setActionBusy] = useState<'approve' | 'reject' | null>(null);

  const [resolvedImages, setResolvedImages] = useState<ResolvedDiffImage[]>([]);
  const [resolvedMedia, setResolvedMedia] = useState<ResolvedDiffMedia[]>([]);

  const perRecipeCount = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of suggestions) {
      counts[s.recipeId] = (counts[s.recipeId] || 0) + 1;
    }
    return counts;
  }, [suggestions]);

  const diffModel = useMemo(() => {
    if (!activeSuggestion) return null;
    return buildRecipeDiffModel(liveRecipe || {}, activeSuggestion.proposedChanges || {});
  }, [activeSuggestion, liveRecipe]);

  // Load live recipe when review modal opens
  useEffect(() => {
    if (!activeSuggestion) {
      setLiveRecipe(null);
      setResolvedImages([]);
      setResolvedMedia([]);
      return;
    }

    let cancelled = false;
    setLoadingDiff(true);

    RecipeService.getById(activeSuggestion.recipeId)
      .then((doc) => {
        if (!cancelled) {
          setLiveRecipe(doc || allRecipesById[activeSuggestion.recipeId] || null);
        }
      })
      .catch((err) => {
        captureError(err, {
          service: 'dashboard',
          op: 'loadSuggestionLiveRecipe',
          suggestionId: activeSuggestion.id,
          recipeId: activeSuggestion.recipeId,
        });
        if (!cancelled) {
          setLiveRecipe(allRecipesById[activeSuggestion.recipeId] || null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDiff(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeSuggestion, allRecipesById]);

  // Resolve diff image & step-media thumbnails
  useEffect(() => {
    if (!diffModel) {
      setResolvedImages([]);
      setResolvedMedia([]);
      return;
    }

    let cancelled = false;

    const imageEntries: Array<{ img: any; kind: 'added' | 'removed' | 'kept' }> = [
      ...(diffModel.images?.removed || []).map((img: any) => ({ img, kind: 'removed' as const })),
      ...(diffModel.images?.kept || []).map((img: any) => ({ img, kind: 'kept' as const })),
      ...(diffModel.images?.added || []).map((img: any) => ({ img, kind: 'added' as const })),
    ];

    Promise.all(
      imageEntries.map(async ({ img, kind }, idx): Promise<ResolvedDiffImage> => {
        const url = await RecipeImageService.getOptimizedUrl(img, '400x400').catch(() => null);
        return {
          key: `${kind}-${img?.id || idx}`,
          kind,
          isPrimary: Boolean(img?.isPrimary),
          url,
        };
      }),
    ).then((list) => {
      if (!cancelled) setResolvedImages(list);
    });

    const mediaEntries: Array<{
      item: any;
      kind: 'added' | 'removed' | 'changed';
      captionBefore?: string;
      captionAfter?: string;
    }> = [
      ...(diffModel.media?.removed || []).map((item: any) => ({ item, kind: 'removed' as const })),
      ...(diffModel.media?.added || []).map((item: any) => ({ item, kind: 'added' as const })),
      ...(diffModel.media?.captionChanged || []).map((c: any) => ({
        item: c.item,
        kind: 'changed' as const,
        captionBefore: c.before,
        captionAfter: c.after,
      })),
    ];

    Promise.all(
      mediaEntries.map(async (entry, idx): Promise<ResolvedDiffMedia> => {
        const url = await MediaInstructionService.resolveMediaUrl(entry.item).catch(() => null);
        return {
          key: `${entry.kind}-${entry.item?.path || idx}`,
          kind: entry.kind,
          type: entry.item?.type === 'video' ? 'video' : 'image',
          url,
          caption: entry.item?.caption || '',
          captionBefore: entry.captionBefore,
          captionAfter: entry.captionAfter,
        };
      }),
    ).then((list) => {
      if (!cancelled) setResolvedMedia(list);
    });

    return () => {
      cancelled = true;
    };
  }, [diffModel]);

  const handleCloseReview = useCallback(() => {
    if (actionBusy) return;
    setActiveSuggestion(null);
  }, [actionBusy]);

  const handleApprove = useCallback(async () => {
    if (!activeSuggestion || actionBusy) return;
    setActionBusy('approve');
    try {
      await RecipeEditSuggestionService.approve(activeSuggestion.id, {
        reviewedBy: managerUid,
        recipeId: activeSuggestion.recipeId,
      });
      setActiveSuggestion(null);
      showToast('הצעת העריכה אושרה והוחלה', 'success');
      await onApproved();
    } catch (err) {
      captureError(err, {
        service: 'dashboard',
        op: 'approveSuggestion',
        suggestionId: activeSuggestion.id,
        recipeId: activeSuggestion.recipeId,
      });
      showToast('אישור הצעת העריכה נכשל. נסו שוב.', 'error');
    } finally {
      setActionBusy(null);
    }
  }, [activeSuggestion, actionBusy, managerUid, onApproved, showToast]);

  const handleReject = useCallback(async () => {
    if (!activeSuggestion || actionBusy) return;
    setActionBusy('reject');
    try {
      await RecipeEditSuggestionService.reject(activeSuggestion.id, {
        reviewedBy: managerUid,
      });
      setActiveSuggestion(null);
      showToast('הצעת העריכה נדחתה', 'success');
      await onRejected();
    } catch (err) {
      captureError(err, {
        service: 'dashboard',
        op: 'rejectSuggestion',
        suggestionId: activeSuggestion.id,
        recipeId: activeSuggestion.recipeId,
      });
      showToast('דחיית הצעת העריכה נכשלה. נסו שוב.', 'error');
    } finally {
      setActionBusy(null);
    }
  }, [activeSuggestion, actionBusy, managerUid, onRejected, showToast]);

  const activeRecipePendingCount = activeSuggestion
    ? perRecipeCount[activeSuggestion.recipeId] || 1
    : 1;

  return (
    <View testID="dashboard-section-suggestions" collapsable={false}>
      <Card style={styles.sectionCard}>
        {/* Accordion Header */}
        <View style={styles.sectionHeader}>
          <PressableScale
            testID="dashboard-section-suggestions-toggle"
            variant="button"
            onPress={() => setExpanded((prev) => !prev)}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            style={styles.sectionToggle}
          >
            <View style={styles.sectionTitleGroup}>
              <Ionicons name="git-compare-outline" size={20} color={colors.primaryDark} />
              <Text style={styles.sectionTitle}>הצעות עריכה ממתינות</Text>
              <Badge
                label={String(suggestions.length)}
                tone={suggestions.length > 0 ? 'warning' : 'neutral'}
              />
            </View>
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={colors.ink3}
            />
          </PressableScale>

          <PressableScale
            testID="dashboard-section-suggestions-refresh"
            variant="icon"
            disabled={refreshing}
            onPress={() => {
              void onRefresh();
            }}
            accessibilityLabel="רענן הצעות עריכה"
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
            {loading && suggestions.length === 0 ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.emptyText}>טוען הצעות עריכה...</Text>
              </View>
            ) : suggestions.length === 0 ? (
              <Text style={styles.emptyText}>אין הצעות עריכה הממתינות לאישור</Text>
            ) : (
              <View style={styles.list}>
                {suggestions.map((suggestion) => {
                  const countForRecipe = perRecipeCount[suggestion.recipeId] || 1;
                  const sentDate = formatShortDate(suggestion.createdAt);

                  return (
                    <PressableScale
                      key={suggestion.id}
                      testID={`suggestion-item-${suggestion.id}`}
                      variant="card"
                      onPress={() => setActiveSuggestion(suggestion)}
                      style={styles.itemRow}
                    >
                      <View style={styles.itemTopRow}>
                        <View style={styles.itemTitleCol}>
                          <View style={styles.nameRow}>
                            <Text style={styles.itemName} numberOfLines={1}>
                              {suggestion.recipeName || suggestion.recipeId}
                            </Text>
                            {countForRecipe > 1 ? (
                              <Badge label={`${countForRecipe} הצעות`} tone="danger" />
                            ) : null}
                          </View>
                          <Text style={styles.itemMeta} numberOfLines={1}>
                            {[
                              `הוצע על ידי ${suggestion.suggestedByName || suggestion.suggestedBy}`,
                              sentDate,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </Text>
                        </View>
                        <View style={styles.reviewPill}>
                          <Text style={styles.reviewPillText} allowFontScaling={false}>
                            הצג
                          </Text>
                        </View>
                      </View>

                      {suggestion.note ? (
                        <View style={styles.noteBox}>
                          <Text style={styles.noteText} numberOfLines={3}>
                            הערה: {suggestion.note}
                          </Text>
                        </View>
                      ) : (
                        <Text style={styles.hintLine}>הקישו לסקירת השינויים המוצעים</Text>
                      )}
                    </PressableScale>
                  );
                })}
              </View>
            )}
          </View>
        ) : null}
      </Card>

      {/* Edit Suggestion Diff Review Modal */}
      <Modal
        visible={Boolean(activeSuggestion)}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={handleCloseReview}
      >
        <View
          testID="suggestion-review-modal"
          collapsable={false}
          style={[
            styles.modalRoot,
            { paddingTop: Math.max(insets.top, 8), paddingBottom: Math.max(insets.bottom, 8) },
          ]}
        >
          {/* Header */}
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderText}>
              <Text style={styles.modalTitle}>סקירת הצעת עריכה</Text>
              {activeSuggestion ? (
                <Text style={styles.modalSubtitle} numberOfLines={2}>
                  מתכון: {activeSuggestion.recipeName || activeSuggestion.recipeId} · הוצע על ידי{' '}
                  {activeSuggestion.suggestedByName || activeSuggestion.suggestedBy}
                </Text>
              ) : null}
            </View>
            <PressableScale
              variant="icon"
              disabled={Boolean(actionBusy)}
              onPress={handleCloseReview}
              accessibilityLabel="סגור"
              style={styles.closeBtn}
            >
              <Ionicons name="close" size={22} color={colors.ink2} />
            </PressableScale>
          </View>

          {/* Optional note & multi-suggestion warning */}
          {activeSuggestion?.note ? (
            <View style={styles.modalNoteBanner}>
              <Text style={styles.modalNoteText}>הערה: {activeSuggestion.note}</Text>
            </View>
          ) : null}

          {activeRecipePendingCount > 1 ? (
            <View style={styles.multiWarningBanner}>
              <Ionicons name="warning-outline" size={16} color={colors.caution} />
              <Text style={styles.multiWarningText}>
                למתכון זה יש {activeRecipePendingCount} הצעות ממתינות — אישור הצעה זו יסמן את האחרות
                כ״הוחלף״.
              </Text>
            </View>
          ) : null}

          {/* Diff Body */}
          {loadingDiff ? (
            <View style={styles.centerState}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.emptyText}>טוען השוואת שינויים...</Text>
            </View>
          ) : !diffModel || !diffModel.hasChange ? (
            <View style={styles.centerState}>
              <Text style={styles.emptyText}>אין שינויים בתוכן.</Text>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.diffScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Metadata Diff */}
              {Array.isArray(diffModel.meta) && diffModel.meta.length > 0 ? (
                <View style={styles.diffSection}>
                  <Text style={styles.diffSectionTitle}>פרטי המתכון</Text>
                  <View style={styles.metaTable}>
                    {diffModel.meta.map((row: any, idx: number) => {
                      const beforeVal =
                        row.field === 'category'
                          ? CATEGORY_MAP[row.before] || row.before
                          : row.before;
                      const afterVal =
                        row.field === 'category' ? CATEGORY_MAP[row.after] || row.after : row.after;
                      return (
                        <View
                          key={`${row.field}-${idx}`}
                          style={[
                            styles.metaRow,
                            idx > 0 && styles.metaRowBorder,
                            row.changed && styles.metaRowChanged,
                          ]}
                        >
                          <Text style={styles.metaLabel}>{row.label}</Text>
                          <View style={styles.metaValueWrap}>
                            {row.changed ? (
                              <>
                                <Text style={styles.beforeText}>{beforeVal || '—'}</Text>
                                <Text style={styles.arrowText}>←</Text>
                                <Text style={styles.afterText}>{afterVal || '—'}</Text>
                              </>
                            ) : (
                              <Text style={styles.ctxText}>{afterVal || '—'}</Text>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {/* Images Diff */}
              {resolvedImages.length > 0 ? (
                <View style={styles.diffSection}>
                  <View style={styles.diffTitleRow}>
                    <Text style={styles.diffSectionTitle}>תמונות</Text>
                    {diffModel.images?.primaryChanged ? (
                      <Badge label="התמונה הראשית עודכנה" tone="warning" />
                    ) : null}
                  </View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.thumbsRow}
                  >
                    {resolvedImages.map((img) => (
                      <View
                        key={img.key}
                        style={[
                          styles.thumbCard,
                          img.kind === 'added' && styles.thumbAdded,
                          img.kind === 'removed' && styles.thumbRemoved,
                        ]}
                      >
                        {img.url ? (
                          <Image
                            source={{ uri: img.url }}
                            style={styles.thumbImage}
                            contentFit="cover"
                          />
                        ) : (
                          <View style={styles.thumbPlaceholder}>
                            <Ionicons name="image-outline" size={24} color={colors.ink4} />
                          </View>
                        )}
                        <View style={styles.thumbBadges}>
                          {img.kind === 'added' ? <Badge label="נוסף" tone="primary" /> : null}
                          {img.kind === 'removed' ? <Badge label="הוסר" tone="danger" /> : null}
                          {img.isPrimary ? <Badge label="ראשי" tone="neutral" /> : null}
                        </View>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              ) : null}

              {/* Ingredients Diff */}
              {Array.isArray(diffModel.ingredients) && diffModel.ingredients.length > 0 ? (
                <View style={styles.diffSection}>
                  <Text style={styles.diffSectionTitle}>מצרכים</Text>
                  <View style={styles.linesList}>
                    {diffModel.ingredients.map((op: any, idx: number) => {
                      const it = op.item || {};
                      if (it.kind === 'section') {
                        return (
                          <Text
                            key={`ing-sec-${idx}`}
                            style={[
                              styles.subHeadLine,
                              op.type === 'add' && styles.lineAdd,
                              op.type === 'remove' && styles.lineRemove,
                            ]}
                          >
                            {it.title}
                          </Text>
                        );
                      }
                      const ing = it.ingredient || {};
                      const line = [
                        formatBidiAmount(ing.amount),
                        (ing.unit ?? '').toString().trim(),
                        ing.item || it.text,
                      ]
                        .filter(Boolean)
                        .join(' ');
                      return (
                        <View
                          key={`ing-${idx}`}
                          style={[
                            styles.diffLineBox,
                            op.type === 'add' && styles.diffLineBoxAdd,
                            op.type === 'remove' && styles.diffLineBoxRemove,
                          ]}
                        >
                          <Text
                            style={[
                              styles.diffLineText,
                              op.type === 'add' && styles.lineAdd,
                              op.type === 'remove' && styles.lineRemove,
                            ]}
                          >
                            {op.type === 'add' ? '+ ' : op.type === 'remove' ? '− ' : '• '}
                            {line}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {/* Instructions Diff */}
              {Array.isArray(diffModel.instructions) && diffModel.instructions.length > 0 ? (
                <View style={styles.diffSection}>
                  <Text style={styles.diffSectionTitle}>הוראות הכנה</Text>
                  <View style={styles.linesList}>
                    {diffModel.instructions.map((op: any, idx: number) => {
                      const it = op.item || {};
                      if (it.kind === 'stage') {
                        return (
                          <Text
                            key={`stg-${idx}`}
                            style={[
                              styles.subHeadLine,
                              op.type === 'add' && styles.lineAdd,
                              op.type === 'remove' && styles.lineRemove,
                            ]}
                          >
                            {it.title}
                          </Text>
                        );
                      }
                      return (
                        <View
                          key={`step-${idx}`}
                          style={[
                            styles.diffLineBox,
                            op.type === 'add' && styles.diffLineBoxAdd,
                            op.type === 'remove' && styles.diffLineBoxRemove,
                          ]}
                        >
                          <Text
                            style={[
                              styles.diffLineText,
                              op.type === 'add' && styles.lineAdd,
                              op.type === 'remove' && styles.lineRemove,
                            ]}
                          >
                            {op.type === 'add' ? '+ ' : op.type === 'remove' ? '− ' : '• '}
                            {it.text}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {/* Step Media Diff */}
              {resolvedMedia.length > 0 ? (
                <View style={styles.diffSection}>
                  <Text style={styles.diffSectionTitle}>מדיה (הוראות מצולמות)</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.thumbsRow}
                  >
                    {resolvedMedia.map((m) => (
                      <View key={m.key} style={styles.mediaDiffCol}>
                        <View
                          style={[
                            styles.thumbCard,
                            m.kind === 'added' && styles.thumbAdded,
                            m.kind === 'removed' && styles.thumbRemoved,
                          ]}
                        >
                          {m.url && m.type === 'image' ? (
                            <Image
                              source={{ uri: m.url }}
                              style={styles.thumbImage}
                              contentFit="cover"
                            />
                          ) : (
                            <View style={styles.thumbPlaceholder}>
                              <Ionicons
                                name={m.type === 'video' ? 'videocam-outline' : 'image-outline'}
                                size={24}
                                color={colors.ink3}
                              />
                            </View>
                          )}
                          <View style={styles.thumbBadges}>
                            <Badge
                              label={
                                m.kind === 'added'
                                  ? 'נוסף'
                                  : m.kind === 'removed'
                                    ? 'הוסר'
                                    : 'כיתוב עודכן'
                              }
                              tone={
                                m.kind === 'added'
                                  ? 'primary'
                                  : m.kind === 'removed'
                                    ? 'danger'
                                    : 'warning'
                              }
                            />
                          </View>
                        </View>
                        {m.kind === 'changed' ? (
                          <Text style={styles.mediaCaptionDiff} numberOfLines={2}>
                            {m.captionBefore || '—'} ← {m.captionAfter || '—'}
                          </Text>
                        ) : m.caption ? (
                          <Text style={styles.mediaCaptionDiff} numberOfLines={2}>
                            {m.caption}
                          </Text>
                        ) : null}
                      </View>
                    ))}
                  </ScrollView>
                </View>
              ) : null}

              {/* Comments Diff */}
              {Array.isArray(diffModel.comments) && diffModel.comments.length > 0 ? (
                <View style={styles.diffSection}>
                  <Text style={styles.diffSectionTitle}>הערות</Text>
                  <View style={styles.linesList}>
                    {diffModel.comments.map((op: any, idx: number) => (
                      <View
                        key={`cmt-${idx}`}
                        style={[
                          styles.diffLineBox,
                          op.type === 'add' && styles.diffLineBoxAdd,
                          op.type === 'remove' && styles.diffLineBoxRemove,
                        ]}
                      >
                        <Text
                          style={[
                            styles.diffLineText,
                            op.type === 'add' && styles.lineAdd,
                            op.type === 'remove' && styles.lineRemove,
                          ]}
                        >
                          {op.type === 'add' ? '+ ' : op.type === 'remove' ? '− ' : '• '}
                          {op.item?.text || ''}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              {/* Related Recipes Diff */}
              {(diffModel.related?.added?.length || 0) > 0 ||
              (diffModel.related?.removed?.length || 0) > 0 ? (
                <View style={styles.diffSection}>
                  <Text style={styles.diffSectionTitle}>מתכונים קשורים</Text>
                  <View style={styles.relatedWrap}>
                    {(diffModel.related?.removed || []).map((rid: string) => (
                      <Badge
                        key={`rel-rem-${rid}`}
                        label={`− ${allRecipesById[rid]?.name || rid}`}
                        tone="danger"
                      />
                    ))}
                    {(diffModel.related?.added || []).map((rid: string) => (
                      <Badge
                        key={`rel-add-${rid}`}
                        label={`+ ${allRecipesById[rid]?.name || rid}`}
                        tone="success"
                      />
                    ))}
                  </View>
                </View>
              ) : null}
            </ScrollView>
          )}

          {/* Pinned Bottom Toolbar */}
          <View style={styles.modalToolbar}>
            <Button
              testID="suggestion-reject-btn"
              label="דחה"
              variant="danger"
              loading={actionBusy === 'reject'}
              disabled={actionBusy === 'approve' || loadingDiff}
              onPress={() => {
                void handleReject();
              }}
              style={styles.toolbarBtn}
            />
            <Button
              testID="suggestion-approve-btn"
              label="אשר והחל"
              variant="primary"
              loading={actionBusy === 'approve'}
              disabled={actionBusy === 'reject' || loadingDiff}
              onPress={() => {
                void handleApprove();
              }}
              style={styles.toolbarBtn}
            />
          </View>
        </View>
      </Modal>
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
  itemRow: {
    backgroundColor: colors.surface0,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: spacing.md,
    gap: spacing.xs,
  },
  itemTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  itemTitleCol: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  itemName: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: typeScale.step0,
    color: colors.ink,
    textAlign: 'left',
    flexShrink: 1,
  },
  itemMeta: {
    fontFamily: fontFamilies.body,
    fontSize: typeScale.stepMinus1,
    color: colors.ink3,
    textAlign: 'left',
  },
  reviewPill: {
    paddingVertical: 5,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.primaryDark,
    flexShrink: 0,
  },
  reviewPillText: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: 12,
    color: colors.primaryDark,
    includeFontPadding: false,
  },
  noteBox: {
    backgroundColor: colors.surface2,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    marginTop: 4,
  },
  noteText: {
    fontFamily: fontFamilies.body,
    fontSize: typeScale.stepMinus1,
    color: colors.ink2,
    textAlign: 'left',
  },
  hintLine: {
    fontFamily: fontFamilies.body,
    fontSize: 12,
    color: colors.ink3,
    textAlign: 'left',
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
  modalNoteBanner: {
    backgroundColor: colors.surface2,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  modalNoteText: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: typeScale.stepMinus1,
    color: colors.ink,
    textAlign: 'left',
  },
  multiWarningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: statusColors.pendingBg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  multiWarningText: {
    flex: 1,
    fontFamily: fontFamilies.bodyMedium,
    fontSize: 12,
    color: statusColors.pendingText,
    textAlign: 'left',
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  diffScrollContent: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing['2xl'],
  },
  diffSection: {
    gap: spacing.sm,
  },
  diffTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  diffSectionTitle: {
    fontFamily: fontFamilies.heading,
    fontSize: typeScale.step1,
    color: colors.ink,
    textAlign: 'left',
  },
  metaTable: {
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: 'hidden',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  metaRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  metaRowChanged: {
    backgroundColor: statusColors.approvedBg,
  },
  metaLabel: {
    width: 92,
    fontFamily: fontFamilies.bodyBold,
    fontSize: 12,
    color: colors.ink3,
    textAlign: 'left',
    flexShrink: 0,
  },
  metaValueWrap: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  beforeText: {
    fontFamily: fontFamilies.body,
    fontSize: typeScale.stepMinus1,
    color: statusColors.rejectedText,
    textDecorationLine: 'line-through',
  },
  arrowText: {
    fontFamily: fontFamilies.body,
    fontSize: typeScale.stepMinus1,
    color: colors.ink4,
  },
  afterText: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: typeScale.stepMinus1,
    color: statusColors.approvedText,
  },
  ctxText: {
    fontFamily: fontFamilies.body,
    fontSize: typeScale.stepMinus1,
    color: colors.ink,
  },
  thumbsRow: {
    gap: spacing.sm,
    paddingVertical: 2,
  },
  thumbCard: {
    width: 112,
    height: 92,
    borderRadius: radii.sm,
    borderWidth: 2,
    borderColor: colors.hairlineStrong,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
    position: 'relative',
  },
  thumbAdded: {
    borderColor: colors.primary,
  },
  thumbRemoved: {
    borderColor: colors.secondary,
    opacity: 0.85,
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbBadges: {
    position: 'absolute',
    top: 4,
    start: 4,
    flexDirection: 'row',
    gap: 4,
  },
  mediaDiffCol: {
    width: 120,
    gap: 4,
  },
  mediaCaptionDiff: {
    fontFamily: fontFamilies.body,
    fontSize: 11,
    color: colors.ink3,
    textAlign: 'left',
  },
  linesList: {
    gap: 4,
  },
  subHeadLine: {
    fontFamily: fontFamilies.heading,
    fontSize: typeScale.step0,
    color: colors.ink2,
    textAlign: 'left',
    marginTop: spacing.xs,
  },
  diffLineBox: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radii.xs,
    backgroundColor: colors.surface1,
  },
  diffLineBoxAdd: {
    backgroundColor: statusColors.approvedBg,
  },
  diffLineBoxRemove: {
    backgroundColor: statusColors.rejectedBg,
  },
  diffLineText: {
    fontFamily: fontFamilies.body,
    fontSize: typeScale.stepMinus1,
    color: colors.ink,
    lineHeight: 20,
    textAlign: 'left',
  },
  lineAdd: {
    color: statusColors.approvedText,
    fontFamily: fontFamilies.bodyMedium,
  },
  lineRemove: {
    color: statusColors.rejectedText,
    textDecorationLine: 'line-through',
  },
  relatedWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  modalToolbar: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    backgroundColor: colors.surface1,
    ...shadows.level2,
  },
  toolbarBtn: {
    flex: 1,
  },
});
