import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { STAGE } from '@cookbook/core/recipe-model';
import { colors, fontFamilies, radii, shadows, spacing, typeScale } from '@/theme';
import { Button, ConfirmDialog, EmptyState, useToast } from '@/components/ui';
import {
  RecipeForm,
  RecipeImportModal,
  SaveChoiceModal,
  type RecipeFormCollectedData,
  type RecipeFormHandle,
  type SaveChoiceResult,
} from '@/components/recipe-form';
import { useSession } from '@/context/SessionContext';
import { useShareIntent } from '@/hooks/useShareIntent';
import { captureError } from '@/services/logger';
import {
  createRecipeAtomic,
  updateRecipeWithAssets,
} from '@/services/recipes/recipe-edit-suggestion-service';
import {
  mapExtractedDataToForm,
  type ExtractedRecipeData,
  type RecipeImportMode,
} from '@/services/recipes/recipe-import-service';
import { RecipeService, type RecipeDoc } from '@/services/recipes/recipe-service';
import { RecipeSubmissionService } from '@/services/recipes/recipe-submission-service';

function firstParam(val?: string | string[]): string {
  if (Array.isArray(val)) return String(val[0] || '').trim();
  return typeof val === 'string' ? val.trim() : '';
}

export default function ProposeRecipeScreen() {
  const { user, profile, isAuthenticated, isApproved, loading: sessionLoading } = useSession();
  const { showToast } = useToast();
  const navigation = useNavigation();

  const params = useLocalSearchParams<{
    editId?: string | string[];
    resubmit?: string | string[];
    importUrl?: string | string[];
    url?: string | string[];
    importImage?: string | string[];
    sharedText?: string | string[];
  }>();

  const editId = firstParam(params.editId);
  const isResubmit = firstParam(params.resubmit) === 'true';
  const isEditMode = Boolean(editId);

  const formRef = useRef<RecipeFormHandle | null>(null);
  const allowLeaveRef = useRef(false);
  const pendingNavActionRef = useRef<any>(null);

  // Edit mode state
  const [editingRecipe, setEditingRecipe] = useState<RecipeDoc | null>(null);
  const [loadingEditRecipe, setLoadingEditRecipe] = useState(false);
  const [editLoadError, setEditLoadError] = useState<string | null>(null);

  // Form / Modal state
  const [isDirty, setIsDirty] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  const [isImported, setIsImported] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Save Choice (approved & manager)
  const [saveChoiceOpen, setSaveChoiceOpen] = useState(false);
  const [pendingCreateData, setPendingCreateData] = useState<RecipeFormCollectedData | null>(null);

  // AI Import Modal
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importInitialMode, setImportInitialMode] = useState<RecipeImportMode>('image');
  const [importInitialUrl, setImportInitialUrl] = useState('');
  const [importInitialImages, setImportInitialImages] = useState<string[] | undefined>(undefined);

  // Unsaved changes leave confirmation
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);

  // Native OS Share Target & Deep-Link Share Handoff
  const { pendingShare, clearPendingShare } = useShareIntent({
    importUrl: params.importUrl,
    url: params.url,
    importImage: params.importImage,
    sharedText: params.sharedText,
  });

  // Load existing recipe in Edit Mode (?editId=<id>&resubmit=true)
  useEffect(() => {
    if (!isEditMode || !isAuthenticated) {
      setEditingRecipe(null);
      setEditLoadError(null);
      setLoadingEditRecipe(false);
      return;
    }

    let cancelled = false;
    setLoadingEditRecipe(true);
    setEditLoadError(null);

    RecipeService.getById(editId)
      .then((doc) => {
        if (cancelled) return;
        if (!doc) {
          setEditLoadError('המתכון המבוקש לא נמצא.');
        } else {
          setEditingRecipe(doc);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        captureError(err, { service: 'propose-recipe', op: 'loadEditRecipe', recipeId: editId });
        setEditLoadError('לא הצלחנו לטעון את המתכון לעריכה. נסו שוב.');
      })
      .finally(() => {
        if (!cancelled) setLoadingEditRecipe(false);
      });

    return () => {
      cancelled = true;
    };
  }, [editId, isEditMode, isAuthenticated]);

  // Consume incoming share intent / deep-link handoff when approved user is on create mode
  useEffect(() => {
    if (!pendingShare || !isAuthenticated || !isApproved || isEditMode) return;
    setImportInitialMode(pendingShare.mode);
    setImportInitialUrl(pendingShare.url || '');
    setImportInitialImages(pendingShare.imageUris);
    setImportModalOpen(true);
    clearPendingShare();
  }, [pendingShare, isAuthenticated, isApproved, isEditMode, clearPendingShare]);

  // Leave-page dirty guard (שינויים לא נשמרו)
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      if (!isDirty || submitting || allowLeaveRef.current || !isAuthenticated) {
        return;
      }
      e.preventDefault();
      pendingNavActionRef.current = e.data.action;
      setLeaveConfirmOpen(true);
    });
    return unsubscribe;
  }, [navigation, isDirty, submitting, isAuthenticated]);

  const handleDismissGuestPrompt = useCallback(() => {
    if (!isAuthenticated) {
      router.replace('/(tabs)/home');
    }
  }, [isAuthenticated]);

  const handleGoToAuth = useCallback(() => {
    router.push('/auth');
  }, []);

  const handleOpenManualImport = useCallback(() => {
    setImportInitialMode('image');
    setImportInitialUrl('');
    setImportInitialImages(undefined);
    setImportModalOpen(true);
  }, []);

  const handleRecipeExtracted = useCallback(
    ({ data, sourceUrl }: { data: ExtractedRecipeData; sourceUrl: string | null }) => {
      const mapped = mapExtractedDataToForm(data);
      formRef.current?.populateFromExtracted(mapped, sourceUrl);
      setIsImported(true);
      showToast('המתכון יובא. עברו על הפרטים לפני השמירה.', 'success');
    },
    [showToast],
  );

  // Execute atomic create (shared by plain `user` direct submit and `approved`/`manager` Save Choice)
  const executeCreate = useCallback(
    async (
      collected: RecipeFormCollectedData,
      choice: { stage: 'tested' | 'to-try'; submit: boolean },
    ) => {
      if (!user?.uid) {
        return;
      }

      setSubmitting(true);
      try {
        const {
          images,
          imagesToDelete: _ignoredImgDel,
          mediaItemsOrdered,
          mediaToDelete: _ignoredMediaDel,
          directPublish: _ignoredDirect,
          ...contentFields
        } = collected;

        const authorName = profile?.fullName || user.displayName || user.email || undefined;

        // Both approved AND manager create visibility: 'private' from /propose-recipe
        const { recipeId, mediaUploadResults } = await createRecipeAtomic({
          recipeData: {
            ...contentFields,
            stage: choice.stage,
          },
          imagesToUpload: images,
          mediaItemsOrdered,
          uploadedBy: user.uid,
          authorName,
          submitForApproval: choice.submit,
          directPublish: false,
        });

        setSaveChoiceOpen(false);
        setPendingCreateData(null);
        setIsImported(false);
        formRef.current?.resetToEmpty();

        const baseSuccessMessage = choice.submit
          ? 'המתכון נשלח לאישור בהצלחה'
          : choice.stage === STAGE.TO_TRY
            ? 'המתכון נשמר ב־״לנסות״'
            : 'המתכון נשמר ב־״הספרייה שלי״';

        if (mediaUploadResults.failedCount > 0) {
          showToast(
            `${baseSuccessMessage} (${mediaUploadResults.failedCount} קבצי מדיה לא הועלו)`,
            'info',
            4500,
          );
        } else {
          showToast(baseSuccessMessage, 'success');
        }

        if (!choice.submit && recipeId) {
          allowLeaveRef.current = true;
          router.push(`/recipe/${recipeId}`);
          setTimeout(() => {
            allowLeaveRef.current = false;
          }, 300);
        }
      } catch (err) {
        captureError(err, {
          service: 'propose-recipe',
          op: 'createRecipeAtomic',
          submit: choice.submit,
        });
        showToast('לא הצלחנו לשמור את המתכון. אנא נסו שוב.', 'error', 4500);
      } finally {
        setSubmitting(false);
      }
    },
    [user, profile, showToast],
  );

  // Execute edit mode update (+ optional resubmit)
  const executeEditSave = useCallback(
    async (collected: RecipeFormCollectedData) => {
      if (!user?.uid || !editId) return;

      setSubmitting(true);
      try {
        const {
          images,
          imagesToDelete,
          mediaItemsOrdered,
          mediaToDelete,
          directPublish: _ignoredDirect,
          ...changes
        } = collected;

        const { mediaUploadResults } = await updateRecipeWithAssets(editId, {
          changes,
          images,
          imagesToDelete,
          mediaItemsOrdered,
          mediaToDelete,
          uploadedBy: user.uid,
        });

        if (isResubmit) {
          await RecipeSubmissionService.resubmit(editId);
        }

        formRef.current?.markClean();
        allowLeaveRef.current = true;

        const message = isResubmit
          ? 'המתכון עודכן ונשלח שוב לאישור בהצלחה'
          : 'המתכון עודכן בהצלחה!';
        if (mediaUploadResults.failedCount > 0) {
          showToast(
            `${message} (${mediaUploadResults.failedCount} קבצי מדיה לא הועלו)`,
            'info',
            4500,
          );
        } else {
          showToast(message, 'success');
        }

        router.setParams({ editId: '', resubmit: '' });
        router.replace('/(tabs)/my-recipes');
        setTimeout(() => {
          allowLeaveRef.current = false;
        }, 300);
      } catch (err) {
        captureError(err, {
          service: 'propose-recipe',
          op: isResubmit ? 'editAndResubmit' : 'editRecipe',
          recipeId: editId,
        });
        showToast('לא הצלחנו לעדכן את המתכון. אנא נסו שוב.', 'error', 4500);
      } finally {
        setSubmitting(false);
      }
    },
    [user, editId, isResubmit, showToast],
  );

  const handleFormSubmit = useCallback(
    async (collected: RecipeFormCollectedData) => {
      if (!isAuthenticated) {
        return;
      }

      if (isEditMode) {
        await executeEditSave(collected);
        return;
      }

      if (!isApproved) {
        // Plain `user`: direct atomic WriteBatch (recipes/{id} + recipe_submissions/{id})
        await executeCreate(collected, { stage: STAGE.TESTED, submit: true });
        return;
      }

      // `approved` & `manager`: open 2×2 Save Choice dialog
      setPendingCreateData(collected);
      setSaveChoiceOpen(true);
    },
    [isAuthenticated, isEditMode, isApproved, executeEditSave, executeCreate],
  );

  const handleSaveChoiceConfirm = useCallback(
    async (choice: SaveChoiceResult) => {
      if (!pendingCreateData) return;
      await executeCreate(pendingCreateData, choice);
    },
    [pendingCreateData, executeCreate],
  );

  // Role- and mode-adapted copy
  const headerTitle = isPreview
    ? 'כך ייראה המתכון שלך'
    : isEditMode
      ? isResubmit
        ? 'עריכה ושליחה מחדש.'
        : 'עריכת מתכון.'
      : isApproved
        ? 'מתכון חדש.'
        : 'הצע מתכון לספר.';

  const headerSubtitle = isPreview
    ? 'כפי שיופיע לאחר הפרסום'
    : isEditMode
      ? isResubmit
        ? 'תקנו את הפרטים ושלחו שוב לאישור המנהל.'
        : 'ערכו את פרטי המתכון ושמרו את השינויים.'
      : isApproved
        ? 'כתבו אותו כפי שהייתם מספרים לחבר. הוא יישמר בספרייה הפרטית שלכם.'
        : 'כתוב אותו כפי שהיית מספר אותו לחבר.';

  const submitLabel = isEditMode
    ? isResubmit
      ? 'שמור ושלח שוב לאישור'
      : 'שמור שינויים'
    : isApproved
      ? 'שמירה'
      : 'שלח מתכון';

  return (
    <View testID="propose-screen" collapsable={false} style={styles.screen}>
      {isEditMode || isPreview || !isAuthenticated ? (
        <View style={styles.compactHeader}>
          <Text style={styles.compactHeaderTitle} numberOfLines={1}>
            {headerTitle}
          </Text>
          {isEditMode ? (
            <Button
              label="ביטול"
              variant="ghost"
              size="sm"
              onPress={() => {
                router.setParams({ editId: '', resubmit: '' });
                router.replace('/(tabs)/my-recipes');
              }}
            />
          ) : null}
        </View>
      ) : null}

      {sessionLoading ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : !isAuthenticated ? (
        <View style={styles.guestGateWrap}>
          <View
            testID="propose-login-prompt"
            collapsable={false}
            style={[styles.guestGateCard, shadows.level1]}
          >
            <View style={styles.guestGateIconWrap}>
              <Ionicons name="log-in-outline" size={32} color={colors.primaryDark} />
            </View>
            <Text style={styles.guestGateTitle}>נדרשת התחברות</Text>
            <Text style={styles.guestGateBody}>
              רק משתמשים מחוברים יכולים להציע מתכונים. אנא התחבר או הירשם כדי להמשיך.
            </Text>
            <View style={styles.guestGateActions}>
              <Button
                testID="propose-login-btn"
                label="התחברות / הרשמה"
                variant="primary"
                fullWidth
                onPress={handleGoToAuth}
              />
              <Button
                testID="propose-login-dismiss-btn"
                label="חזרה לדף הבית"
                variant="secondary"
                fullWidth
                onPress={handleDismissGuestPrompt}
              />
            </View>
          </View>
        </View>
      ) : isEditMode && loadingEditRecipe ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>טוען את המתכון לעריכה...</Text>
        </View>
      ) : isEditMode && editLoadError ? (
        <EmptyState
          icon="alert-circle-outline"
          title="שגיאה בטעינת המתכון"
          subtitle={editLoadError}
          actionLabel="חזרה לספרייה"
          onAction={() => {
            router.setParams({ editId: '', resubmit: '' });
            router.replace('/(tabs)/my-recipes');
          }}
        />
      ) : (
        <RecipeForm
          ref={formRef}
          initialRecipe={isEditMode ? editingRecipe : null}
          excludeRecipeId={isEditMode ? editId : null}
          submitLabel={submitLabel}
          clearLabel={isEditMode ? 'איפוס' : 'נקה טופס'}
          showAiImport={!isEditMode && isApproved}
          showPreviewToggle
          submitting={submitting}
          isImported={!isEditMode && isApproved && isImported}
          onOpenAiImport={handleOpenManualImport}
          onSubmit={handleFormSubmit}
          onClear={() => setIsImported(false)}
          onDirtyChange={setIsDirty}
          onPreviewChange={setIsPreview}
        />
      )}

      {/* 2×2 Save Choice Modal (approved & manager) */}
      <SaveChoiceModal
        visible={saveChoiceOpen}
        defaultStage={isImported ? STAGE.TO_TRY : STAGE.TESTED}
        submitting={submitting}
        onConfirm={handleSaveChoiceConfirm}
        onCancel={() => {
          if (!submitting) {
            setSaveChoiceOpen(false);
            setPendingCreateData(null);
          }
        }}
      />

      {/* AI Recipe Import Modal (image / URL / YouTube + filler mini-game) */}
      <RecipeImportModal
        visible={importModalOpen}
        initialMode={importInitialMode}
        initialUrl={importInitialUrl}
        initialImageUris={importInitialImages}
        onClose={() => setImportModalOpen(false)}
        onExtracted={handleRecipeExtracted}
      />

      {/* Unsaved Changes Leave Confirmation */}
      <ConfirmDialog
        visible={leaveConfirmOpen}
        title="שינויים לא נשמרו"
        message="יש לך שינויים שלא נשמרו שיאבדו. האם אתה בטוח שברצונך לעזוב את הדף?"
        confirmLabel="המשך בכל זאת"
        cancelLabel="ביטול"
        destructive
        onConfirm={() => {
          setLeaveConfirmOpen(false);
          allowLeaveRef.current = true;
          const action = pendingNavActionRef.current;
          pendingNavActionRef.current = null;
          if (action) {
            navigation.dispatch(action);
          }
          setTimeout(() => {
            allowLeaveRef.current = false;
          }, 300);
        }}
        onCancel={() => {
          setLeaveConfirmOpen(false);
          pendingNavActionRef.current = null;
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface0,
  },
  compactHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: 4,
    paddingBottom: 2,
    gap: spacing.sm,
  },
  compactHeaderTitle: {
    flex: 1,
    fontSize: typeScale.step2,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    textAlign: 'left',
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  loadingText: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink3,
  },
  guestGateWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  guestGateCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    gap: spacing.md,
  },
  guestGateIconWrap: {
    width: 60,
    height: 60,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guestGateTitle: {
    fontSize: typeScale.step2,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    textAlign: 'center',
  },
  guestGateBody: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink2,
    lineHeight: 22,
    textAlign: 'center',
  },
  guestGateActions: {
    width: '100%',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
});
