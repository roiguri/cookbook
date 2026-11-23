import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { colors } from '@/theme';
import { EmptyState, ScreenHeader } from '@/components/ui';
import { useSession } from '@/context/SessionContext';

export default function MyMealScreen() {
  const { isAuthenticated, loading } = useSession();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.replace('/(tabs)/home');
    }
  }, [loading, isAuthenticated]);

  if (!isAuthenticated) return <View style={styles.screen} />;

  return (
    <View testID="my-meal-screen" style={styles.screen}>
      <ScreenHeader title="הארוחה שלי" subtitle="מתכונים בארוחה ורשימת מצרכים" />
      <EmptyState
        icon="restaurant-outline"
        title="אין ארוחה פעילה"
        subtitle="הוסף מתכונים לארוחה שלך."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
});
