import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { colors, radii, statusColors, zIndex } from '@/theme';

// Exact constants mirrored from src/lib/easter-egg/games-unlock.js
export const TAP_TARGET = 7;
export const TAP_WINDOW_MS = 2000;
export const UNLOCK_COOLDOWN_MS = 1500;
const UNLOCK_NAV_DELAY_MS = 250;
const SPARKLE_DURATION_MS = 900;
const SPARKLE_COUNT = 18;

export type UnlockGlowLevel = 0 | 1 | 2 | 3;

interface EasterEggContextValue {
  unlocked: boolean;
  tapCount: number;
  glowLevel: UnlockGlowLevel;
  isSparkling: boolean;
  registerLogoTap: () => void;
  resetSession: () => void;
}

const EasterEggContext = createContext<EasterEggContextValue>({
  unlocked: false,
  tapCount: 0,
  glowLevel: 0,
  isSparkling: false,
  registerLogoTap: () => {},
  resetSession: () => {},
});

function computeGlowLevel(count: number): UnlockGlowLevel {
  if (count >= 6) return 3;
  if (count >= 5) return 2;
  if (count >= 3) return 1;
  return 0;
}

interface SparkleSpec {
  id: number;
  dx: number;
  dy: number;
  size: number;
  color: string;
}

const SPARKLE_PALETTE = [colors.primary, colors.primaryBright, colors.caution, colors.buttonColor];

function createSparkleSpecs(): SparkleSpec[] {
  const specs: SparkleSpec[] = [];
  for (let i = 0; i < SPARKLE_COUNT; i += 1) {
    const angle = (Math.PI * 2 * i) / SPARKLE_COUNT;
    const distance = 90 + (i % 3) * 42;
    specs.push({
      id: i,
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance,
      size: i % 3 === 0 ? 12 : 9,
      color: SPARKLE_PALETTE[i % SPARKLE_PALETTE.length],
    });
  }
  return specs;
}

const SPARKLE_SPECS = createSparkleSpecs();

function UnlockSparkleOverlay({ active }: { active: boolean }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      progress.setValue(0);
      return;
    }

    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: SPARKLE_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => {
      anim.stop();
    };
  }, [active, progress]);

  if (!active) return null;

  const dimOpacity = progress.interpolate({
    inputRange: [0, 0.2, 0.7, 1],
    outputRange: [0, 0.45, 0.35, 0],
  });

  const flashScale = progress.interpolate({
    inputRange: [0, 0.25, 1],
    outputRange: [0.2, 1.8, 3.6],
  });

  const flashOpacity = progress.interpolate({
    inputRange: [0, 0.2, 1],
    outputRange: [0.85, 0.7, 0],
  });

  return (
    <View pointerEvents="none" style={styles.sparkleOverlay}>
      <Animated.View style={[styles.sparkleDim, { opacity: dimOpacity }]} />
      <View style={styles.sparkleOrigin}>
        <Animated.View
          style={[
            styles.sparkleFlash,
            {
              opacity: flashOpacity,
              transform: [{ scale: flashScale }],
            },
          ]}
        />
        {SPARKLE_SPECS.map((spec) => {
          const translateX = progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0, spec.dx],
          });
          const translateY = progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0, spec.dy],
          });
          const scale = progress.interpolate({
            inputRange: [0, 0.15, 0.75, 1],
            outputRange: [0.1, 1.25, 0.9, 0.3],
          });
          const opacity = progress.interpolate({
            inputRange: [0, 0.1, 0.72, 1],
            outputRange: [0, 1, 1, 0],
          });

          return (
            <Animated.View
              key={spec.id}
              style={[
                styles.sparkleDot,
                {
                  width: spec.size,
                  height: spec.size,
                  borderRadius: radii.pill,
                  backgroundColor: spec.color,
                  opacity,
                  transform: [{ translateX }, { translateY }, { scale }],
                },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

export function EasterEggProvider({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [tapCount, setTapCount] = useState(0);
  const [glowLevel, setGlowLevel] = useState<UnlockGlowLevel>(0);
  const [isSparkling, setIsSparkling] = useState(false);

  const tapCountRef = useRef(0);
  const lastTapAtRef = useRef(0);
  const cooldownUntilRef = useRef(0);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sparkleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  const clearAllTimers = useCallback(() => {
    clearResetTimer();
    if (navTimerRef.current) {
      clearTimeout(navTimerRef.current);
      navTimerRef.current = null;
    }
    if (sparkleTimerRef.current) {
      clearTimeout(sparkleTimerRef.current);
      sparkleTimerRef.current = null;
    }
  }, [clearResetTimer]);

  useEffect(() => {
    return () => {
      clearAllTimers();
    };
  }, [clearAllTimers]);

  const registerLogoTap = useCallback(() => {
    const now = Date.now();

    // Suppress stray 8th+ taps while the unlock burst & navigation are in flight
    if (now < cooldownUntilRef.current) {
      return;
    }

    if (lastTapAtRef.current > 0 && now - lastTapAtRef.current > TAP_WINDOW_MS) {
      tapCountRef.current = 0;
    }

    lastTapAtRef.current = now;
    tapCountRef.current += 1;

    const nextCount = tapCountRef.current;
    const nextGlow = computeGlowLevel(nextCount);

    clearResetTimer();
    resetTimerRef.current = setTimeout(() => {
      tapCountRef.current = 0;
      lastTapAtRef.current = 0;
      setTapCount(0);
      setGlowLevel(0);
      resetTimerRef.current = null;
    }, TAP_WINDOW_MS);

    if (nextCount < TAP_TARGET) {
      setTapCount(nextCount);
      setGlowLevel(nextGlow);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      return;
    }

    // 7th tap within TAP_WINDOW_MS -> unlock secret arcade!
    clearResetTimer();
    tapCountRef.current = 0;
    lastTapAtRef.current = 0;
    cooldownUntilRef.current = now + UNLOCK_COOLDOWN_MS;

    setTapCount(0);
    setGlowLevel(0);
    setUnlocked(true);
    setIsSparkling(true);

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

    if (sparkleTimerRef.current) {
      clearTimeout(sparkleTimerRef.current);
    }
    sparkleTimerRef.current = setTimeout(() => {
      setIsSparkling(false);
      sparkleTimerRef.current = null;
    }, SPARKLE_DURATION_MS);

    if (navTimerRef.current) {
      clearTimeout(navTimerRef.current);
    }
    navTimerRef.current = setTimeout(() => {
      navTimerRef.current = null;
      router.push('/games');
    }, UNLOCK_NAV_DELAY_MS);
  }, [clearResetTimer]);

  const resetSession = useCallback(() => {
    clearAllTimers();
    tapCountRef.current = 0;
    lastTapAtRef.current = 0;
    cooldownUntilRef.current = 0;
    setTapCount(0);
    setGlowLevel(0);
    setUnlocked(false);
    setIsSparkling(false);
  }, [clearAllTimers]);

  const value = useMemo<EasterEggContextValue>(
    () => ({
      unlocked,
      tapCount,
      glowLevel,
      isSparkling,
      registerLogoTap,
      resetSession,
    }),
    [glowLevel, isSparkling, registerLogoTap, resetSession, tapCount, unlocked],
  );

  return (
    <EasterEggContext.Provider value={value}>
      {children}
      <UnlockSparkleOverlay active={isSparkling} />
    </EasterEggContext.Provider>
  );
}

export function useEasterEgg() {
  return useContext(EasterEggContext);
}

const styles = StyleSheet.create({
  sparkleOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: zIndex.fullscreen,
  },
  sparkleDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: statusColors.overlayBackdrop,
  },
  sparkleOrigin: {
    position: 'absolute',
    top: 72,
    alignSelf: 'center',
    width: 0,
    height: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkleFlash: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryBright,
  },
  sparkleDot: {
    position: 'absolute',
  },
});
