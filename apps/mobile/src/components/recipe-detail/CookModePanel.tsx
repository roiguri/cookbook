import React, { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radii, shadows, spacing, statusColors, typeScale } from '@/theme';
import { PressableScale } from '@/components/ui';

export const COOK_MODE_WAKE_TAG = 'cook-mode';

export interface CookModeStep {
  stepIndex: number;
  text: string;
  stageTitle?: string;
}

export interface CookModeIngredientPeekItem {
  index: number;
  amount: string;
  unit: string;
  item: string;
  sectionTitle?: string;
  checked: boolean;
}

export interface CookModePanelProps {
  enabled: boolean;
  onToggle: () => void;
  steps: CookModeStep[];
  activeStepIndex: number;
  onSelectStep: (stepIndex: number) => void;
  ingredients?: CookModeIngredientPeekItem[];
  onToggleIngredient?: (index: number) => void;
}

/**
 * P0 Cook Mode wake-lock lifecycle hook:
 * - Acquires `expo-keep-awake` under tag `'cook-mode'` while enabled & foregrounded.
 * - Immediately releases wake lock when `AppState` leaves `'active'` (background/inactive)
 *   and reacquires when returning to `'active'` while still enabled.
 * - ALWAYS releases wake lock in `useEffect` cleanup on toggle-off or unmount.
 */
export function useCookModeWakeLock(enabled: boolean): boolean {
  const [wakeLockActive, setWakeLockActive] = useState(false);

  useEffect(() => {
    let active = true;

    const acquire = () => {
      activateKeepAwakeAsync(COOK_MODE_WAKE_TAG)
        .then(() => {
          if (active) setWakeLockActive(true);
        })
        .catch(() => {
          if (active) setWakeLockActive(false);
        });
    };

    const release = () => {
      deactivateKeepAwake(COOK_MODE_WAKE_TAG).catch(() => {});
      if (active) setWakeLockActive(false);
    };

    if (!enabled) {
      release();
      return () => {
        active = false;
        deactivateKeepAwake(COOK_MODE_WAKE_TAG).catch(() => {});
      };
    }

    if (AppState.currentState === 'active') {
      acquire();
    }

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        acquire();
      } else {
        release();
      }
    });

    return () => {
      active = false;
      appStateSub.remove();
      deactivateKeepAwake(COOK_MODE_WAKE_TAG).catch(() => {});
    };
  }, [enabled]);

  return wakeLockActive;
}

export function CookModePanel({
  enabled,
  onToggle,
  steps,
  activeStepIndex,
  onSelectStep,
  ingredients = [],
  onToggleIngredient,
}: CookModePanelProps) {
  useCookModeWakeLock(enabled);
  const [peekOpen, setPeekOpen] = useState(false);

  useEffect(() => {
    if (!enabled) setPeekOpen(false);
  }, [enabled]);

  const totalSteps = steps.length;
  const safeIndex =
    totalSteps > 0
      ? activeStepIndex >= 0 && activeStepIndex < totalSteps
        ? activeStepIndex
        : 0
      : -1;
  const currentStep = safeIndex >= 0 ? steps[safeIndex] : null;
  const canGoPrev = safeIndex > 0;
  const canGoNext = safeIndex >= 0 && safeIndex < totalSteps - 1;

  return (
    <View style={styles.wrapper}>
      {/* Cook Mode Toggle Strip */}
      <PressableScale
        testID="cook-mode-toggle"
        accessibilityRole="switch"
        accessibilityState={{ checked: enabled }}
        accessibilityLabel="מצב בישול"
        onPress={onToggle}
        style={[styles.toggleCard, shadows.level1, enabled && styles.toggleCardActive]}
      >
        <View style={styles.toggleStart}>
          <View style={[styles.flameCircle, enabled && styles.flameCircleActive]}>
            <Ionicons
              name={enabled ? 'flame' : 'flame-outline'}
              size={19}
              color={enabled ? colors.buttonColor : colors.primaryDark}
            />
          </View>
          <View style={styles.toggleTextCol}>
            <Text style={[styles.toggleTitle, enabled && styles.toggleTitleActive]}>מצב בישול</Text>
            <Text style={styles.toggleSubtitle}>
              {enabled ? 'ניווט מוגדל בין שלבי ההכנה' : 'שומר על המסך דלוק ומגדיל שלבים'}
            </Text>
          </View>
        </View>

        <View style={[styles.switchTrack, enabled && styles.switchTrackOn]}>
          <View style={[styles.switchThumb, enabled && styles.switchThumbOn]} />
        </View>
      </PressableScale>

      {/* Active Cook Mode Banner + Focused Step Navigator */}
      {enabled ? (
        <View testID="cook-mode-banner" collapsable={false} style={[styles.banner, shadows.level2]}>
          <View style={styles.bannerTopRow}>
            <View testID="cook-mode-wake-lock-badge" collapsable={false} style={styles.wakeBadge}>
              <Ionicons name="sunny-outline" size={14} color={colors.primaryDark} />
              <Text style={styles.wakeBadgeText} allowFontScaling={false}>
                המסך יישאר דלוק
              </Text>
            </View>

            {ingredients.length > 0 ? (
              <PressableScale
                testID="cook-mode-ingredients-peek-btn"
                onPress={() => setPeekOpen((prev) => !prev)}
                accessibilityRole="button"
                accessibilityState={{ expanded: peekOpen }}
                style={[styles.peekToggleBtn, peekOpen && styles.peekToggleBtnOpen]}
              >
                <Ionicons
                  name={peekOpen ? 'chevron-up' : 'list-outline'}
                  size={15}
                  color={colors.primaryDark}
                />
                <Text style={styles.peekToggleText} allowFontScaling={false}>
                  {peekOpen ? 'הסתר מצרכים' : 'הצצה במצרכים'}
                </Text>
              </PressableScale>
            ) : null}
          </View>

          {peekOpen && ingredients.length > 0 ? (
            <View style={styles.peekBox}>
              {ingredients.map((ing) => (
                <Pressable
                  key={`peek-${ing.index}`}
                  onPress={() => onToggleIngredient?.(ing.index)}
                  style={styles.peekRow}
                >
                  <View style={[styles.peekCheck, ing.checked && styles.peekCheckActive]}>
                    {ing.checked ? (
                      <Ionicons name="checkmark" size={12} color={colors.buttonColor} />
                    ) : null}
                  </View>
                  <Text
                    style={[styles.peekItemText, ing.checked && styles.peekItemChecked]}
                    numberOfLines={2}
                  >
                    {[ing.amount, ing.unit, ing.item].filter(Boolean).join(' ')}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {currentStep ? (
            <View style={styles.stepFocusBox}>
              <View style={styles.stepMetaRow}>
                <Text style={styles.stepCounter} allowFontScaling={false}>
                  {`שלב ${safeIndex + 1} מתוך ${totalSteps}`}
                </Text>
                {currentStep.stageTitle ? (
                  <Text style={styles.stagePillText} numberOfLines={1} allowFontScaling={false}>
                    {currentStep.stageTitle}
                  </Text>
                ) : null}
              </View>

              <Text style={styles.enlargedStepText}>{currentStep.text}</Text>

              <View style={styles.navButtonsRow}>
                <PressableScale
                  testID="cook-mode-prev-btn"
                  disabled={!canGoPrev}
                  onPress={() => canGoPrev && onSelectStep(safeIndex - 1)}
                  accessibilityRole="button"
                  accessibilityLabel="שלב קודם"
                  style={[
                    styles.stepNavBtn,
                    styles.stepNavBtnSecondary,
                    !canGoPrev && styles.stepNavBtnDisabled,
                  ]}
                >
                  <Ionicons name="chevron-forward" size={18} color={colors.ink} />
                  <Text style={styles.stepNavSecondaryText} allowFontScaling={false}>
                    שלב קודם
                  </Text>
                </PressableScale>

                <PressableScale
                  testID="cook-mode-next-btn"
                  disabled={!canGoNext}
                  onPress={() => canGoNext && onSelectStep(safeIndex + 1)}
                  accessibilityRole="button"
                  accessibilityLabel="שלב הבא"
                  style={[
                    styles.stepNavBtn,
                    styles.stepNavBtnPrimary,
                    !canGoNext && styles.stepNavBtnDisabled,
                  ]}
                >
                  <Text style={styles.stepNavPrimaryText} allowFontScaling={false}>
                    שלב הבא
                  </Text>
                  <Ionicons name="chevron-back" size={18} color={colors.buttonColor} />
                </PressableScale>
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.md,
  },
  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  toggleCardActive: {
    backgroundColor: statusColors.approvedBg,
    borderColor: colors.primary,
  },
  toggleStart: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  flameCircle: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flameCircleActive: {
    backgroundColor: colors.primaryDark,
  },
  toggleTextCol: {
    flex: 1,
    gap: 2,
  },
  toggleTitle: {
    fontSize: typeScale.step1,
    fontFamily: fontFamilies.bodyBold,
    color: colors.ink,
    textAlign: 'left',
    includeFontPadding: false,
  },
  toggleTitleActive: {
    color: colors.primaryDark,
  },
  toggleSubtitle: {
    fontSize: 12.5,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    textAlign: 'left',
    includeFontPadding: false,
  },
  switchTrack: {
    width: 48,
    height: 28,
    borderRadius: radii.pill,
    backgroundColor: colors.hairlineStrong,
    padding: 3,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  switchTrackOn: {
    backgroundColor: colors.primary,
    alignItems: 'flex-end',
  },
  switchThumb: {
    width: 22,
    height: 22,
    borderRadius: radii.pill,
    backgroundColor: colors.surface1,
  },
  switchThumbOn: {
    backgroundColor: colors.buttonColor,
  },
  banner: {
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.primary,
    padding: spacing.lg,
    gap: spacing.md,
  },
  bannerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  wakeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: statusColors.approvedBg,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  wakeBadgeText: {
    fontSize: 12.5,
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
    includeFontPadding: false,
  },
  peekToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surface2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  peekToggleBtnOpen: {
    borderColor: colors.primary,
  },
  peekToggleText: {
    fontSize: 12.5,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.primaryDark,
    includeFontPadding: false,
  },
  peekBox: {
    backgroundColor: colors.surface0,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: spacing.md,
    gap: spacing.sm,
  },
  peekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 3,
  },
  peekCheck: {
    width: 18,
    height: 18,
    borderRadius: radii.xs,
    borderWidth: 1.5,
    borderColor: colors.hairlineStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface1,
  },
  peekCheckActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  peekItemText: {
    flex: 1,
    fontSize: 14,
    fontFamily: fontFamilies.body,
    color: colors.ink,
    textAlign: 'left',
  },
  peekItemChecked: {
    color: colors.ink3,
    textDecorationLine: 'line-through',
  },
  stepFocusBox: {
    gap: spacing.md,
  },
  stepMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  stepCounter: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
    includeFontPadding: false,
  },
  stagePillText: {
    flexShrink: 1,
    fontSize: 12,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink3,
    includeFontPadding: false,
  },
  enlargedStepText: {
    fontSize: 20,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink,
    lineHeight: 32,
    textAlign: 'left',
  },
  navButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  stepNavBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 46,
    borderRadius: radii.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  stepNavBtnSecondary: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
  },
  stepNavBtnPrimary: {
    backgroundColor: colors.primary,
  },
  stepNavBtnDisabled: {
    opacity: 0.4,
  },
  stepNavSecondaryText: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyBold,
    color: colors.ink,
    includeFontPadding: false,
  },
  stepNavPrimaryText: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyBold,
    color: colors.buttonColor,
    includeFontPadding: false,
  },
});
