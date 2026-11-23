import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '@/theme';
import { EmptyState, ScreenHeader } from '@/components/ui';

export default function CategoriesScreen() {
  return (
    <View testID="categories-screen" style={styles.screen}>
      <ScreenHeader title="כל המתכונים" subtitle="גלישה וחיפוש בכל הקטגוריות" />
      <EmptyState
        icon="grid-outline"
        title="קטגוריות ומתכונים"
        subtitle="מתכוני המשפחה יופיעו כאן."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
});
