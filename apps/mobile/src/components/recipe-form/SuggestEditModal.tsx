import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radii, shadows, spacing, typeScale } from '@/theme';
import { Button, EmptyState, PressableScale, useToast } from '@/components/ui';
import { useSession } from '@/context/SessionContext';
import { captureError } from '@/services/logger';
import { RecipeEditSuggestionService } from '@/services/recipes/recipe-edit-suggestion-service';
import { RecipeService, type RecipeDoc } from '@/services/recipes/recipe-service';
import { RecipeForm, type RecipeFormCollectedData, type RecipeFormHandle } from './RecipeForm';

export interface SuggestEditModalProps {
  visible: boolean;
  recipeId: string | null;
  onClose: () => void;
  onSubmitted?: (suggestionId: string) => void;
}

export function SuggestEditModal({
  visible,
  recipeId,
  onClose,
  onSubmitted,
}: SuggestEditModalProps) {
  const insets = useSafeAreaInsets();
  const { user, profile } = useSession();
  const { showToast } = useToast();

  const formRef = useRef<RecipeFormHandle | null>(null);
  const [recipe, setRecipe] = useState<RecipeDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!visible || !recipeId) {
      setRecipe(null);
      setLoadError(null);
      setNote('');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    RecipeService.getById(recipeId)
      .then((doc) => {
        if (cancelled) return;
        if (!doc) {
          setLoadError('המתכון לא נמצא.');
        } else {
          setRecipe(doc);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        captureError(err, { service: 'suggest-edit-modal', op: 'loadRecipe', recipeId });
        setLoadError('לא הצלחנו לטעון את המתכון. נסו שוב.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [visible, recipeId]);

  const handleClose = useCallback(() => {
    if (submitting) return;
    setNote('');
    onClose();
  }, [submitting, onClose]);

  const handleSubmit = useCallback(
    async (collected: RecipeFormCollectedData) => {
      if (!recipeId) return;
      if (!user?.uid) {
        showToast('עליך להתחבר כדי להציע עריכה', 'error');
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
          ...contentSnapshot
        } = collected;

        const suggestedByName = profile?.fullName || user.displayName || user.email || '';

        const { suggestionId } = await RecipeEditSuggestionService.create({
          recipeId,
          suggestedBy: user.uid,
          suggestedByName,
          proposedChanges: {
            ...contentSnapshot,
            images,
          },
          mediaItemsOrdered,
          note: note.trim(),
        });

        showToast('הצעת העריכה נשלחה לאישור המנהל!', 'success');
        setNote('');
        onSubmitted?.(suggestionId);
        onClose();
      } catch (err) {
        captureError(err, { service: 'suggest-edit-modal', op: 'create', recipeId });
        showToast('לא הצלחנו לשלוח את הצעת העריכה. נסו שוב.', 'error');
      } finally {
        setSubmitting(false);
      }
    },
    [recipeId, user, profile, note, showToast, onSubmitted, onClose],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[
          styles.container,
          { paddingTop: Math.max(insets.top, 8), paddingBottom: Math.max(insets.bottom, 8) },
        ]}
      >
        {/* Header */}
        <View testID="suggest-edit-modal" style={styles.header}>
          <View style={styles.headerTextCol}>
            <Text style={styles.headerTitle}>הצע עריכה למתכון</Text>
            <Text style={styles.headerSubtitle}>
              השינויים שלך יישלחו לאישור מנהל לפני שיופיעו במתכון.
            </Text>
          </View>
          <PressableScale
            testID="suggest-edit-close-btn"
            variant="icon"
            disabled={submitting}
            onPress={handleClose}
            accessibilityLabel="סגור"
            style={styles.closeBtn}
          >
            <Ionicons name="close" size={22} color={colors.ink2} />
          </PressableScale>
        </View>

        {/* Body */}
        <View style={styles.body}>
          {loading ? (
            <View style={styles.centerState}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.loadingText}>טוען את פרטי המתכון...</Text>
            </View>
          ) : loadError ? (
            <EmptyState
              icon="alert-circle-outline"
              title="שגיאה בטעינה"
              subtitle={loadError}
              actionLabel="סגור"
              onAction={handleClose}
            />
          ) : recipe ? (
            <RecipeForm
              ref={formRef}
              initialRecipe={recipe}
              excludeRecipeId={recipeId}
              showAiImport={false}
              showPreviewToggle={false}
              hideActions
              submitting={submitting}
              onSubmit={handleSubmit}
              onClear={() => setNote('')}
            />
          ) : null}
        </View>

        {/* Pinned Bottom Action Bar (mirrors Web SuggestEditModal) */}
        {recipe && !loading && !loadError ? (
          <View style={styles.actionBar}>
            <TextInput
              testID="suggest-edit-note"
              editable={!submitting}
              value={note}
              onChangeText={setNote}
              placeholder="הערה למנהל (אופציונלי)"
              placeholderTextColor={colors.ink4}
              style={styles.noteInput}
            />
            <View style={styles.actionButtonsRow}>
              <Button
                testID="suggest-edit-clear-btn"
                label="איפוס"
                variant="secondary"
                size="sm"
                disabled={submitting}
                onPress={() => formRef.current?.requestClear()}
                style={styles.resetBtn}
              />
              <Button
                testID="suggest-edit-submit-btn"
                label="שלח לאישור"
                variant="primary"
                size="sm"
                loading={submitting}
                onPress={() => formRef.current?.submit()}
                style={styles.submitBtn}
              />
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface0,
  },
  header: {
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
  headerTextCol: {
    flex: 1,
    gap: 2,
  },
  headerTitle: {
    fontSize: typeScale.step2,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    textAlign: 'left',
  },
  headerSubtitle: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.body,
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
  body: {
    flex: 1,
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
  actionBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface1,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    gap: spacing.sm,
    ...shadows.level2,
  },
  noteInput: {
    backgroundColor: colors.surface0,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.body,
    color: colors.ink,
    textAlign: 'right',
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  resetBtn: {
    flex: 1,
  },
  submitBtn: {
    flex: 2,
  },
});
