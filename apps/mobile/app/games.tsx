import React from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { Button, EmptyState, ScreenHeader } from '@/components/ui';

export default function GamesScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View testID="games-screen" style={[styles.screen, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="פינת המשחקים"
        rightAction={
          <Button label="סגור" variant="ghost" size="sm" onPress={() => router.back()} />
        }
      />
      <EmptyState
        icon="game-controller-outline"
        title="פינת המשחקים"
        subtitle="8 משחקוני המטבח ייטענו כאן."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
});
