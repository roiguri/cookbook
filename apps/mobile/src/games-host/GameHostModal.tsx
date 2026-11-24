import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radii, spacing, statusColors, typeScale } from '@/theme';
import { Button, PressableScale } from '@/components/ui';
import {
  type GameKey,
  type PreferredOrientation,
  getGameEntry,
  pickRandomFillerGameKey,
} from './games-catalog';
import {
  GameWebViewHost,
  type GameReadyPayload,
  type GameWebViewHostHandle,
} from './GameWebViewHost';

export type GameHostMode = 'arcade' | 'filler';

export type GameHostStatus = 'loading' | 'ready' | 'paused' | 'complete' | 'gameover' | 'error';

export type OrientationBadgeValue = 'landscape' | 'portrait' | 'auto';

export interface GameHostModalProps {
  visible: boolean;
  /**
   * Explicit mini-game key for arcade mode, or `'random'` / omitted for filler mode
   * (which picks randomly strictly from `['memory', 'burger']`).
   */
  gameKey?: GameKey | 'random' | null;
  mode?: GameHostMode;
  onClose: () => void;
  /**
   * Optional close interceptor (e.g. close-guard confirmation dialog during AI extraction).
   * When omitted, `onClose` is called directly.
   */
  onRequestClose?: () => void;
  closeLabel?: string;
  /** Filler mode: signals that the background async job (AI import / enhancement) finished. */
  asyncReady?: boolean;
  /** Filler mode: banner headline when `asyncReady` becomes true (e.g. 'המתכון מוכן!'). */
  readyBannerText?: string;
  /** Filler mode: CTA button label when `asyncReady` becomes true (e.g. 'צפה במתכון'). */
  readyCtaLabel?: string;
  /** Filler mode: optional testID for the ready CTA button (e.g. 'ai-extract-ready-btn'). */
  readyCtaTestID?: string;
  /** Filler mode: optional testID on an inner filler wrapper (e.g. 'ai-filler-game'). */
  fillerTestID?: string;
  /** Filler mode: callback when user taps the ready CTA button. */
  onViewResult?: () => void;
  /** Filler mode: optional override for loading message while waiting. */
  loadingText?: string;
  /** Optional game config overrides forwarded to GameWrapper.create(). */
  config?: Record<string, unknown>;
}

function orientationToBadge(pref: PreferredOrientation): OrientationBadgeValue {
  if (pref === 'landscape') return 'landscape';
  if (pref === 'portrait') return 'portrait';
  return 'auto';
}

async function applyNativeOrientationLock(pref: PreferredOrientation): Promise<void> {
  try {
    if (pref === 'landscape') {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    } else if (pref === 'portrait') {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    } else {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.DEFAULT);
    }
  } catch {
    // Emulators / simulators / split-screen may reject orientation locks — fail gracefully
  }
}

async function restoreDefaultOrientation(): Promise<void> {
  try {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.DEFAULT);
  } catch {
    // Ignore on unsupported environments
  }
}

export function GameHostModal({
  visible,
  gameKey,
  mode,
  onClose,
  onRequestClose,
  closeLabel,
  asyncReady,
  readyBannerText,
  readyCtaLabel,
  readyCtaTestID,
  fillerTestID,
  onViewResult,
  loadingText,
  config,
}: GameHostModalProps) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isCompactLandscape = width > height && height < 500;

  const isFillerMode = mode === 'filler' || asyncReady !== undefined || gameKey === 'random';

  const hostRef = useRef<GameWebViewHostHandle | null>(null);
  const [fillerPick, setFillerPick] = useState<GameKey | null>(null);
  const [status, setStatus] = useState<GameHostStatus>('loading');
  const [orientationBadge, setOrientationBadge] = useState<OrientationBadgeValue>('auto');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const prevVisibleRef = useRef(false);

  // Pick a fresh random filler game strictly from ['memory', 'burger'] on each modal open
  useEffect(() => {
    const justOpened = visible && !prevVisibleRef.current;
    prevVisibleRef.current = visible;

    if (justOpened) {
      setStatus('loading');
      setErrorMsg(null);
      if (!gameKey || gameKey === 'random') {
        setFillerPick(pickRandomFillerGameKey());
      } else {
        setFillerPick(null);
      }
    } else if (!visible) {
      setStatus('loading');
      setErrorMsg(null);
      setFillerPick(null);
    }
  }, [visible, gameKey]);

  const activeGameKey: GameKey | null = useMemo(() => {
    if (!visible) return null;
    if (gameKey && gameKey !== 'random') return gameKey;
    return fillerPick;
  }, [visible, gameKey, fillerPick]);

  const gameEntry = useMemo(
    () => (activeGameKey ? getGameEntry(activeGameKey) : null),
    [activeGameKey],
  );

  // Manage native expo-screen-orientation lock & guaranteed DEFAULT restoration on close/unmount
  useEffect(() => {
    if (!visible || !gameEntry) {
      void restoreDefaultOrientation();
      setOrientationBadge('auto');
      return;
    }

    const pref = gameEntry.preferredOrientation;
    setOrientationBadge(orientationToBadge(pref));
    void applyNativeOrientationLock(pref);

    return () => {
      void restoreDefaultOrientation();
    };
  }, [visible, gameEntry]);

  // Extra safety net: guarantee DEFAULT orientation is restored on unmount
  useEffect(() => {
    return () => {
      void restoreDefaultOrientation();
    };
  }, []);

  // Celebratory haptic when async background job completes during filler mode
  const prevAsyncReadyRef = useRef(Boolean(asyncReady));
  useEffect(() => {
    if (visible && asyncReady && !prevAsyncReadyRef.current) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    prevAsyncReadyRef.current = Boolean(asyncReady);
  }, [visible, asyncReady]);

  const handleRequestClose = useCallback(() => {
    if (onRequestClose) {
      onRequestClose();
      return;
    }
    void restoreDefaultOrientation();
    onClose();
  }, [onClose, onRequestClose]);

  const handleRestart = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setErrorMsg(null);
    hostRef.current?.restart();
  }, []);

  const handleReady = useCallback((payload: GameReadyPayload) => {
    setStatus('ready');
    setErrorMsg(null);
    if (payload.preferredOrientation) {
      setOrientationBadge(orientationToBadge(payload.preferredOrientation));
    }
  }, []);

  const handleComplete = useCallback(() => {
    setStatus('complete');
  }, []);

  const handleGameOver = useCallback(() => {
    setStatus('gameover');
  }, []);

  const handlePausedChange = useCallback((paused: boolean) => {
    setStatus((prev) => {
      if (paused) return 'paused';
      return prev === 'paused' ? 'ready' : prev;
    });
  }, []);

  const handleError = useCallback((message: string) => {
    setStatus('error');
    setErrorMsg(message);
  }, []);

  const handleViewResult = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    void restoreDefaultOrientation();
    if (onViewResult) {
      onViewResult();
    } else {
      onClose();
    }
  }, [onClose, onViewResult]);

  const resolvedCloseLabel = closeLabel || (isFillerMode ? 'סגור' : 'חזרה למשחקים');
  const resolvedLoadingText =
    loadingText || gameEntry?.loadingText || 'מעבד... הנה משחק קטן בינתיים!';
  const resolvedReadyBannerText = readyBannerText || 'מוכן!';
  const resolvedReadyCtaLabel = readyCtaLabel || 'צפה בתוצאה';

  const statusIndicatorText = useMemo(() => {
    if (isFillerMode && asyncReady) return resolvedReadyBannerText;
    switch (status) {
      case 'loading':
        return 'טוען...';
      case 'paused':
        return 'מושהה';
      case 'complete':
        return 'הושלם!';
      case 'gameover':
        return 'סיום';
      case 'error':
        return 'שגיאה';
      default:
        return 'מוכן';
    }
  }, [asyncReady, isFillerMode, resolvedReadyBannerText, status]);

  const modalContent = (
    <View
      testID="game-host-modal"
      collapsable={false}
      style={[
        styles.modalRoot,
        {
          paddingTop: isCompactLandscape ? Math.max(insets.top, 4) : Math.max(insets.top, 8),
          paddingBottom: isCompactLandscape ? Math.max(insets.bottom, 4) : insets.bottom,
          paddingHorizontal: Math.max(insets.left, insets.right),
        },
      ]}
    >
      {/* Top control bar */}
      <View style={[styles.topBarWrapper, isCompactLandscape && styles.topBarWrapperCompact]}>
        <View style={[styles.topBar, isCompactLandscape && styles.topBarCompact]}>
          <PressableScale
            testID="game-close-btn"
            variant="button"
            onPress={handleRequestClose}
            accessibilityLabel={resolvedCloseLabel}
            style={[styles.closeBtn, isCompactLandscape && styles.closeBtnCompact]}
          >
            <Ionicons name="arrow-forward" size={16} color={colors.ink2} />
            <Text style={styles.closeBtnText} numberOfLines={1} allowFontScaling={false}>
              {resolvedCloseLabel}
            </Text>
          </PressableScale>

          {gameEntry ? (
            <View style={styles.titleCluster}>
              <Text style={styles.titleEmoji} allowFontScaling={false}>
                {gameEntry.icon}
              </Text>
              <Text style={styles.titleText} numberOfLines={1}>
                {gameEntry.name}
              </Text>
            </View>
          ) : null}

          <View style={styles.controlsCluster}>
            {isCompactLandscape ? (
              <>
                <Text
                  testID="game-orientation-badge"
                  accessibilityLabel={orientationBadge}
                  style={[
                    styles.orientationBadge,
                    orientationBadge === 'landscape' && styles.orientationBadgeLandscape,
                  ]}
                  allowFontScaling={false}
                  numberOfLines={1}
                >
                  {orientationBadge}
                </Text>

                <Text
                  testID="game-status-indicator"
                  accessibilityLabel={statusIndicatorText}
                  style={[
                    styles.statusBadge,
                    status === 'ready' && styles.statusBadgeReady,
                    status === 'complete' && styles.statusBadgeSuccess,
                    status === 'error' && styles.statusBadgeError,
                  ]}
                  allowFontScaling={false}
                  numberOfLines={1}
                >
                  {statusIndicatorText}
                </Text>
              </>
            ) : null}

            <PressableScale
              testID="game-restart-btn"
              variant="icon"
              onPress={handleRestart}
              accessibilityLabel="התחל מחדש"
              style={styles.restartBtn}
            >
              <Ionicons name="refresh" size={18} color={colors.primaryDark} />
            </PressableScale>
          </View>
        </View>

        {!isCompactLandscape ? (
          <View style={styles.metaStrip}>
            <Text
              testID="game-orientation-badge"
              accessibilityLabel={orientationBadge}
              style={[
                styles.orientationBadge,
                orientationBadge === 'landscape' && styles.orientationBadgeLandscape,
              ]}
              allowFontScaling={false}
              numberOfLines={1}
            >
              {orientationBadge}
            </Text>

            <Text
              testID="game-status-indicator"
              accessibilityLabel={statusIndicatorText}
              style={[
                styles.statusBadge,
                status === 'ready' && styles.statusBadgeReady,
                status === 'complete' && styles.statusBadgeSuccess,
                status === 'error' && styles.statusBadgeError,
              ]}
              allowFontScaling={false}
              numberOfLines={1}
            >
              {statusIndicatorText}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Filler Mode async status banner (Slices 06 & 09) */}
      {isFillerMode ? (
        <View
          style={[
            styles.fillerBanner,
            asyncReady ? styles.fillerBannerReady : styles.fillerBannerLoading,
            isCompactLandscape && styles.fillerBannerCompact,
          ]}
        >
          {asyncReady ? (
            <View style={styles.fillerReadyRow}>
              <View style={styles.fillerReadyTextWrap}>
                <Ionicons name="sparkles" size={18} color={colors.primaryDark} />
                <Text style={styles.fillerReadyText} numberOfLines={2}>
                  {resolvedReadyBannerText}
                </Text>
              </View>
              <Button
                testID={readyCtaTestID || 'game-ready-cta-btn'}
                label={resolvedReadyCtaLabel}
                variant="primary"
                size="sm"
                onPress={handleViewResult}
              />
            </View>
          ) : (
            <View style={styles.fillerLoadingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.fillerLoadingText} numberOfLines={2}>
                {resolvedLoadingText}
              </Text>
            </View>
          )}
        </View>
      ) : null}

      {/* Main offline WebView host */}
      <View style={styles.stage}>
        {activeGameKey ? (
          <GameWebViewHost
            ref={hostRef}
            gameKey={activeGameKey}
            config={config}
            asyncReady={Boolean(asyncReady)}
            onReady={handleReady}
            onComplete={handleComplete}
            onGameOver={handleGameOver}
            onClose={handleViewResult}
            onPausedChange={handlePausedChange}
            onError={handleError}
          />
        ) : null}

        {status === 'loading' ? (
          <View pointerEvents="none" style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingOverlayText}>טוען את המשחק...</Text>
          </View>
        ) : null}

        {status === 'error' && errorMsg ? (
          <View style={styles.errorOverlay}>
            <Ionicons name="alert-circle-outline" size={32} color={colors.secondary} />
            <Text style={styles.errorTitle}>לא הצלחנו לטעון את המשחק</Text>
            <Text style={styles.errorBody}>{errorMsg}</Text>
            <Button label="נסה שוב" variant="primary" size="sm" onPress={handleRestart} />
          </View>
        ) : null}
      </View>
    </View>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
      onRequestClose={handleRequestClose}
    >
      {fillerTestID ? (
        <View testID={fillerTestID} collapsable={false} style={styles.fillerOuter}>
          {modalContent}
        </View>
      ) : (
        modalContent
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  fillerOuter: {
    flex: 1,
    backgroundColor: colors.surface0,
  },
  modalRoot: {
    flex: 1,
    backgroundColor: colors.surface0,
  },
  topBarWrapper: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    backgroundColor: colors.surface1,
  },
  topBarWrapperCompact: {
    borderBottomWidth: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    gap: spacing.sm,
  },
  topBarCompact: {
    paddingVertical: spacing.xs,
  },
  metaStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
    gap: spacing.sm,
  },
  closeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    flexShrink: 0,
  },
  closeBtnCompact: {
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
  },
  closeBtnText: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink2,
    includeFontPadding: false,
  },
  titleCluster: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minWidth: 0,
  },
  titleEmoji: {
    fontSize: 18,
    includeFontPadding: false,
  },
  titleText: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    includeFontPadding: false,
    flexShrink: 1,
  },
  controlsCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 0,
  },
  orientationBadge: {
    fontSize: 11,
    fontFamily: fontFamilies.bodyBold,
    color: statusColors.sharedText,
    backgroundColor: statusColors.sharedBg,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: radii.pill,
    overflow: 'hidden',
    includeFontPadding: false,
  },
  orientationBadgeLandscape: {
    color: colors.buttonColor,
    backgroundColor: colors.primary,
  },
  statusBadge: {
    fontSize: 11,
    fontFamily: fontFamilies.bodyBold,
    color: statusColors.pendingText,
    backgroundColor: statusColors.pendingBg,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: radii.pill,
    overflow: 'hidden',
    includeFontPadding: false,
  },
  statusBadgeReady: {
    color: statusColors.approvedText,
    backgroundColor: statusColors.approvedBg,
  },
  statusBadgeSuccess: {
    color: colors.buttonColor,
    backgroundColor: colors.primary,
  },
  statusBadgeError: {
    color: statusColors.rejectedText,
    backgroundColor: statusColors.rejectedBg,
  },
  restartBtn: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fillerBanner: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
  },
  fillerBannerCompact: {
    paddingVertical: spacing.xs,
  },
  fillerBannerLoading: {
    backgroundColor: colors.surface2,
    borderBottomColor: colors.hairline,
  },
  fillerBannerReady: {
    backgroundColor: statusColors.approvedBg,
    borderBottomColor: colors.primary,
  },
  fillerLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  fillerLoadingText: {
    flexShrink: 1,
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink2,
    textAlign: 'center',
    includeFontPadding: false,
  },
  fillerReadyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  fillerReadyTextWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  fillerReadyText: {
    flex: 1,
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
    textAlign: 'left',
    includeFontPadding: false,
  },
  stage: {
    flex: 1,
    position: 'relative',
    backgroundColor: colors.surface0,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surface0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  loadingOverlayText: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink3,
    includeFontPadding: false,
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surface0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  errorTitle: {
    fontSize: typeScale.step1,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    textAlign: 'center',
    includeFontPadding: false,
  },
  errorBody: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    textAlign: 'center',
  },
});
