import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { colors } from '@/theme';
import { EmptyState, ScreenHeader } from '@/components/ui';
import { useSession } from '@/context/SessionContext';

export default function MyRecipesScreen() {
  const { isAuthenticated, loading } = useSession();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.replace('/(tabs)/home');
    }
  }, [loading, isAuthenticated]);

  if (!isAuthenticated) return <View style={styles.screen} />;

  return (
    <View testID="my-recipes-screen" style={styles.screen}>
      <ScreenHeader title="הספרייה שלי" subtitle="המתכונים שלי, מועדפים ושיתופים" />
      <EmptyState
        icon="bookmarks-outline"
        title="הספרייה שלי"
        subtitle="המתכונים שלך יופיעו כאן."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
});
