import React from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { colors } from '@/theme';
import { EmptyState, ScreenHeader } from '@/components/ui';
import { useSession } from '@/context/SessionContext';

export default function ProposeRecipeScreen() {
  const { isAuthenticated, isApproved } = useSession();

  return (
    <View testID="propose-recipe-screen" style={styles.screen}>
      <ScreenHeader title={isApproved ? 'מתכון חדש' : 'הצעת מתכון'} />
      {!isAuthenticated ? (
        <EmptyState
          icon="log-in-outline"
          title="נדרשת התחברות"
          subtitle="כדי להציע או ליצור מתכון חדש יש להתחבר לחשבון שלך."
          actionLabel="התחברות"
          onAction={() => router.push('/auth')}
          actionTestID="propose-login-btn"
        />
      ) : (
        <EmptyState
          icon="add-circle-outline"
          title="יצירת מתכון"
          subtitle="טופס המתכון יהיה זמין בקרוב."
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
});
