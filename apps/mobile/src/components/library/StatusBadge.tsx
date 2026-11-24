import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getRecipeStatus,
  RECIPE_STATUS,
  RECIPE_STATUS_LABELS,
} from '@cookbook/core/recipe-utils/recipe-status';
import { colors, fontFamilies, radii, shadows, statusColors } from '@/theme';

export const SHARED_BADGE_STATUS = 'shared' as const;

export type RecipeBadgeStatus =
  'to-try' | 'private' | 'pending' | 'rejected' | 'published' | typeof SHARED_BADGE_STATUS;

export interface StatusBadgeProps {
  /** Explicit status ('to-try' | 'private' | 'pending' | 'rejected' | 'published' | 'shared'). */
  status?: RecipeBadgeStatus | string | null;
  /** Optional recipe object; derives status via `getRecipeStatus` or `sharedBy` if `status` is omitted. */
  recipe?: any;
  /** Sharer's name for `shared` status (first word is shown as `מ־<firstName>`). */
  sharedByName?: string | null;
  /** Alias for `sharedByName`. */
  name?: string | null;
  /** Recipe ID used to derive deterministic `card-badge-<status>-<id>` testID when `testID` is omitted. */
  recipeId?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const STATUS_ICONS: Record<RecipeBadgeStatus, keyof typeof Ionicons.glyphMap> = {
  'to-try': 'bookmark-outline',
  private: 'lock-closed-outline',
  pending: 'time-outline',
  rejected: 'close-circle-outline',
  published: 'checkmark-circle-outline',
  shared: 'people-outline',
};

/**
 * Extracts the first word of a sharer's name for compact card badges (`מ־<firstName>`).
 */
export function getSharedFirstName(fullName?: string | null): string {
  const trimmed = (fullName || '').trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0] || '';
}

/**
 * Formats the recipe detail header text for a private recipe shared with the reader:
 * `שותף איתך ע״י <fullName>` (fallback `שותף איתך`).
 */
export function getSharedHeaderText(fullName?: string | null): string {
  const trimmed = (fullName || '').trim();
  return trimmed ? `שותף איתך ע״י ${trimmed}` : 'שותף איתך';
}

/**
 * Returns the deterministic card badge `testID` (`card-badge-<status>-<recipeId>`).
 */
export function getCardBadgeTestId(
  status: string | null | undefined,
  recipeId?: string,
): string | undefined {
  if (!status || !recipeId) return undefined;
  return `card-badge-${status}-${recipeId}`;
}

function isKnownStatus(value: string | null | undefined): value is RecipeBadgeStatus {
  return (
    value === RECIPE_STATUS.TO_TRY ||
    value === RECIPE_STATUS.PRIVATE ||
    value === RECIPE_STATUS.PENDING ||
    value === RECIPE_STATUS.REJECTED ||
    value === RECIPE_STATUS.PUBLISHED ||
    value === SHARED_BADGE_STATUS
  );
}

/**
 * Single status badge component used across My Recipes cards and Recipe Detail header.
 * Mirrors Web `<status-badge>` and `@cookbook/core/recipe-utils/recipe-status`.
 */
export function StatusBadge({
  status: explicitStatus,
  recipe,
  sharedByName,
  name,
  recipeId,
  testID,
  style,
}: StatusBadgeProps) {
  const sharedBy = !recipe?.ownView ? recipe?.sharedBy : null;
  const derivedStatus =
    explicitStatus !== undefined
      ? explicitStatus
      : sharedBy
        ? SHARED_BADGE_STATUS
        : getRecipeStatus(recipe);

  if (!isKnownStatus(derivedStatus)) return null;

  const rawSharerName = sharedByName ?? name ?? sharedBy?.name ?? '';
  const firstName = getSharedFirstName(rawSharerName);
  const label =
    derivedStatus === SHARED_BADGE_STATUS
      ? firstName
        ? `מ־${firstName}`
        : 'שותף איתך'
      : RECIPE_STATUS_LABELS[derivedStatus];

  if (!label) return null;

  const resolvedRecipeId = recipeId || recipe?.id;
  const resolvedTestId = testID ?? getCardBadgeTestId(derivedStatus, resolvedRecipeId);
  const iconName = STATUS_ICONS[derivedStatus];
  const tone = TONE_STYLES[derivedStatus];

  return (
    <View testID={resolvedTestId} collapsable={false} style={[styles.badge, tone.container, style]}>
      <Ionicons name={iconName} size={12} color={tone.iconColor} />
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        allowFontScaling={false}
        style={[styles.label, tone.label]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    borderWidth: 1,
    maxWidth: '100%',
    ...shadows.level1,
  },
  label: {
    fontSize: 12,
    fontFamily: fontFamilies.bodyBold,
    includeFontPadding: false,
    flexShrink: 1,
  },
});

const TONE_STYLES: Record<
  RecipeBadgeStatus,
  {
    container: ViewStyle;
    label: { color: string };
    iconColor: string;
  }
> = {
  'to-try': {
    container: {
      backgroundColor: colors.surface1,
      borderColor: colors.ink3,
      borderStyle: 'dashed',
    },
    label: { color: colors.ink },
    iconColor: colors.ink2,
  },
  private: {
    container: {
      backgroundColor: colors.surface1,
      borderColor: colors.hairlineStrong,
    },
    label: { color: colors.ink },
    iconColor: colors.ink2,
  },
  pending: {
    container: {
      backgroundColor: statusColors.pendingBg,
      borderColor: colors.caution,
    },
    label: { color: statusColors.pendingText },
    iconColor: statusColors.pendingText,
  },
  rejected: {
    container: {
      backgroundColor: colors.secondaryDark,
      borderColor: colors.secondaryDark,
    },
    label: { color: colors.buttonColor },
    iconColor: colors.buttonColor,
  },
  published: {
    container: {
      backgroundColor: colors.primaryDark,
      borderColor: colors.primaryDark,
    },
    label: { color: colors.buttonColor },
    iconColor: colors.buttonColor,
  },
  shared: {
    container: {
      backgroundColor: colors.surface1,
      borderColor: colors.primary,
    },
    label: { color: colors.primaryDark },
    iconColor: colors.primaryDark,
  },
};
