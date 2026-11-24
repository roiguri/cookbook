import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { router, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '@/theme';
import { Button, Chip, ScreenHeader } from '@/components/ui';
import { useSession } from '@/context/SessionContext';
import { LoginForm } from '@/components/auth/LoginForm';
import { SignupForm } from '@/components/auth/SignupForm';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';
import { UserProfileSheet } from '@/components/auth/UserProfileSheet';
import { AvatarUnsavedDialog } from '@/components/auth/avatar-builder/AvatarUnsavedDialog';

export default function AuthModalScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { isAuthenticated } = useSession();
  const [authView, setAuthView] = useState<'login' | 'signup' | 'forgot'>('login');
  const [avatarDirty, setAvatarDirty] = useState(false);
  const avatarDirtyRef = useRef(false);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const handleAvatarDirtyChange = useCallback((dirty: boolean) => {
    avatarDirtyRef.current = dirty;
    setAvatarDirty(dirty);
  }, []);

  const closeModalImmediately = useCallback(() => {
    avatarDirtyRef.current = false;
    setAvatarDirty(false);
    setConfirmCloseOpen(false);
    setIsClosing(true);
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/home');
    }
  }, []);

  const handleClose = useCallback(() => {
    if (isAuthenticated && (avatarDirty || avatarDirtyRef.current)) {
      setConfirmCloseOpen(true);
      return;
    }
    closeModalImmediately();
  }, [isAuthenticated, avatarDirty, closeModalImmediately]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isAuthenticated && avatarDirtyRef.current) {
        setConfirmCloseOpen(true);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [isAuthenticated]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      if (!isAuthenticated || !avatarDirtyRef.current) return;
      e.preventDefault();
      setConfirmCloseOpen(true);
    });
    return unsubscribe;
  }, [navigation, isAuthenticated]);

  if (isClosing) {
    return null;
  }

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
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {isAuthenticated ? (
          <UserProfileSheet
            onRequestClose={closeModalImmediately}
            onAvatarDirtyChange={handleAvatarDirtyChange}
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

      <AvatarUnsavedDialog
        visible={confirmCloseOpen}
        onKeepEditing={() => setConfirmCloseOpen(false)}
        onDiscard={closeModalImmediately}
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
