import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radii, spacing, statusColors, typeScale } from '@/theme';
import { Button } from '@/components/ui';
import { AuthService } from '@/services/auth/auth-service';

interface SignupFormProps {
  onSuccess: () => void;
}

function getPasswordStrength(pw: string): { level: number; label: string } {
  if (!pw) return { level: 0, label: '' };
  let score = 0;
  if (pw.length >= 6) score += 1;
  if (pw.length >= 10) score += 1;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score += 1;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score += 1;
  if (score <= 1) return { level: 1, label: 'חלשה' };
  if (score === 2) return { level: 2, label: 'בינונית' };
  if (score === 3) return { level: 3, label: 'חזקה' };
  return { level: 4, label: 'מצוינת' };
}

export function SignupForm({ onSuccess }: SignupFormProps) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const strength = useMemo(() => getPasswordStrength(password), [password]);

  const handleSignup = async () => {
    setError('');
    if (!fullName.trim()) {
      setError('יש להזין שם מלא.');
      return;
    }
    if (!email.trim()) {
      setError('יש להזין כתובת אימייל.');
      return;
    }
    if (password.length < 6) {
      setError('הסיסמה חייבת להכיל לפחות 6 תווים.');
      return;
    }
    if (password !== confirmPassword) {
      setError('הסיסמאות אינן תואמות.');
      return;
    }

    setLoading(true);
    try {
      await AuthService.signUpWithEmail({ fullName, email, password });
      onSuccess();
    } catch (err: any) {
      setError(err?.message || 'ההרשמה נכשלה.');
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
      setError(err?.message || 'ההרשמה עם Google נכשלה.');
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
        <Text style={styles.label}>שם מלא</Text>
        <TextInput
          testID="auth-fullname-input"
          value={fullName}
          onChangeText={setFullName}
          placeholder="ישראל ישראלי"
          placeholderTextColor={colors.ink4}
          style={styles.input}
        />
      </View>

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
            placeholder="לפחות 6 תווים"
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
        {strength.level > 0 ? (
          <View style={styles.strengthRow}>
            <View style={styles.strengthBars}>
              {[1, 2, 3, 4].map((idx) => (
                <View
                  key={idx}
                  style={[
                    styles.strengthBar,
                    idx <= strength.level &&
                      (strength.level <= 1
                        ? styles.barWeak
                        : strength.level === 2
                          ? styles.barMedium
                          : styles.barStrong),
                  ]}
                />
              ))}
            </View>
            <Text style={styles.strengthLabel}>{strength.label}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>אימות סיסמה</Text>
        <TextInput
          testID="auth-password-confirm-input"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          placeholder="הזן סיסמה שוב"
          placeholderTextColor={colors.ink4}
          style={styles.input}
        />
      </View>

      <Button
        label="הרשמה"
        onPress={handleSignup}
        loading={loading}
        fullWidth
        testID="auth-submit-btn"
      />

      <Button
        label="הרשמה עם Google"
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
  strengthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 2,
  },
  strengthBars: {
    flex: 1,
    flexDirection: 'row',
    gap: 4,
  },
  strengthBar: {
    flex: 1,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.hairline,
  },
  barWeak: {
    backgroundColor: colors.secondary,
  },
  barMedium: {
    backgroundColor: colors.caution,
  },
  barStrong: {
    backgroundColor: colors.primary,
  },
  strengthLabel: {
    fontSize: 12,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink3,
  },
});
