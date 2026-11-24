import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radii, shadows, spacing, statusColors, typeScale } from '@/theme';
import { Button, PressableScale } from '@/components/ui';
import { GAMES_CATALOG, GameHostModal, type GameKey, getOrientationHintHebrew } from '@/games-host';

export default function GamesScreen() {
  const insets = useSafeAreaInsets();
  const [selectedGame, setSelectedGame] = useState<GameKey | null>(null);

  const handleExit = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/home');
    }
  }, []);

  const handleCloseGame = useCallback(() => {
    setSelectedGame(null);
  }, []);

  return (
    <View testID="games-screen" style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.topRow}>
        <View style={styles.badgePill}>
          <Ionicons name="sparkles" size={14} color={colors.primaryDark} />
          <Text style={styles.badgeText} allowFontScaling={false}>
            סוד המטבח
          </Text>
        </View>
        <Button label="סגור" variant="ghost" size="sm" onPress={handleExit} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom, spacing.xl) + spacing.lg },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>פינת המשחקים</Text>
          <Text style={styles.heroSubtitle}>מצאת את האיסטר אג. הנה הפסקה קטנה.</Text>
        </View>

        <View testID="games-grid" style={styles.grid}>
          {GAMES_CATALOG.map((game) => {
            const isLandscape = game.preferredOrientation === 'landscape';
            const orientationHint = getOrientationHintHebrew(game.preferredOrientation);

            return (
              <PressableScale
                key={game.key}
                testID={`game-tile-${game.key}`}
                variant="card"
                onPress={() => setSelectedGame(game.key)}
                accessibilityRole="button"
                accessibilityLabel={`${game.name} — ${game.description}`}
                style={[styles.tile, shadows.level1]}
              >
                <View style={styles.tileIconWrap}>
                  <Text style={styles.tileIcon} allowFontScaling={false}>
                    {game.icon}
                  </Text>
                </View>

                <Text style={styles.tileName} numberOfLines={1}>
                  {game.name}
                </Text>

                <Text style={styles.tileDesc} numberOfLines={2}>
                  {game.description}
                </Text>

                <View
                  style={[styles.orientationChip, isLandscape && styles.orientationChipLandscape]}
                >
                  <Ionicons
                    name={isLandscape ? 'phone-landscape-outline' : 'phone-portrait-outline'}
                    size={12}
                    color={isLandscape ? colors.primaryDark : colors.ink3}
                  />
                  <Text
                    style={[
                      styles.orientationChipText,
                      isLandscape && styles.orientationChipTextLandscape,
                    ]}
                    allowFontScaling={false}
                  >
                    {orientationHint}
                  </Text>
                </View>
              </PressableScale>
            );
          })}
        </View>
      </ScrollView>

      <GameHostModal
        visible={selectedGame !== null}
        gameKey={selectedGame}
        mode="arcade"
        closeLabel="חזרה למשחקים"
        onClose={handleCloseGame}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface0,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 5,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: statusColors.approvedBg,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  badgeText: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
    includeFontPadding: false,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.xl,
  },
  hero: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  heroTitle: {
    fontSize: typeScale.step4,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    textAlign: 'center',
    includeFontPadding: false,
  },
  heroSubtitle: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.md,
  },
  tile: {
    width: '48%',
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    gap: spacing.sm,
  },
  tileIconWrap: {
    width: 58,
    height: 58,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileIcon: {
    fontSize: 32,
    includeFontPadding: false,
  },
  tileName: {
    fontSize: typeScale.step1,
    fontFamily: fontFamilies.bodyBold,
    color: colors.ink,
    textAlign: 'center',
    includeFontPadding: false,
  },
  tileDesc: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    textAlign: 'center',
    lineHeight: 18,
    minHeight: 36,
  },
  orientationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
  },
  orientationChipLandscape: {
    backgroundColor: statusColors.approvedBg,
  },
  orientationChipText: {
    fontSize: 11,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink3,
    includeFontPadding: false,
  },
  orientationChipTextLandscape: {
    fontFamily: fontFamilies.bodyBold,
    color: colors.primaryDark,
  },
});
