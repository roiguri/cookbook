import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fontFamilies, radii, shadows, spacing, typeScale, zIndex } from '@/theme';

export type ToastTone = 'success' | 'error' | 'info';

interface ToastState {
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  showToast: (message: string, tone?: ToastTone, durationMs?: number) => void;
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();

  const showToast = useCallback(
    (message: string, tone: ToastTone = 'info', durationMs: number = 3200) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setToast({ message, tone });
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();
      timerRef.current = setTimeout(() => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }).start(() => setToast(null));
      }, durationMs);
    },
    [opacity],
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast ? (
        <View
          pointerEvents="none"
          style={[styles.container, { bottom: Math.max(insets.bottom, 16) + 64 }]}
        >
          <Animated.View
            testID="toast-banner"
            style={[
              styles.banner,
              toast.tone === 'success' && styles.success,
              toast.tone === 'error' && styles.error,
              toast.tone === 'info' && styles.info,
              { opacity },
            ]}
          >
            <Text style={styles.text}>{toast.message}</Text>
          </Animated.View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    start: spacing.lg,
    end: spacing.lg,
    zIndex: zIndex.toast,
    alignItems: 'center',
  },
  banner: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: radii.md,
    maxWidth: 420,
    width: '100%',
    ...shadows.level3,
  },
  success: {
    backgroundColor: colors.primaryDark,
  },
  error: {
    backgroundColor: colors.secondary,
  },
  info: {
    backgroundColor: colors.ink,
  },
  text: {
    color: colors.buttonColor,
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyMedium,
    textAlign: 'center',
  },
});
