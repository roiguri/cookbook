import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { CATEGORY_MAP, STAGE } from '@cookbook/core/recipe-model';
import { formatIngredientAmount } from '@cookbook/core/recipe-utils/recipe-ingredients-utils';
import { colors, fontFamilies, radii, shadows, spacing, statusColors, typeScale } from '@/theme';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ModalSheet,
  PressableScale,
  useToast,
} from '@/components/ui';
import { captureError } from '@/services/logger';
import { RecipeImageService } from '@/services/recipes/recipe-image-service';
import {
  RecipeSubmissionService,
  type PendingSubmissionRow,
} from '@/services/recipes/recipe-submission-service';
import { UserService, type UserProfileDoc } from '@/services/users/user-service';

export interface SubmissionsSectionProps {
  items: PendingSubmissionRow[];
  usersById: Record<string, UserProfileDoc>;
  loading: boolean;
  refreshing: boolean;
  managerUid: string;
  onRefresh: () => void | Promise<void>;
  onMutated: () => void | Promise<void>;
}

function toDateObj(ts: any): Date | null {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
  if (ts instanceof Date) return ts;
  const parsed = new Date(ts);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatShortDate(ts: any): string {
  const d = toDateObj(ts);
  if (!d) return '';
  return `${d.getDate()}.${d.getMonth() + 1}`;
}

function formatBidiAmount(rawAmount: any): string {
  const formatted = formatIngredientAmount(rawAmount);
  if (!formatted) return '';
  return formatted.includes(' ') ? `\u2066${formatted}\u2069` : formatted;
}

function renderIngredientText(ing: any): string {
  if (typeof ing === 'string') return ing;
  if (!ing || typeof ing !== 'object') return String(ing ?? '');
  const parts = [formatBidiAmount(ing.amount), ing.unit, ing.item]
    .map((p) => (p ?? '').toString().trim())
    .filter(Boolean);
  return parts.join(' ');
}

export function SubmissionsSection({
  items,
  usersById,
  loading,
  refreshing,
  managerUid,
  onRefresh,
  onMutated,
}: SubmissionsSectionProps) {
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();

  const [expanded, setExpanded] = useState(false);
  const [extraAuthors, setExtraAuthors] = useState<Record<string, UserProfileDoc | null>>({});
  const [busyRecipeId, setBusyRecipeId] = useState<string | null>(null);

  // Preview modal state
  const [previewRow, setPreviewRow] = useState<PendingSubmissionRow | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  // Dual-mode rejection modals
  const [rejectNoteTarget, setRejectNoteTarget] = useState<PendingSubmissionRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectValidationError, setRejectValidationError] = useState<string | null>(null);
  const [rejectSubmitting, setRejectSubmitting] = useState(false);

  const [discardTarget, setDiscardTarget] = useState<PendingSubmissionRow | null>(null);
  const [discardSubmitting, setDiscardSubmitting] = useState(false);

  // Resolve any author UIDs not present in usersById so dual-mode rejection always knows exact role
  useEffect(() => {
    const missingUids = Array.from(
      new Set(
        items
          .map((row) => row.recipe?.authorId || row.authorId)
          .filter(
            (uid): uid is string =>
              typeof uid === 'string' &&
              uid.length > 0 &&
              !(uid in usersById) &&
              !(uid in extraAuthors),
          ),
      ),
    );
    if (missingUids.length === 0) return;

    let cancelled = false;
    Promise.all(
      missingUids.map(async (uid) => {
        const doc = await UserService.get(uid).catch(() => null);
        return [uid, doc] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setExtraAuthors((prev) => {
        const next = { ...prev };
        for (const [uid, doc] of entries) {
          next[uid] = doc;
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [items, usersById, extraAuthors]);

  // Load preview primary image when opening recipe preview
  useEffect(() => {
    if (!previewRow?.recipe) {
      setPreviewImageUrl(null);
      return;
    }
    let cancelled = false;
    RecipeImageService.getPrimaryUrl(previewRow.recipe, 'full')
      .then((url) => {
        if (!cancelled) setPreviewImageUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPreviewImageUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [previewRow]);

  const getAuthorDoc = useCallback(
    (row: PendingSubmissionRow): UserProfileDoc | null => {
      const uid = row.recipe?.authorId || row.authorId;
      if (!uid) return null;
      return usersById[uid] ?? extraAuthors[uid] ?? null;
    },
    [usersById, extraAuthors],
  );

  const getAuthorName = useCallback(
    (row: PendingSubmissionRow): string => {
      const author = getAuthorDoc(row);
      return author?.fullName || author?.email || row.authorName || 'משתמש לא ידוע';
    },
    [getAuthorDoc],
  );

  const getRejectMode = useCallback(
    (row: PendingSubmissionRow): 'note' | 'discard' => {
      const author = getAuthorDoc(row);
      return author?.role === 'user' ? 'discard' : 'note';
    },
    [getAuthorDoc],
  );

  const handleApprove = useCallback(
    async (row: PendingSubmissionRow) => {
      const recipeId = row.recipe?.id || row.recipeId || row.id;
      if (!recipeId || busyRecipeId) return;
      setBusyRecipeId(recipeId);
      try {
        await RecipeSubmissionService.approve(recipeId, managerUid);
        setPreviewRow(null);
        showToast(
          `״${row.recipe?.name || row.recipeName || 'המתכון'}״ נוסף לספר המשפחתי`,
          'success',
        );
        await onMutated();
      } catch (err) {
        captureError(err, { service: 'dashboard', op: 'approveSubmission', recipeId });
        showToast('אישור המתכון נכשל. נסו שוב.', 'error');
      } finally {
        setBusyRecipeId(null);
      }
    },
    [busyRecipeId, managerUid, onMutated, showToast],
  );

  const openRejectFlow = useCallback(
    async (row: PendingSubmissionRow) => {
      // Close preview modal first so iOS never stacks two native Modals
      setPreviewRow(null);

      // Ensure we know the author's exact role even if users list is still loading
      let author = getAuthorDoc(row);
      const authorId = row.recipe?.authorId || row.authorId;
      if (!author && authorId) {
        author = await UserService.get(authorId).catch(() => null);
        if (author) {
          setExtraAuthors((prev) => ({ ...prev, [authorId]: author }));
        }
      }

      const mode: 'note' | 'discard' = author?.role === 'user' ? 'discard' : 'note';
      if (mode === 'discard') {
        setDiscardTarget(row);
      } else {
        setRejectReason('');
        setRejectValidationError(null);
        setRejectNoteTarget(row);
      }
    },
    [getAuthorDoc],
  );

  const handleConfirmRejectWithNote = useCallback(async () => {
    if (!rejectNoteTarget || rejectSubmitting) return;
    const trimmed = rejectReason.trim();
    if (!trimmed) {
      setRejectValidationError('יש להזין סיבת דחייה לפני דחיית המתכון');
      return;
    }

    const recipeId =
      rejectNoteTarget.recipe?.id || rejectNoteTarget.recipeId || rejectNoteTarget.id;
    setRejectSubmitting(true);
    setRejectValidationError(null);
    try {
      await RecipeSubmissionService.reject(recipeId, managerUid, trimmed);
      setRejectNoteTarget(null);
      setRejectReason('');
      showToast('המתכון נדחה וההערה נשלחה למחבר', 'success');
      await onMutated();
    } catch (err) {
      captureError(err, { service: 'dashboard', op: 'rejectSubmission', recipeId });
      showToast('דחיית המתכון נכשלה. נסו שוב.', 'error');
    } finally {
      setRejectSubmitting(false);
    }
  }, [rejectNoteTarget, rejectSubmitting, rejectReason, managerUid, onMutated, showToast]);

  const handleConfirmDiscard = useCallback(async () => {
    if (!discardTarget || discardSubmitting) return;
    const recipeId = discardTarget.recipe?.id || discardTarget.recipeId || discardTarget.id;
    setDiscardSubmitting(true);
    try {
      await RecipeSubmissionService.discard(recipeId);
      setDiscardTarget(null);
      showToast('המתכון נדחה ונמחק', 'success');
      await onMutated();
    } catch (err) {
      captureError(err, { service: 'dashboard', op: 'discardSubmission', recipeId });
      showToast('מחיקת ההצעה נכשלה. נסו שוב.', 'error');
    } finally {
      setDiscardSubmitting(false);
    }
  }, [discardTarget, discardSubmitting, onMutated, showToast]);

  const previewMeta = useMemo(() => {
    if (!previewRow?.recipe) return null;
    const recipe = previewRow.recipe;
    const totalTime = (Number(recipe.prepTime) || 0) + (Number(recipe.waitTime) || 0);
    return {
      categoryLabel: CATEGORY_MAP[recipe.category] || recipe.category || '—',
      totalTime,
      authorName: getAuthorName(previewRow),
      sentDate: formatShortDate(
        previewRow.resubmittedAt || previewRow.submittedAt || previewRow.createdAt,
      ),
      untested: recipe.stage === STAGE.TO_TRY,
      resubmitted: Boolean(previewRow.resubmittedAt),
      rejectMode: getRejectMode(previewRow),
    };
  }, [previewRow, getAuthorName, getRejectMode]);

  return (
    <View testID="dashboard-panel-submissions" collapsable={false}>
      <Card style={styles.sectionCard}>
        {/* Accordion Header */}
        <View style={styles.sectionHeader}>
          <PressableScale
            testID="dashboard-section-submissions"
            variant="button"
            onPress={() => setExpanded((prev) => !prev)}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            style={styles.sectionToggle}
          >
            <View style={styles.sectionTitleGroup}>
              <Ionicons name="checkmark-done-circle-outline" size={20} color={colors.primaryDark} />
              <Text style={styles.sectionTitle}>מתכונים ממתינים לאישור</Text>
              <Badge label={String(items.length)} tone={items.length > 0 ? 'warning' : 'neutral'} />
            </View>
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={colors.ink3}
            />
          </PressableScale>

          <PressableScale
            testID="dashboard-section-submissions-refresh"
            variant="icon"
            disabled={refreshing}
            onPress={() => {
              void onRefresh();
            }}
            accessibilityLabel="רענן מתכונים ממתינים"
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
            {loading && items.length === 0 ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.emptyText}>טוען מתכונים ממתינים...</Text>
              </View>
            ) : items.length === 0 ? (
              <Text style={styles.emptyText}>אין מתכונים הממתינים לאישור</Text>
            ) : (
              <View style={styles.list}>
                {items.map((row) => {
                  const recipe = row.recipe || {};
                  const recipeId = recipe.id || row.recipeId || row.id;
                  const categoryLabel = CATEGORY_MAP[recipe.category] || recipe.category || '—';
                  const authorName = getAuthorName(row);
                  const sentDate = formatShortDate(
                    row.resubmittedAt || row.submittedAt || row.createdAt,
                  );
                  const isUntested = recipe.stage === STAGE.TO_TRY;
                  const isResubmitted = Boolean(row.resubmittedAt);
                  const isBusy = busyRecipeId === recipeId;

                  return (
                    <View
                      key={recipeId}
                      testID={`submission-item-${recipeId}`}
                      collapsable={false}
                      style={styles.itemRow}
                    >
                      <View style={styles.itemHeader}>
                        <View style={styles.itemTitleCol}>
                          <Text style={styles.itemName} numberOfLines={2}>
                            {recipe.name || row.recipeName || recipeId}
                          </Text>
                          <View style={styles.flagsRow}>
                            {isUntested ? <Badge label="עוד לא נוסה" tone="warning" /> : null}
                            {isResubmitted ? <Badge label="הגשה חוזרת" tone="neutral" /> : null}
                          </View>
                          <Text style={styles.itemMeta} numberOfLines={2}>
                            {[categoryLabel, authorName, sentDate].filter(Boolean).join(' · ')}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.itemActions}>
                        <Button
                          label="הצג"
                          variant="outline"
                          size="sm"
                          disabled={isBusy}
                          onPress={() => setPreviewRow(row)}
                          style={styles.actionBtn}
                        />
                        <Button
                          testID={`submission-approve-${recipeId}`}
                          label="אשר"
                          variant="primary"
                          size="sm"
                          loading={isBusy}
                          disabled={Boolean(busyRecipeId && !isBusy)}
                          onPress={() => {
                            void handleApprove(row);
                          }}
                          style={styles.actionBtn}
                        />
                        <Button
                          testID={`submission-reject-${recipeId}`}
                          label="דחה"
                          variant="danger"
                          size="sm"
                          disabled={Boolean(busyRecipeId)}
                          onPress={() => {
                            void openRejectFlow(row);
                          }}
                          style={styles.actionBtn}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        ) : null}
      </Card>

      {/* Recipe Preview Modal */}
      <Modal
        visible={Boolean(previewRow)}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setPreviewRow(null)}
      >
        <View
          style={[
            styles.modalRoot,
            { paddingTop: Math.max(insets.top, 8), paddingBottom: Math.max(insets.bottom, 8) },
          ]}
        >
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderText}>
              <Text style={styles.modalTitle} numberOfLines={1}>
                {previewRow?.recipe?.name || 'תצוגה מקדימה'}
              </Text>
              {previewMeta ? (
                <Text style={styles.modalSubtitle} numberOfLines={2}>
                  {[previewMeta.authorName, previewMeta.sentDate].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
            </View>
            <PressableScale
              variant="icon"
              onPress={() => setPreviewRow(null)}
              accessibilityLabel="סגור"
              style={styles.closeBtn}
            >
              <Ionicons name="close" size={22} color={colors.ink2} />
            </PressableScale>
          </View>

          <ScrollView
            contentContainerStyle={styles.previewBody}
            showsVerticalScrollIndicator={false}
          >
            {previewImageUrl ? (
              <Image
                source={{ uri: previewImageUrl }}
                style={styles.previewImage}
                contentFit="cover"
                transition={150}
              />
            ) : null}

            {previewMeta ? (
              <View style={styles.previewBadges}>
                <Badge label={previewMeta.categoryLabel} tone="neutral" />
                {previewMeta.totalTime > 0 ? (
                  <Badge label={`${previewMeta.totalTime} דק׳`} tone="neutral" />
                ) : null}
                {previewRow?.recipe?.difficulty ? (
                  <Badge label={String(previewRow.recipe.difficulty)} tone="neutral" />
                ) : null}
                {previewMeta.untested ? <Badge label="עוד לא נוסה" tone="warning" /> : null}
                {previewMeta.resubmitted ? <Badge label="הגשה חוזרת" tone="neutral" /> : null}
              </View>
            ) : null}

            {previewRow?.recipe?.description ? (
              <Text style={styles.previewDesc}>{previewRow.recipe.description}</Text>
            ) : null}

            {/* Ingredients */}
            <View style={styles.previewSection}>
              <Text style={styles.previewSectionTitle}>מצרכים</Text>
              {Array.isArray(previewRow?.recipe?.ingredientSections) &&
              previewRow.recipe.ingredientSections.length > 0 ? (
                previewRow.recipe.ingredientSections.map((sec: any, sIdx: number) => (
                  <View key={`sec-${sIdx}`} style={styles.previewSubBlock}>
                    {sec.title ? <Text style={styles.previewSubTitle}>{sec.title}</Text> : null}
                    {(sec.items || []).map((ing: any, iIdx: number) => (
                      <Text key={`ing-${sIdx}-${iIdx}`} style={styles.previewLine}>
                        • {renderIngredientText(ing)}
                      </Text>
                    ))}
                  </View>
                ))
              ) : Array.isArray(previewRow?.recipe?.ingredients) &&
                previewRow.recipe.ingredients.length > 0 ? (
                previewRow.recipe.ingredients.map((ing: any, iIdx: number) => (
                  <Text key={`ing-${iIdx}`} style={styles.previewLine}>
                    • {renderIngredientText(ing)}
                  </Text>
                ))
              ) : (
                <Text style={styles.emptyText}>אין מצרכים</Text>
              )}
            </View>

            {/* Instructions */}
            <View style={styles.previewSection}>
              <Text style={styles.previewSectionTitle}>הוראות הכנה</Text>
              {Array.isArray(previewRow?.recipe?.stages) && previewRow.recipe.stages.length > 0 ? (
                previewRow.recipe.stages.map((stage: any, stIdx: number) => (
                  <View key={`stg-${stIdx}`} style={styles.previewSubBlock}>
                    {stage.title ? <Text style={styles.previewSubTitle}>{stage.title}</Text> : null}
                    {(stage.instructions || []).map((step: any, stepIdx: number) => (
                      <Text key={`step-${stIdx}-${stepIdx}`} style={styles.previewLine}>
                        {stepIdx + 1}. {typeof step === 'string' ? step : step?.text || ''}
                      </Text>
                    ))}
                  </View>
                ))
              ) : Array.isArray(previewRow?.recipe?.instructions) &&
                previewRow.recipe.instructions.length > 0 ? (
                previewRow.recipe.instructions.map((step: any, stepIdx: number) => (
                  <Text key={`step-${stepIdx}`} style={styles.previewLine}>
                    {stepIdx + 1}. {typeof step === 'string' ? step : step?.text || ''}
                  </Text>
                ))
              ) : (
                <Text style={styles.emptyText}>אין הוראות הכנה</Text>
              )}
            </View>

            {Array.isArray(previewRow?.recipe?.comments) &&
            previewRow.recipe.comments.length > 0 ? (
              <View style={styles.previewSection}>
                <Text style={styles.previewSectionTitle}>הערות</Text>
                {previewRow.recipe.comments.map((comment: string, cIdx: number) => (
                  <Text key={`cmt-${cIdx}`} style={styles.previewLine}>
                    • {comment}
                  </Text>
                ))}
              </View>
            ) : null}
          </ScrollView>

          {previewRow ? (
            <View style={styles.previewToolbar}>
              <Button
                label={previewMeta?.rejectMode === 'discard' ? 'דחייה ומחיקה' : 'דחה'}
                variant="danger"
                onPress={() => {
                  void openRejectFlow(previewRow);
                }}
                style={styles.toolbarBtn}
              />
              <Button
                label="אשר ופרסם"
                variant="primary"
                loading={Boolean(busyRecipeId)}
                onPress={() => {
                  void handleApprove(previewRow);
                }}
                style={styles.toolbarBtn}
              />
            </View>
          ) : null}
        </View>
      </Modal>

      {/* Dual-Mode Reject #1: Family / Manager Author -> Mandatory Rejection Note */}
      <ModalSheet
        visible={Boolean(rejectNoteTarget)}
        title={`לדחות את ״${rejectNoteTarget?.recipe?.name || 'המתכון'}״?`}
        onClose={() => {
          if (rejectSubmitting) return;
          setRejectNoteTarget(null);
          setRejectReason('');
          setRejectValidationError(null);
        }}
      >
        <View style={styles.rejectBody}>
          <Text style={styles.rejectSubtitle}>
            ההערה תופיע בעמוד המתכון. המתכון נשאר פרטי ולא נמחק.
          </Text>

          <Text style={styles.fieldLabel}>מה צריך לתקן?</Text>
          <TextInput
            testID="reject-reason-input"
            value={rejectReason}
            onChangeText={(text) => {
              setRejectReason(text);
              if (rejectValidationError && text.trim()) {
                setRejectValidationError(null);
              }
            }}
            placeholder="כתבו כאן מה צריך לתקן לפני שליחה חוזרת..."
            placeholderTextColor={colors.ink4}
            multiline
            numberOfLines={4}
            editable={!rejectSubmitting}
            textAlignVertical="top"
            style={[styles.rejectInput, Boolean(rejectValidationError) && styles.rejectInputError]}
          />
          <Text style={styles.fieldHint}>חובה · כדי שיהיה ברור מה לתקן לפני שליחה חוזרת</Text>

          {rejectValidationError ? (
            <Text testID="reject-validation-error" style={styles.validationError}>
              {rejectValidationError}
            </Text>
          ) : null}

          <View style={styles.rejectActions}>
            <Button
              label="ביטול"
              variant="secondary"
              disabled={rejectSubmitting}
              onPress={() => {
                setRejectNoteTarget(null);
                setRejectReason('');
                setRejectValidationError(null);
              }}
              style={styles.rejectActionBtn}
            />
            <Button
              testID="reject-confirm-btn"
              label="דחייה ושליחת הערה"
              variant="danger"
              loading={rejectSubmitting}
              onPress={() => {
                void handleConfirmRejectWithNote();
              }}
              style={[styles.rejectActionBtn, !rejectReason.trim() && styles.rejectBtnSubdued]}
            />
          </View>
        </View>
      </ModalSheet>

      {/* Dual-Mode Reject #2: Plain User Author -> Discard & Delete Confirmation */}
      <ConfirmDialog
        visible={Boolean(discardTarget)}
        title={`לדחות ולמחוק את ״${discardTarget?.recipe?.name || 'המתכון'}״?`}
        message="המתכון נשלח ממשתמש בלי ספרייה פרטית, ולכן הוא יימחק יחד עם התמונות שלו."
        confirmLabel="דחייה ומחיקה"
        cancelLabel="ביטול"
        destructive
        loading={discardSubmitting}
        confirmTestID="discard-confirm-btn"
        onConfirm={() => {
          void handleConfirmDiscard();
        }}
        onCancel={() => {
          if (!discardSubmitting) setDiscardTarget(null);
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
    gap: spacing.sm,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  itemTitleCol: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  itemName: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: typeScale.step0,
    color: colors.ink,
    textAlign: 'left',
  },
  flagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  itemMeta: {
    fontFamily: fontFamilies.body,
    fontSize: typeScale.stepMinus1,
    color: colors.ink3,
    textAlign: 'left',
  },
  itemActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  actionBtn: {
    flex: 1,
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
  previewBody: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing['2xl'],
  },
  previewImage: {
    width: '100%',
    height: 220,
    borderRadius: radii.lg,
    backgroundColor: colors.surface2,
  },
  previewBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  previewDesc: {
    fontFamily: fontFamilies.body,
    fontSize: typeScale.step0,
    color: colors.ink2,
    lineHeight: 22,
    textAlign: 'left',
  },
  previewSection: {
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: spacing.md,
    gap: spacing.xs,
  },
  previewSectionTitle: {
    fontFamily: fontFamilies.heading,
    fontSize: typeScale.step1,
    color: colors.ink,
    textAlign: 'left',
    marginBottom: 4,
  },
  previewSubBlock: {
    gap: 4,
    marginBottom: spacing.xs,
  },
  previewSubTitle: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: typeScale.step0,
    color: colors.primaryDark,
    textAlign: 'left',
  },
  previewLine: {
    fontFamily: fontFamilies.body,
    fontSize: typeScale.step0,
    color: colors.ink,
    lineHeight: 22,
    textAlign: 'left',
  },
  previewToolbar: {
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
  rejectBody: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  rejectSubtitle: {
    fontFamily: fontFamilies.body,
    fontSize: typeScale.stepMinus1,
    color: colors.ink2,
    lineHeight: 20,
    textAlign: 'left',
  },
  fieldLabel: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: typeScale.step0,
    color: colors.ink,
    textAlign: 'left',
    marginTop: spacing.xs,
  },
  rejectInput: {
    backgroundColor: colors.surface1,
    borderWidth: 1.5,
    borderColor: colors.hairlineStrong,
    borderRadius: radii.md,
    padding: spacing.md,
    minHeight: 108,
    fontFamily: fontFamilies.body,
    fontSize: typeScale.step0,
    color: colors.ink,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  rejectInputError: {
    borderColor: colors.secondary,
  },
  fieldHint: {
    fontFamily: fontFamilies.body,
    fontSize: 12,
    color: colors.ink3,
    textAlign: 'left',
  },
  validationError: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: typeScale.stepMinus1,
    color: colors.secondary,
    textAlign: 'left',
  },
  rejectActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  rejectActionBtn: {
    flex: 1,
  },
  rejectBtnSubdued: {
    opacity: 0.65,
  },
});
