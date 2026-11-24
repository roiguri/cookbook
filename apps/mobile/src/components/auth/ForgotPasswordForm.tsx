import React, { useState } from 'react';
import { Keyboard, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, fontFamilies, radii, spacing, statusColors, typeScale } from '@/theme';
import { Button } from '@/components/ui';
import { AuthService } from '@/services/auth/auth-service';

interface ForgotPasswordFormProps {
  onBack: () => void;
}

export function ForgotPasswordForm({ onBack }: ForgotPasswordFormProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sentMessage, setSentMessage] = useState('');

  const handleSubmit = async () => {
    setError('');
    setSentMessage('');
    if (!email.trim()) {
      setError('יש להזין כתובת אימייל.');
      return;
    }
    setLoading(true);
    try {
      const msg = await AuthService.sendPasswordReset(email);
      setSentMessage(msg);
    } catch (err: any) {
      setError(err?.message || 'שליחת הקישור נכשלה.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.form}>
      <Text style={styles.heading}>איפוס סיסמה</Text>
      <Text style={styles.hint}>הזן את כתובת האימייל שלך ונשלח אליך קישור לאיפוס הסיסמה.</Text>

      {error ? (
        <View style={styles.errorBox}>
          <Text testID="auth-error-msg" style={styles.errorText}>
            {error}
          </Text>
        </View>
      ) : null}

      {sentMessage ? (
        <View style={styles.successBox}>
          <Text testID="auth-forgot-success-msg" style={styles.successText}>
            {sentMessage}
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
          returnKeyType="done"
          onSubmitEditing={() => Keyboard.dismiss()}
          placeholder="name@example.com"
          placeholderTextColor={colors.ink4}
          style={styles.input}
        />
      </View>

      <Button
        label="שלח קישור לאיפוס"
        onPress={handleSubmit}
        loading={loading}
        fullWidth
        testID="auth-forgot-submit-btn"
      />
      <Button label="חזרה להתחברות" variant="ghost" onPress={onBack} fullWidth />
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: spacing.md,
  },
  heading: {
    fontSize: typeScale.step2,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    textAlign: 'left',
  },
  hint: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.body,
    color: colors.ink2,
    lineHeight: 20,
    textAlign: 'left',
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
  successBox: {
    backgroundColor: statusColors.approvedBg,
    borderRadius: radii.sm,
    padding: spacing.md,
  },
  successText: {
    color: statusColors.approvedText,
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
});
