import React from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { Button, EmptyState, ScreenHeader } from '@/components/ui';

export default function RecipeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  return (
    <View testID="recipe-detail-screen" style={[styles.screen, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="מתכון"
        subtitle={id ? `מזהה: ${id}` : undefined}
        rightAction={
          <Button label="חזרה" variant="ghost" size="sm" onPress={() => router.back()} />
        }
      />
      <EmptyState icon="book-outline" title="פרטי מתכון" subtitle="פרטי המתכון יוטמעו בשלב הבא." />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
});
