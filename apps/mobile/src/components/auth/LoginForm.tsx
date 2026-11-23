import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radii, spacing, statusColors, typeScale } from '@/theme';
import { Button } from '@/components/ui';
import { AuthService } from '@/services/auth/auth-service';

interface LoginFormProps {
  onSuccess: () => void;
  onForgotPress: () => void;
}

export function LoginForm({ onSuccess, onForgotPress }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    setError('');
    if (!email.trim() || !password) {
      setError('יש להזין אימייל וסיסמה.');
      return;
    }
    setLoading(true);
    try {
      await AuthService.signInWithEmail(email, password);
      onSuccess();
    } catch (err: any) {
      setError(err?.message || 'ההתחברות נכשלה.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError('');
    setLoading(true);
    try {
      const user = await AuthService.signInWithGoogle();
      if (user) onSuccess();
    } catch (err: any) {
      setError(err?.message || 'ההתחברות עם Google נכשלה.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.form}>
      {error ? (
        <View style={styles.errorBox}>
          <Text testID="auth-error-msg" style={styles.errorText}>
            {error}
          </Text>
        </View>
      ) : null}

      <View style={styles.field}>
        <Text style={styles.label}>אימייל</Text>
        <TextInput
          testID="auth-email-input"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="name@example.com"
          placeholderTextColor={colors.ink4}
          style={styles.input}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>סיסמה</Text>
        <View style={styles.passwordWrap}>
          <TextInput
            testID="auth-password-input"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            placeholder="הזן סיסמה"
            placeholderTextColor={colors.ink4}
            style={styles.passwordInput}
          />
          <Pressable
            onPress={() => setShowPassword((v) => !v)}
            accessibilityLabel={showPassword ? 'הסתר סיסמה' : 'הצג סיסמה'}
            style={styles.eyeBtn}
          >
            <Ionicons
              name={showPassword ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={colors.ink3}
            />
          </Pressable>
        </View>
      </View>

      <Pressable testID="auth-forgot-link" onPress={onForgotPress} style={styles.forgotLink}>
        <Text style={styles.forgotText}>שכחת סיסמה?</Text>
      </Pressable>

      <Button
        label="התחבר"
        onPress={handleLogin}
        loading={loading}
        fullWidth
        testID="auth-submit-btn"
      />

      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>או</Text>
        <View style={styles.dividerLine} />
      </View>

      <Button
        label="המשך עם Google"
        variant="secondary"
        onPress={handleGoogle}
        disabled={loading}
        fullWidth
        testID="auth-google-btn"
        icon={<Ionicons name="logo-google" size={18} color={colors.ink} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: spacing.md,
  },
  errorBox: {
    backgroundColor: statusColors.rejectedBg,
    borderRadius: radii.sm,
    padding: spacing.md,
  },
  errorText: {
    color: statusColors.rejectedText,
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyMedium,
    textAlign: 'left',
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink2,
    textAlign: 'left',
  },
  input: {
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink,
    textAlign: 'right',
  },
  passwordWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    borderRadius: radii.md,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink,
    textAlign: 'right',
  },
  eyeBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  forgotLink: {
    alignSelf: 'flex-start',
  },
  forgotText: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.primaryDark,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.hairline,
  },
  dividerText: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
  },
});
