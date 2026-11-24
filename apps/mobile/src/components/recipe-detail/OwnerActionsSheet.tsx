import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { STAGE, VISIBILITY } from '@cookbook/core/recipe-model';
import { getRecipeStatus, RECIPE_STATUS } from '@cookbook/core/recipe-utils/recipe-status';
import { colors, fontFamilies, radii, spacing, statusColors, typeScale } from '@/theme';
import { ModalSheet, PressableScale } from '@/components/ui';
import { RejectionNoteBanner, StatusBadge } from '@/components/library';
import type { RecipeDoc } from '@/services/recipes/recipe-service';
import type { RecipeSubmission } from '@/services/recipes/recipe-submission-service';

export interface OwnerActionsSheetProps {
  visible: boolean;
  recipe: RecipeDoc | null;
  submission: RecipeSubmission | null | undefined;
  isOwner: boolean;
  isAuthenticated: boolean;
  busyAction: string | null;
  onClose: () => void;
  onMarkTested: () => void;
  onMarkToTry: () => void;
  onEdit: () => void;
  onResubmit: () => void;
  onShareFamily: () => void;
  onSubmitForApproval: () => void;
  onCancelSubmission: () => void;
  onSuggestEdit: () => void;
  onAddToMeal: () => void;
  onDelete: () => void;
}

function formatDayMonth(timestamp: any): string {
  if (!timestamp) return '';
  const date =
    typeof timestamp?.toDate === 'function'
      ? timestamp.toDate()
      : typeof timestamp?.seconds === 'number'
        ? new Date(timestamp.seconds * 1000)
        : new Date(timestamp);
  if (!date || Number.isNaN(date.getTime())) return '';
  return `${date.getDate()}.${date.getMonth() + 1}`;
}

function buildOwnerStatusSubtitle(
  status: string | null,
  recipe: RecipeDoc,
  submission: RecipeSubmission | null | undefined,
): string {
  if (!status) return '';
  const sentAt = submission?.resubmittedAt || submission?.submittedAt || submission?.createdAt;
  const sentDate = formatDayMonth(sentAt);
  const reviewedDate = formatDayMonth(submission?.reviewedAt);
  const createdDate = formatDayMonth(recipe.creationTime);
  const testedDate = formatDayMonth(recipe.testedAt || recipe.creationTime);

  switch (status) {
    case RECIPE_STATUS.PUBLISHED:
      return reviewedDate ? `בספר המשפחתי · אושר ב־${reviewedDate}` : 'בספר המשפחתי';
    case RECIPE_STATUS.PENDING:
      return sentDate ? `נשלח ב־${sentDate}` : 'נשלח לאישור';
    case RECIPE_STATUS.REJECTED:
      if (sentDate && reviewedDate) return `נשלח ב־${sentDate} · נבדק ב־${reviewedDate}`;
      if (reviewedDate) return `נבדק ב־${reviewedDate}`;
      return 'הוחזר עם הערה';
    case RECIPE_STATUS.TO_TRY:
      return createdDate ? `נשמר ב־${createdDate} · עוד לא נוסה` : 'עוד לא נוסה';
    case RECIPE_STATUS.PRIVATE:
      return testedDate ? `בספרייה שלכם · נבדק ב־${testedDate}` : 'בספרייה שלכם';
    default:
      return '';
  }
}

interface ActionRowProps {
  testID?: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone?: 'default' | 'primary' | 'danger';
  busy?: boolean;
  onPress: () => void;
}

function ActionRow({
  testID,
  label,
  icon,
  tone = 'default',
  busy = false,
  onPress,
}: ActionRowProps) {
  const iconColor =
    tone === 'danger' ? colors.secondary : tone === 'primary' ? colors.primaryDark : colors.ink2;

  return (
    <PressableScale
      testID={testID}
      disabled={busy}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.actionRow,
        tone === 'primary' && styles.actionRowPrimary,
        tone === 'danger' && styles.actionRowDanger,
        busy && styles.actionRowDisabled,
      ]}
    >
      <View
        style={[
          styles.iconBadge,
          tone === 'primary' && styles.iconBadgePrimary,
          tone === 'danger' && styles.iconBadgeDanger,
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={iconColor} />
        ) : (
          <Ionicons name={icon} size={19} color={iconColor} />
        )}
      </View>
      <Text
        style={[
          styles.actionLabel,
          tone === 'primary' && styles.actionLabelPrimary,
          tone === 'danger' && styles.actionLabelDanger,
        ]}
      >
        {label}
      </Text>
      <Ionicons
        name="chevron-back"
        size={17}
        color={tone === 'danger' ? colors.secondaryLight : colors.ink4}
      />
    </PressableScale>
  );
}

export function OwnerActionsSheet({
  visible,
  recipe,
  submission,
  isOwner,
  isAuthenticated,
  busyAction,
  onClose,
  onMarkTested,
  onMarkToTry,
  onEdit,
  onResubmit,
  onShareFamily,
  onSubmitForApproval,
  onCancelSubmission,
  onSuggestEdit,
  onAddToMeal,
  onDelete,
}: OwnerActionsSheetProps) {
  if (!recipe || !isAuthenticated) return null;

  const isPrivate = recipe.visibility !== VISIBILITY.PUBLISHED;
  const isToTry = recipe.stage === STAGE.TO_TRY;
  const submissionStatus = isOwner ? submission?.status : undefined;
  const ownerStatus = isOwner
    ? getRecipeStatus({ ...recipe, submissionStatus, ownView: true })
    : null;
  const statusSubtitle = buildOwnerStatusSubtitle(ownerStatus, recipe, submission);
  const isRejected = isOwner && isPrivate && submissionStatus === 'rejected';
  const hasRejectionReason = Boolean(submission?.rejectionReason?.trim());

  return (
    <ModalSheet
      visible={visible}
      title="פעולות על המתכון"
      onClose={onClose}
      testID="owner-actions-sheet"
    >
      <View style={styles.container}>
        {/* Owner Status Card */}
        {isOwner && ownerStatus ? (
          <View style={styles.statusCard}>
            <View style={styles.statusHeaderRow}>
              <StatusBadge status={ownerStatus} testID="owner-sheet-status-badge" />
              {statusSubtitle ? (
                <Text style={styles.statusWhen} numberOfLines={2}>
                  {statusSubtitle}
                </Text>
              ) : null}
            </View>

            {ownerStatus === RECIPE_STATUS.PENDING ? (
              <Text style={styles.pendingCopy}>
                מחכה לאישור מנהל. בינתיים המתכון נשאר פרטי ואפשר להמשיך לערוך — המנהל יראה את הגרסה
                העדכנית.
              </Text>
            ) : null}

            {isRejected && hasRejectionReason ? (
              <RejectionNoteBanner
                rejectionReason={submission?.rejectionReason || ''}
                onResubmit={onResubmit}
                resubmitting={busyAction === 'resubmit'}
              />
            ) : null}
          </View>
        ) : null}

        {/* Actions List */}
        <View style={styles.actionsList}>
          {isOwner && isToTry ? (
            <ActionRow
              testID="recipe-mark-tested-btn"
              label="סימון כנבדק"
              icon="checkmark-circle-outline"
              tone="primary"
              busy={busyAction === 'stage'}
              onPress={onMarkTested}
            />
          ) : null}

          {isOwner && !isToTry ? (
            <ActionRow
              testID="recipe-mark-to-try-btn"
              label="החזרה ל״לנסות״"
              icon="refresh-outline"
              busy={busyAction === 'stage'}
              onPress={onMarkToTry}
            />
          ) : null}

          {isOwner && isPrivate ? (
            <ActionRow
              testID="recipe-share-family-btn"
              label="שיתוף עם בני משפחה"
              icon="people-outline"
              onPress={onShareFamily}
            />
          ) : null}

          {isOwner && isPrivate && submission === null ? (
            <ActionRow
              testID="submit-for-approval-btn"
              label="שליחה לפרסום"
              icon="paper-plane-outline"
              tone="primary"
              busy={busyAction === 'submit'}
              onPress={onSubmitForApproval}
            />
          ) : null}

          {isOwner && isPrivate && submissionStatus === 'pending' ? (
            <ActionRow
              testID="cancel-submission-btn"
              label="ביטול השליחה"
              icon="close-circle-outline"
              busy={busyAction === 'cancel-submit'}
              onPress={onCancelSubmission}
            />
          ) : null}

          {isOwner && isPrivate && submissionStatus !== 'rejected' ? (
            <ActionRow
              testID="recipe-edit-btn"
              label="עריכה"
              icon="create-outline"
              onPress={onEdit}
            />
          ) : null}

          {isRejected && !hasRejectionReason ? (
            <ActionRow
              testID="resubmit-recipe-btn"
              label="עריכה ושליחה מחדש"
              icon="refresh-outline"
              tone="primary"
              busy={busyAction === 'resubmit'}
              onPress={onResubmit}
            />
          ) : null}

          {!isPrivate ? (
            <ActionRow
              testID="recipe-suggest-edit-btn"
              label="הצע עריכה"
              icon="create-outline"
              onPress={onSuggestEdit}
            />
          ) : null}

          <ActionRow
            testID="owner-sheet-add-to-meal-btn"
            label="הוסף לארוחה שלי"
            icon="restaurant-outline"
            busy={busyAction === 'meal'}
            onPress={onAddToMeal}
          />

          {isOwner && isPrivate ? (
            <View style={styles.dangerSection}>
              <ActionRow
                testID="recipe-delete-btn"
                label="מחיקת המתכון"
                icon="trash-outline"
                tone="danger"
                busy={busyAction === 'delete'}
                onPress={onDelete}
              />
            </View>
          ) : null}
        </View>
      </View>
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  statusCard: {
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: spacing.md,
    gap: spacing.sm,
  },
  statusHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statusWhen: {
    flex: 1,
    fontSize: 13,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    textAlign: 'left',
  },
  pendingCopy: {
    fontSize: 13,
    fontFamily: fontFamilies.body,
    color: colors.ink2,
    lineHeight: 20,
    textAlign: 'left',
  },
  actionsList: {
    gap: spacing.sm,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 54,
  },
  actionRowPrimary: {
    backgroundColor: statusColors.approvedBg,
    borderColor: colors.primary,
  },
  actionRowDanger: {
    backgroundColor: statusColors.rejectedBg,
    borderColor: colors.secondaryLight,
  },
  actionRowDisabled: {
    opacity: 0.6,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBadgePrimary: {
    backgroundColor: colors.surface1,
  },
  iconBadgeDanger: {
    backgroundColor: colors.surface1,
  },
  actionLabel: {
    flex: 1,
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink,
    textAlign: 'left',
    includeFontPadding: false,
  },
  actionLabelPrimary: {
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
  },
  actionLabelDanger: {
    fontFamily: fontFamilies.bodyBold,
    color: colors.secondaryDark,
  },
  dangerSection: {
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
});
