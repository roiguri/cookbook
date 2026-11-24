import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  type LayoutChangeEvent,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radii, shadows, spacing, statusColors, typeScale } from '@/theme';
import { Button } from '@/components/ui';

export const MIN_ZOOM_SCALE = 1;
export const TOGGLE_ZOOM_SCALE = 2.5;
export const MAX_ZOOM_SCALE = 4;
const SWIPE_DISTANCE_THRESHOLD = 60;
const SWIPE_VELOCITY_THRESHOLD = 450;

export interface ZoomCommand {
  scale: number;
  seq: number;
}

export interface ZoomablePageProps {
  pageNumber: number;
  imageUrl: string | null;
  loadingUrl: boolean;
  errorText: string | null;
  onRetry: () => void;
  onImageError: () => void;
  canGoPrev: boolean;
  canGoNext: boolean;
  onSwipePrev: () => void;
  onSwipeNext: () => void;
  zoomCommand: ZoomCommand;
  onZoomChange: (scale: number) => void;
  fullscreen?: boolean;
  exposeTestID?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function ZoomablePage({
  pageNumber,
  imageUrl,
  loadingUrl,
  errorText,
  onRetry,
  onImageError,
  canGoPrev,
  canGoNext,
  onSwipePrev,
  onSwipeNext,
  zoomCommand,
  onZoomChange,
  fullscreen = false,
  exposeTestID = true,
}: ZoomablePageProps) {
  const [imageLoading, setImageLoading] = useState(false);

  const scaleAnim = useRef(new Animated.Value(MIN_ZOOM_SCALE)).current;
  const translateXAnim = useRef(new Animated.Value(0)).current;
  const translateYAnim = useRef(new Animated.Value(0)).current;

  const currentScaleRef = useRef(MIN_ZOOM_SCALE);
  const savedScaleRef = useRef(MIN_ZOOM_SCALE);
  const savedXRef = useRef(0);
  const savedYRef = useRef(0);
  const containerSizeRef = useRef({ width: 320, height: 460 });
  const lastCommandSeqRef = useRef(zoomCommand.seq);

  // Keep latest callbacks in refs so memoized gestures never read stale closures
  const callbacksRef = useRef({
    canGoPrev,
    canGoNext,
    onSwipePrev,
    onSwipeNext,
    onZoomChange,
  });
  callbacksRef.current = {
    canGoPrev,
    canGoNext,
    onSwipePrev,
    onSwipeNext,
    onZoomChange,
  };

  const clampTranslations = useCallback((x: number, y: number, scale: number) => {
    const { width, height } = containerSizeRef.current;
    const maxX = Math.max(0, (width * (scale - 1)) / 2);
    const maxY = Math.max(0, (height * (scale - 1)) / 2);
    return {
      x: clamp(x, -maxX, maxX),
      y: clamp(y, -maxY, maxY),
    };
  }, []);

  const animateToTransform = useCallback(
    (targetScale: number, targetX: number, targetY: number, notify = true) => {
      const clampedScale = clamp(targetScale, MIN_ZOOM_SCALE, MAX_ZOOM_SCALE);
      const bounded =
        clampedScale <= 1.02 ? { x: 0, y: 0 } : clampTranslations(targetX, targetY, clampedScale);
      const finalScale = clampedScale <= 1.02 ? MIN_ZOOM_SCALE : clampedScale;

      currentScaleRef.current = finalScale;
      savedScaleRef.current = finalScale;
      savedXRef.current = bounded.x;
      savedYRef.current = bounded.y;

      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: finalScale,
          useNativeDriver: true,
          speed: 24,
          bounciness: 2,
        }),
        Animated.spring(translateXAnim, {
          toValue: bounded.x,
          useNativeDriver: true,
          speed: 24,
          bounciness: 2,
        }),
        Animated.spring(translateYAnim, {
          toValue: bounded.y,
          useNativeDriver: true,
          speed: 24,
          bounciness: 2,
        }),
      ]).start();

      if (notify) {
        callbacksRef.current.onZoomChange(finalScale);
      }
    },
    [clampTranslations, scaleAnim, translateXAnim, translateYAnim],
  );

  // Reset transform cleanly whenever page changes
  useEffect(() => {
    currentScaleRef.current = MIN_ZOOM_SCALE;
    savedScaleRef.current = MIN_ZOOM_SCALE;
    savedXRef.current = 0;
    savedYRef.current = 0;
    scaleAnim.setValue(MIN_ZOOM_SCALE);
    translateXAnim.setValue(0);
    translateYAnim.setValue(0);
    callbacksRef.current.onZoomChange(MIN_ZOOM_SCALE);
  }, [pageNumber, scaleAnim, translateXAnim, translateYAnim]);

  // Apply external zoom toggle / reset commands from the toolbar button
  useEffect(() => {
    if (zoomCommand.seq === lastCommandSeqRef.current) return;
    lastCommandSeqRef.current = zoomCommand.seq;
    animateToTransform(zoomCommand.scale, 0, 0, true);
  }, [zoomCommand.seq, zoomCommand.scale, animateToTransform]);

  // Track image loading state when URL changes
  useEffect(() => {
    if (imageUrl) {
      setImageLoading(true);
    } else {
      setImageLoading(false);
    }
  }, [imageUrl, pageNumber]);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) {
      containerSizeRef.current = { width, height };
    }
  }, []);

  const composedGesture = useMemo(() => {
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDuration(260)
      .maxDistance(24)
      .runOnJS(true)
      .onEnd((event, success) => {
        if (!success) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

        if (currentScaleRef.current > 1.05) {
          animateToTransform(MIN_ZOOM_SCALE, 0, 0, true);
        } else {
          const { width, height } = containerSizeRef.current;
          const focusOffsetX = (width / 2 - event.x) * (TOGGLE_ZOOM_SCALE - 1);
          const focusOffsetY = (height / 2 - event.y) * (TOGGLE_ZOOM_SCALE - 1);
          animateToTransform(TOGGLE_ZOOM_SCALE, focusOffsetX, focusOffsetY, true);
        }
      });

    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onStart(() => {
        savedScaleRef.current = currentScaleRef.current;
      })
      .onUpdate((event) => {
        const nextScale = clamp(savedScaleRef.current * event.scale, 0.85, MAX_ZOOM_SCALE);
        currentScaleRef.current = nextScale;
        scaleAnim.setValue(nextScale);
      })
      .onEnd(() => {
        if (currentScaleRef.current <= 1.05) {
          animateToTransform(MIN_ZOOM_SCALE, 0, 0, true);
        } else {
          const clampedScale = clamp(currentScaleRef.current, 1.05, MAX_ZOOM_SCALE);
          const bounded = clampTranslations(savedXRef.current, savedYRef.current, clampedScale);
          animateToTransform(clampedScale, bounded.x, bounded.y, true);
        }
      });

    const pan = Gesture.Pan()
      .minDistance(10)
      .maxPointers(1)
      .runOnJS(true)
      .onUpdate((event) => {
        if (savedScaleRef.current > 1.05) {
          const bounded = clampTranslations(
            savedXRef.current + event.translationX,
            savedYRef.current + event.translationY,
            savedScaleRef.current,
          );
          translateXAnim.setValue(bounded.x);
          translateYAnim.setValue(bounded.y);
          return;
        }

        // At 1x zoom: tactile RTL horizontal page drag preview
        const { canGoNext: nextAllowed, canGoPrev: prevAllowed } = callbacksRef.current;
        const dx = event.translationX;
        const blocked = (dx > 0 && !nextAllowed) || (dx < 0 && !prevAllowed);
        const damped = blocked ? dx * 0.22 : dx * 0.55;
        translateXAnim.setValue(clamp(damped, -120, 120));
      })
      .onEnd((event) => {
        if (savedScaleRef.current > 1.05) {
          const bounded = clampTranslations(
            savedXRef.current + event.translationX,
            savedYRef.current + event.translationY,
            savedScaleRef.current,
          );
          savedXRef.current = bounded.x;
          savedYRef.current = bounded.y;
          return;
        }

        const {
          canGoNext: nextAllowed,
          canGoPrev: prevAllowed,
          onSwipeNext: goNext,
          onSwipePrev: goPrev,
        } = callbacksRef.current;

        const passedDistance = Math.abs(event.translationX) >= SWIPE_DISTANCE_THRESHOLD;
        const passedVelocity = Math.abs(event.velocityX) >= SWIPE_VELOCITY_THRESHOLD;

        if (passedDistance || passedVelocity) {
          // Hebrew RTL book flow: swipe Left -> Right turns to next page; Right -> Left goes back
          if (event.translationX > 0 && nextAllowed) {
            Haptics.selectionAsync().catch(() => {});
            translateXAnim.setValue(0);
            goNext();
            return;
          }
          if (event.translationX < 0 && prevAllowed) {
            Haptics.selectionAsync().catch(() => {});
            translateXAnim.setValue(0);
            goPrev();
            return;
          }
        }

        Animated.spring(translateXAnim, {
          toValue: 0,
          useNativeDriver: true,
          speed: 28,
          bounciness: 4,
        }).start();
      });

    return Gesture.Simultaneous(doubleTap, pinch, pan);
  }, [animateToTransform, clampTranslations, scaleAnim, translateXAnim, translateYAnim]);

  const showSpinner = loadingUrl || (Boolean(imageUrl) && imageLoading && !errorText);

  return (
    <View
      onLayout={handleLayout}
      style={[styles.stage, fullscreen ? styles.stageFullscreen : styles.stageFramed]}
    >
      {errorText ? (
        <View style={styles.errorBox}>
          <View style={styles.errorIconCircle}>
            <Ionicons name="cloud-offline-outline" size={28} color={colors.secondary} />
          </View>
          <Text style={styles.errorTitle}>{`לא ניתן להציג את עמוד ${pageNumber}`}</Text>
          <Text style={styles.errorSubtitle}>{errorText}</Text>
          <Button
            label="נסה שוב"
            variant="primary"
            size="sm"
            onPress={onRetry}
            style={styles.retryBtn}
          />
        </View>
      ) : (
        <GestureDetector gesture={composedGesture}>
          <Animated.View style={styles.gestureFill}>
            <Animated.View
              style={[
                styles.imageTransformWrap,
                {
                  transform: [
                    { translateX: translateXAnim },
                    { translateY: translateYAnim },
                    { scale: scaleAnim },
                  ],
                },
              ]}
            >
              {imageUrl ? (
                <Image
                  testID={exposeTestID ? `grandma-page-image-${pageNumber}` : undefined}
                  source={{ uri: imageUrl }}
                  cachePolicy="disk"
                  contentFit="contain"
                  transition={150}
                  accessibilityLabel={`עמוד ${pageNumber} מספר המתכונים של סבתא`}
                  onLoad={() => setImageLoading(false)}
                  onDisplay={() => setImageLoading(false)}
                  onLoadEnd={() => setImageLoading(false)}
                  onError={() => {
                    setImageLoading(false);
                    onImageError();
                  }}
                  style={styles.pageImage}
                />
              ) : null}
            </Animated.View>

            {showSpinner ? (
              <View pointerEvents="none" style={styles.spinnerOverlay}>
                <View style={styles.spinnerBadge}>
                  <ActivityIndicator size="small" color={colors.primaryDark} />
                  <Text style={styles.spinnerText} allowFontScaling={false}>
                    {`טוען עמוד ${pageNumber}...`}
                  </Text>
                </View>
              </View>
            ) : null}
          </Animated.View>
        </GestureDetector>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageFramed: {
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    ...shadows.level2,
  },
  stageFullscreen: {
    backgroundColor: colors.ink,
    borderRadius: 0,
  },
  gestureFill: {
    flex: 1,
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageTransformWrap: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageImage: {
    width: '100%',
    height: '100%',
  },
  spinnerOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinnerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: statusColors.whiteAlpha85,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  spinnerText: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: typeScale.stepMinus1,
    color: colors.ink2,
    includeFontPadding: false,
  },
  errorBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  errorIconCircle: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    backgroundColor: statusColors.rejectedBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  errorTitle: {
    fontFamily: fontFamilies.heading,
    fontSize: typeScale.step1,
    color: colors.ink,
    textAlign: 'center',
    includeFontPadding: false,
  },
  errorSubtitle: {
    fontFamily: fontFamilies.body,
    fontSize: typeScale.stepMinus1,
    color: colors.ink3,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryBtn: {
    marginTop: spacing.xs,
  },
});
