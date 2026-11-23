import React, { useEffect, useState } from 'react';
import { I18nManager, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { CATEGORY_IDS, CATEGORY_MAP } from '@cookbook/core/recipe-model';
import { colors, fontFamilies, radii, spacing, typeScale } from '@/theme';
import { Badge, Button, Card, Chip } from '@/components/ui';
import { APP_VARIANT, IS_DTU_MODE, checkDtuConnection } from '@/services/dtu-health-service';
import { getE2eTelemetrySummary, subscribeTelemetry } from '@/services/logger';
import { useSession } from '@/context/SessionContext';

export default function HomeScreen() {
  const { role, profile } = useSession();
  const [dtuText, setDtuText] = useState('DTU: בודק חיבור...');
  const [telemetrySummary, setTelemetrySummary] = useState(getE2eTelemetrySummary());

  useEffect(() => {
    const unsub = subscribeTelemetry(() => setTelemetrySummary(getE2eTelemetrySummary()));
    return unsub;
  }, []);

  useEffect(() => {
    if (!IS_DTU_MODE) return;
    let active = true;
    checkDtuConnection().then((res) => {
      if (!active) return;
      setDtuText(res.connected ? `DTU: מחובר (${res.profile || 'ready'})` : 'DTU: לא זמין');
    });
    return () => {
      active = false;
    };
  }, []);

  const rtlLabel = I18nManager.isRTL ? 'RTL: פעיל' : 'RTL: כבוי';

  return (
    <ScrollView
      testID="home-screen"
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Card style={styles.heroCard}>
        <Text testID="home-hero-title" style={styles.heroTitle}>
          ספר המתכונים המשפחתי
        </Text>
        <Text style={styles.heroSubtitle}>
          {profile?.fullName
            ? `שלום ${profile.fullName}, מה נבשל היום?`
            : 'המתכונים האהובים של המשפחה, תמיד בהישג יד במטבח.'}
        </Text>
        <View style={styles.heroActions}>
          <Button
            label="לכל המתכונים"
            onPress={() => router.navigate('/(tabs)/categories')}
            testID="home-browse-all-btn"
          />
        </View>
      </Card>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>קטגוריות</Text>
        <View style={styles.chipsWrap}>
          {CATEGORY_IDS.map((catId) => (
            <Chip
              key={catId}
              label={CATEGORY_MAP[catId] || catId}
              testID={`home-category-card-${catId}`}
              onPress={() =>
                router.push({ pathname: '/(tabs)/categories', params: { category: catId } })
              }
            />
          ))}
        </View>
      </View>

      {IS_DTU_MODE ? (
        <Card style={styles.e2eBar} elevated={false}>
          <View style={styles.e2eRow}>
            <Badge label={role} tone="neutral" />
            <Text testID="dtu-status-indicator" style={styles.e2eText}>
              {dtuText} · {rtlLabel} · {APP_VARIANT}
            </Text>
          </View>
          <Text testID="e2e-telemetry-status" style={styles.e2eMeta}>
            {telemetrySummary}
          </Text>
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface0,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing['2xl'],
  },
  heroCard: {
    backgroundColor: colors.surface1,
    gap: spacing.sm,
  },
  heroTitle: {
    fontSize: typeScale.step4,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    textAlign: 'left',
  },
  heroSubtitle: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink2,
    lineHeight: 22,
    textAlign: 'left',
  },
  heroActions: {
    flexDirection: 'row',
    marginTop: spacing.xs,
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: typeScale.step2,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    textAlign: 'left',
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  e2eBar: {
    backgroundColor: colors.surface2,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 4,
  },
  e2eRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  e2eText: {
    fontSize: 12,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink2,
    flex: 1,
    textAlign: 'left',
  },
  e2eMeta: {
    fontSize: 11,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    textAlign: 'left',
  },
});
