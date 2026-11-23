import { useEffect, useState } from 'react';
import { I18nManager, Platform, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { CATEGORY_IDS } from '@cookbook/core/recipe-model';
import { colors, radii, shadows, typeScale } from '@cookbook/tokens';

type DtuHealth = {
  status: 'checking' | 'connected' | 'offline';
  profile?: string | null;
  detail?: string;
};

function resolveDtuSeedUrl(): string {
  const override = process.env.EXPO_PUBLIC_DTU_SEED_URL;
  if (override) return override;
  // Android Emulator reaches host loopback via adb reverse (127.0.0.1) or 10.0.2.2
  const host = Platform.OS === 'android' ? '127.0.0.1' : '127.0.0.1';
  return `http://${host}:9200`;
}

export default function HomeSmokeScreen() {
  const [dtu, setDtu] = useState<DtuHealth>({ status: 'checking' });
  const appVariant = String(Constants.expoConfig?.extra?.appVariant || 'e2e');

  useEffect(() => {
    let active = true;
    const base = resolveDtuSeedUrl();

    async function checkHealth() {
      try {
        const res = await fetch(`${base}/health`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (active) {
          setDtu({ status: 'connected', profile: json.lastProfile || null });
        }
      } catch (err) {
        // Android Emulator fallback when adb reverse isn't active
        if (Platform.OS === 'android' && base.includes('127.0.0.1')) {
          try {
            const fallbackRes = await fetch('http://10.0.2.2:9200/health');
            if (fallbackRes.ok) {
              const json = await fallbackRes.json();
              if (active) {
                setDtu({ status: 'connected', profile: json.lastProfile || null });
                return;
              }
            }
          } catch {
            // fall through to offline
          }
        }
        if (active) {
          setDtu({
            status: 'offline',
            detail: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    checkHealth();
    return () => {
      active = false;
    };
  }, []);

  const dtuLabel =
    dtu.status === 'connected'
      ? `DTU: מחובר (${dtu.profile || 'ready'})`
      : dtu.status === 'checking'
        ? 'DTU: בודק חיבור...'
        : 'DTU: לא זמין';

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.card}>
        <Text testID="app-title" style={styles.title}>
          ספר המתכונים המשפחתי
        </Text>
        <Text testID="core-categories-count" style={styles.subtitle}>
          קטגוריות זמינות: {CATEGORY_IDS.length}
        </Text>
        <View style={styles.pillRow}>
          <Text testID="dtu-status" style={styles.badge}>
            {dtuLabel}
          </Text>
          <Text testID="rtl-status" style={styles.meta}>
            RTL: {I18nManager.isRTL ? 'פעיל' : 'כבוי'} · {appVariant}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface0,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.hairline,
    ...shadows.level2,
  },
  title: {
    fontSize: typeScale.step3,
    fontWeight: '700',
    color: colors.ink,
    textAlign: 'right',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: typeScale.step1,
    color: colors.ink2,
    textAlign: 'right',
    marginBottom: 16,
  },
  pillRow: {
    gap: 8,
    alignItems: 'flex-end',
  },
  badge: {
    backgroundColor: colors.primary,
    color: colors.buttonColor,
    fontSize: typeScale.step0,
    fontWeight: '600',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  meta: {
    fontSize: typeScale.stepMinus1,
    color: colors.ink3,
    textAlign: 'right',
  },
});
