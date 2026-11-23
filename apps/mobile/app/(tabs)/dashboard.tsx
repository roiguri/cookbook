import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { colors } from '@/theme';
import { EmptyState, ScreenHeader } from '@/components/ui';
import { useSession } from '@/context/SessionContext';

export default function DashboardScreen() {
  const { isManager, loading } = useSession();

  useEffect(() => {
    if (!loading && !isManager) {
      router.replace('/(tabs)/home');
    }
  }, [loading, isManager]);

  if (!isManager) return <View style={styles.screen} />;

  return (
    <View testID="dashboard-screen" style={styles.screen}>
      <ScreenHeader title="ממשק ניהול" />
      <EmptyState
        icon="shield-checkmark-outline"
        title="לוח הבקרה למנהלים"
        subtitle="בקשות אישור, משתמשים והתראות."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
});
