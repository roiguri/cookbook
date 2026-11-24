import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { STAGE } from '@cookbook/core/recipe-model';
import { colors, fontFamilies, radii, shadows, spacing, statusColors, typeScale } from '@/theme';
import { Button, PressableScale } from '@/components/ui';

export type RecipeSaveStage = 'tested' | 'to-try';

export interface SaveChoiceResult {
  stage: RecipeSaveStage;
  submit: boolean;
}

export interface SaveChoiceModalProps {
  visible: boolean;
  defaultStage?: RecipeSaveStage;
  submitting?: boolean;
  onConfirm: (choice: SaveChoiceResult) => void;
  onCancel: () => void;
}

const PRIVATE_NOTE = 'רק אתם ומנהלי הספר רואים אותו.';

export function SaveChoiceModal({
  visible,
  defaultStage = STAGE.TESTED,
  submitting = false,
  onConfirm,
  onCancel,
}: SaveChoiceModalProps) {
  const [stage, setStage] = useState<RecipeSaveStage>(defaultStage);
  const [submit, setSubmit] = useState<boolean>(false);

  // Reset choices to defaults each time the dialog opens
  useEffect(() => {
    if (visible) {
      setStage(defaultStage);
      setSubmit(false);
    }
  }, [visible, defaultStage]);

  const whereText = stage === STAGE.TO_TRY ? 'יישמר ב־״לנסות״' : 'יישמר ב־״הספרייה שלי״';
  const showToTrySubmitWarning = submit && stage === STAGE.TO_TRY;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!submitting) onCancel();
      }}
    >
      <View style={styles.overlay}>
        <Pressable
          style={styles.backdrop}
          onPress={() => {
            if (!submitting) onCancel();
          }}
        />
        <View testID="save-choice-modal" style={styles.dialog}>
          <Text style={styles.title}>איך לשמור את המתכון?</Text>

          {/* Question 1: ניסיתם אותו? */}
          <View style={styles.questionBlock}>
            <Text style={styles.legend}>ניסיתם אותו?</Text>
            <View style={styles.optionsGrid}>
              <PressableScale
                testID="save-choice-tested-btn"
                accessibilityRole="radio"
                accessibilityState={{ selected: stage === STAGE.TESTED }}
                disabled={submitting}
                onPress={() => setStage(STAGE.TESTED)}
                style={[styles.optionCard, stage === STAGE.TESTED && styles.optionCardSelected]}
              >
                <View style={styles.optionHeader}>
                  <Ionicons
                    name={stage === STAGE.TESTED ? 'radio-button-on' : 'radio-button-off'}
                    size={18}
                    color={stage === STAGE.TESTED ? colors.primaryDark : colors.ink4}
                  />
                  <Text style={styles.optionTitle}>ניסיתי</Text>
                </View>
                <Text style={styles.optionSubtitle}>לספרייה שלי</Text>
              </PressableScale>

              <PressableScale
                testID="save-choice-to-try-btn"
                accessibilityRole="radio"
                accessibilityState={{ selected: stage === STAGE.TO_TRY }}
                disabled={submitting}
                onPress={() => setStage(STAGE.TO_TRY)}
                style={[styles.optionCard, stage === STAGE.TO_TRY && styles.optionCardSelected]}
              >
                <View style={styles.optionHeader}>
                  <Ionicons
                    name={stage === STAGE.TO_TRY ? 'radio-button-on' : 'radio-button-off'}
                    size={18}
                    color={stage === STAGE.TO_TRY ? colors.primaryDark : colors.ink4}
                  />
                  <Text style={styles.optionTitle}>עוד לא</Text>
                </View>
                <Text style={styles.optionSubtitle}>ל״לנסות״</Text>
              </PressableScale>
            </View>
          </View>

          {/* Question 2: מי יראה אותו? (1-tap confirm actions) */}
          <View style={styles.questionBlock}>
            <Text style={styles.legend}>מי יראה אותו?</Text>
            <View style={styles.optionsGrid}>
              <PressableScale
                testID="save-choice-private-btn"
                accessibilityRole="button"
                accessibilityLabel="שמירה פרטית — רק אני"
                disabled={submitting}
                onPress={() => {
                  setSubmit(false);
                  onConfirm({ stage, submit: false });
                }}
                style={[styles.optionCard, styles.optionCardPrimary]}
              >
                <View style={styles.optionHeader}>
                  <Ionicons name="lock-closed-outline" size={18} color={colors.primaryDark} />
                  <Text style={styles.optionTitle}>רק אני</Text>
                </View>
                <Text style={styles.optionSubtitle}>שמירה פרטית</Text>
              </PressableScale>

              <PressableScale
                testID="save-choice-submit-btn"
                accessibilityRole="button"
                accessibilityLabel="שמירה ושליחה למשפחה"
                disabled={submitting}
                onPress={() => {
                  setSubmit(true);
                  onConfirm({ stage, submit: true });
                }}
                style={[styles.optionCard, submit && styles.optionCardSelected]}
              >
                <View style={styles.optionHeader}>
                  <Ionicons name="people-outline" size={18} color={colors.primaryDark} />
                  <Text style={styles.optionTitle}>כל המשפחה</Text>
                </View>
                <Text style={styles.optionSubtitle}>שמירה ושליחה</Text>
              </PressableScale>
            </View>
          </View>

          {/* Live summary & soft warning */}
          <View
            testID="save-choice-summary"
            style={[styles.summaryBox, showToTrySubmitWarning && styles.summaryBoxWarn]}
          >
            {stage === STAGE.TO_TRY ? (
              <Text style={styles.summaryText}>
                {whereText}. {PRIVATE_NOTE} (אם תשלחו לאישור – כדאי לנסות קודם).
              </Text>
            ) : (
              <Text style={styles.summaryText}>
                {whereText}. {PRIVATE_NOTE}
              </Text>
            )}
          </View>

          {/* Footer cancel action */}
          <View style={styles.actions}>
            <Button
              testID="save-choice-cancel-btn"
              label="ביטול"
              variant="secondary"
              disabled={submitting}
              onPress={onCancel}
              style={styles.actionBtn}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: statusColors.overlayBackdrop,
  },
  dialog: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.hairline,
    ...shadows.level3,
    gap: spacing.md,
  },
  title: {
    fontSize: typeScale.step2,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    textAlign: 'left',
  },
  questionBlock: {
    gap: spacing.sm,
  },
  legend: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyBold,
    color: colors.ink2,
    textAlign: 'left',
    includeFontPadding: false,
  },
  optionsGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  optionCard: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.hairlineStrong,
    backgroundColor: colors.surface1,
    gap: 4,
  },
  optionCardSelected: {
    borderColor: colors.primaryDark,
    backgroundColor: statusColors.approvedBg,
  },
  optionCardPrimary: {
    borderColor: colors.primary,
    backgroundColor: statusColors.approvedBg,
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  optionTitle: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyBold,
    color: colors.ink,
    textAlign: 'left',
    includeFontPadding: false,
  },
  optionSubtitle: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    textAlign: 'left',
    paddingStart: 22,
    includeFontPadding: false,
  },
  summaryBox: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface0,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  summaryBoxWarn: {
    backgroundColor: colors.neutral,
    borderColor: colors.caution,
  },
  summaryText: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.body,
    color: colors.ink2,
    lineHeight: 20,
    textAlign: 'left',
  },
  summaryBold: {
    fontFamily: fontFamilies.bodyBold,
    color: colors.ink,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  actionBtn: {
    flex: 1,
  },
});
