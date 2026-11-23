import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { colors } from '@/theme';
import { EmptyState, ScreenHeader } from '@/components/ui';
import { useSession } from '@/context/SessionContext';

export default function GrandmasCookingScreen() {
  const { isApproved, loading } = useSession();

  useEffect(() => {
    if (!loading && !isApproved) {
      router.replace('/(tabs)/home');
    }
  }, [loading, isApproved]);

  if (!isApproved) return <View style={styles.screen} />;

  return (
    <View testID="grandmas-cooking-screen" style={styles.screen}>
      <ScreenHeader title="המטעמים של סבתא" />
      <EmptyState
        icon="library-outline"
        title="ספר המתכונים של סבתא"
        subtitle="דפי הספר הסרוק של סבתא ייטענו כאן."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
});
