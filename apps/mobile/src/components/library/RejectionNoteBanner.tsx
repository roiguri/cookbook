import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radii, spacing, statusColors, typeScale } from '@/theme';
import { Button } from '@/components/ui';
import { getSharedHeaderText } from './StatusBadge';

export interface RejectionNoteBannerProps {
  /** Rejection feedback left by a manager (`recipe_submissions/{id}.rejectionReason`). */
  rejectionReason: string;
  /** Opens edit + resubmit flow (`עריכה ושליחה מחדש`). */
  onResubmit?: () => void;
  resubmitting?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Displays the manager's rejection note (`הערה ממנהלי הספר`) on a rejected private recipe,
 * along with the `עריכה ושליחה מחדש` CTA.
 */
export function RejectionNoteBanner({
  rejectionReason,
  onResubmit,
  resubmitting = false,
  style,
}: RejectionNoteBannerProps) {
  const trimmedReason = (rejectionReason || '').trim();
  if (!trimmedReason) return null;

  return (
    <View testID="rejection-note-banner" collapsable={false} style={[styles.banner, style]}>
      <View style={styles.headerRow}>
        <Ionicons name="alert-circle-outline" size={18} color={colors.secondary} />
        <Text style={styles.title}>הערה ממנהלי הספר</Text>
      </View>
      <Text testID="rejection-reason-text" style={styles.reasonText}>
        {trimmedReason}
      </Text>
      {onResubmit ? (
        <View style={styles.actionRow}>
          <Button
            testID="resubmit-recipe-btn"
            label="עריכה ושליחה מחדש"
            variant="primary"
            size="sm"
            onPress={onResubmit}
            loading={resubmitting}
            icon={<Ionicons name="refresh-outline" size={16} color={colors.buttonColor} />}
          />
        </View>
      ) : null}
    </View>
  );
}

export interface SubmissionActionsBarProps {
  /** Current submission document for the author's private recipe (null when not submitted). */
  submission: {
    status?: string;
    rejectionReason?: string | null;
  } | null;
  onSubmitForApproval?: () => void;
  onCancelSubmission?: () => void;
  onResubmit?: () => void;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Reusable submission lifecycle controls for an author's own private recipe on the detail screen:
 * - Unsubmitted: `שליחה לפרסום` (`submit-for-approval-btn`)
 * - Pending: explanation note + `ביטול השליחה` (`cancel-submission-btn`)
 * - Rejected: `RejectionNoteBanner` (`rejection-note-banner`, `rejection-reason-text`, `resubmit-recipe-btn`)
 */
export function SubmissionActionsBar({
  submission,
  onSubmitForApproval,
  onCancelSubmission,
  onResubmit,
  busy = false,
  style,
}: SubmissionActionsBarProps) {
  if (!submission) {
    if (!onSubmitForApproval) return null;
    return (
      <View style={[styles.barWrap, style]}>
        <Button
          testID="submit-for-approval-btn"
          label="שליחה לפרסום"
          variant="outline"
          size="sm"
          onPress={onSubmitForApproval}
          loading={busy}
          icon={<Ionicons name="paper-plane-outline" size={15} color={colors.primaryDark} />}
        />
      </View>
    );
  }

  if (submission.status === 'pending') {
    return (
      <View style={[styles.pendingCard, style]}>
        <View style={styles.headerRow}>
          <Ionicons name="time-outline" size={18} color={statusColors.pendingText} />
          <Text style={styles.pendingTitle}>ממתין לאישור מנהל</Text>
        </View>
        <Text style={styles.pendingBody}>
          מחכה לאישור מנהל. בינתיים המתכון נשאר פרטי ואפשר להמשיך לערוך — המנהל יראה את הגרסה
          העדכנית.
        </Text>
        {onCancelSubmission ? (
          <View style={styles.actionRow}>
            <Button
              testID="cancel-submission-btn"
              label="ביטול השליחה"
              variant="secondary"
              size="sm"
              onPress={onCancelSubmission}
              loading={busy}
              icon={<Ionicons name="close-outline" size={16} color={colors.ink} />}
            />
          </View>
        ) : null}
      </View>
    );
  }

  if (submission.status === 'rejected') {
    return (
      <RejectionNoteBanner
        rejectionReason={submission.rejectionReason || ''}
        onResubmit={onResubmit}
        resubmitting={busy}
        style={style}
      />
    );
  }

  return null;
}

export interface SharedRecipeBannerProps {
  /** Full name of the family member who shared the private recipe. */
  authorName?: string | null;
  /** Optional callback to remove the share from the recipient's own library (`הסר מהספרייה שלי`). */
  onLeave?: () => void;
  leaving?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Header banner shown to recipients viewing a private recipe shared with them:
 * displays `שותף איתך ע״י <fullName>` plus optional `הסר מהספרייה שלי` (`leave-shared-recipe-btn`).
 */
export function SharedRecipeBanner({
  authorName,
  onLeave,
  leaving = false,
  style,
}: SharedRecipeBannerProps) {
  return (
    <View style={[styles.sharedCard, style]}>
      <View style={styles.sharedInfo}>
        <Ionicons name="people-outline" size={18} color={colors.primaryDark} />
        <Text style={styles.sharedText}>{getSharedHeaderText(authorName)}</Text>
      </View>
      {onLeave ? (
        <Button
          testID="leave-shared-recipe-btn"
          label="הסר מהספרייה שלי"
          variant="secondary"
          size="sm"
          onPress={onLeave}
          loading={leaving}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: statusColors.rejectedBg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.secondaryLight,
    borderStartWidth: 4,
    borderStartColor: colors.secondary,
    padding: spacing.md,
    gap: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  title: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyBold,
    color: colors.secondaryDark,
    textAlign: 'left',
    includeFontPadding: false,
  },
  reasonText: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink,
    lineHeight: 22,
    textAlign: 'left',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginTop: spacing.xs,
  },
  barWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pendingCard: {
    backgroundColor: statusColors.pendingBg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.caution,
    padding: spacing.md,
    gap: spacing.sm,
  },
  pendingTitle: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyBold,
    color: statusColors.pendingText,
    textAlign: 'left',
    includeFontPadding: false,
  },
  pendingBody: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.body,
    color: colors.ink2,
    lineHeight: 20,
    textAlign: 'left',
  },
  sharedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
    backgroundColor: statusColors.approvedBg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  sharedInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 1,
  },
  sharedText: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.primaryDark,
    textAlign: 'left',
    includeFontPadding: false,
  },
});
