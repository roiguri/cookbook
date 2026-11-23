import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '@/theme';
import { Button, Chip, ConfirmDialog, ScreenHeader } from '@/components/ui';
import { useSession } from '@/context/SessionContext';
import { LoginForm } from '@/components/auth/LoginForm';
import { SignupForm } from '@/components/auth/SignupForm';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';
import { UserProfileSheet } from '@/components/auth/UserProfileSheet';

export default function AuthModalScreen() {
  const insets = useSafeAreaInsets();
  const { isAuthenticated } = useSession();
  const [authView, setAuthView] = useState<'login' | 'signup' | 'forgot'>('login');
  const [avatarDirty, setAvatarDirty] = useState(false);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  const handleClose = () => {
    if (isAuthenticated && avatarDirty) {
      setConfirmCloseOpen(true);
      return;
    }
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/home');
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      testID="auth-modal"
      style={[styles.screen, { paddingTop: insets.top }]}
    >
      <ScreenHeader
        title={isAuthenticated ? 'הפרופיל שלי' : authView === 'signup' ? 'הרשמה' : 'התחברות'}
        rightAction={
          <Button
            label="סגור"
            variant="ghost"
            size="sm"
            onPress={handleClose}
            testID="auth-close-btn"
          />
        }
      />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 24) }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {isAuthenticated ? (
          <UserProfileSheet
            onRequestClose={() => {
              setAvatarDirty(false);
              if (router.canGoBack()) router.back();
              else router.replace('/(tabs)/home');
            }}
            onAvatarDirtyChange={setAvatarDirty}
          />
        ) : (
          <View style={styles.authCard}>
            {authView !== 'forgot' ? (
              <View style={styles.tabsRow}>
                <Chip
                  testID="auth-tab-login"
                  label="התחברות"
                  selected={authView === 'login'}
                  onPress={() => setAuthView('login')}
                />
                <Chip
                  testID="auth-tab-signup"
                  label="הרשמה"
                  selected={authView === 'signup'}
                  onPress={() => setAuthView('signup')}
                />
              </View>
            ) : null}

            {authView === 'login' ? (
              <LoginForm onSuccess={handleClose} onForgotPress={() => setAuthView('forgot')} />
            ) : null}

            {authView === 'signup' ? <SignupForm onSuccess={handleClose} /> : null}

            {authView === 'forgot' ? (
              <ForgotPasswordForm onBack={() => setAuthView('login')} />
            ) : null}
          </View>
        )}
      </ScrollView>

      <ConfirmDialog
        visible={confirmCloseOpen}
        title="לסגור בלי לשמור?"
        message="יש שינויים שלא נשמרו באווטאר."
        confirmLabel="סגור בלי לשמור"
        cancelLabel="הישאר"
        destructive
        onCancel={() => setConfirmCloseOpen(false)}
        onConfirm={() => {
          setConfirmCloseOpen(false);
          setAvatarDirty(false);
          if (router.canGoBack()) router.back();
          else router.replace('/(tabs)/home');
        }}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface0,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  authCard: {
    gap: spacing.lg,
  },
  tabsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
});
