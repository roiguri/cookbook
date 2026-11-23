import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { colors, fontFamilies, radii, spacing, statusColors, typeScale } from '@/theme';
import { Badge, Button, Card, Chip, ConfirmDialog, EmptyState, useToast } from '@/components/ui';
import { useSession } from '@/context/SessionContext';
import { AuthService } from '@/services/auth/auth-service';

export type AvatarTabRenderer = (props: {
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
}) => React.ReactNode;

let registeredAvatarTabRenderer: AvatarTabRenderer | null = null;

export function registerAvatarTabRenderer(renderer: AvatarTabRenderer) {
  registeredAvatarTabRenderer = renderer;
}

const ROLE_LABELS: Record<string, string> = {
  manager: 'מנהל',
  approved: 'מאושר',
  user: 'משתמש',
  guest: 'אורח',
};

interface UserProfileSheetProps {
  onRequestClose: () => void;
  onAvatarDirtyChange?: (dirty: boolean) => void;
}

export function UserProfileSheet({ onRequestClose, onAvatarDirtyChange }: UserProfileSheetProps) {
  const { user, profile, role, refreshProfile } = useSession();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'info' | 'avatar' | 'security'>('info');
  const [fullName, setFullName] = useState(profile?.fullName || user?.displayName || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [saving, setSaving] = useState(false);
  const [savedTag, setSavedTag] = useState(false);

  // Security tab state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [securityLoading, setSecurityLoading] = useState(false);
  const [securityMsg, setSecurityMsg] = useState('');
  const [securityErr, setSecurityErr] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Avatar unsaved guard
  const [avatarDirty, setAvatarDirty] = useState(false);
  const [discardTarget, setDiscardTarget] = useState<(() => void) | null>(null);

  useEffect(() => {
    setFullName(profile?.fullName || user?.displayName || '');
    setBio(profile?.bio || '');
  }, [profile?.fullName, profile?.bio, user?.displayName]);

  const handleDirty = (dirty: boolean) => {
    setAvatarDirty(dirty);
    onAvatarDirtyChange?.(dirty);
  };

  const guardAvatarDirty = (action: () => void) => {
    if (activeTab === 'avatar' && avatarDirty) {
      setDiscardTarget(() => action);
    } else {
      action();
    }
  };

  const providers = user?.providerIds || [];
  const hasPasswordProvider = providers.includes('password');
  const hasGoogleProvider = providers.includes('google.com');

  const handleSaveProfile = async () => {
    setSaving(true);
    setSavedTag(false);
    try {
      await AuthService.updateProfile({ fullName, bio });
      await refreshProfile();
      setSavedTag(true);
      showToast('✓ נשמר', 'success');
    } catch (err: any) {
      showToast(err?.message || 'שמירת הפרופיל נכשלה', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setSecurityErr('');
    setSecurityMsg('');
    if (!currentPassword || newPassword.length < 6) {
      setSecurityErr('יש להזין סיסמה נוכחית וסיסמה חדשה בת 6 תווים לפחות.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setSecurityErr('הסיסמאות החדשות אינן תואמות.');
      return;
    }
    setSecurityLoading(true);
    try {
      await AuthService.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setSecurityMsg('הסיסמה עודכנה בהצלחה.');
      showToast('הסיסמה עודכנה בהצלחה', 'success');
    } catch (err: any) {
      setSecurityErr(err?.message || 'שינוי הסיסמה נכשל.');
    } finally {
      setSecurityLoading(false);
    }
  };

  const handleToggleGoogle = async () => {
    setSecurityErr('');
    setSecurityMsg('');
    setSecurityLoading(true);
    try {
      if (hasGoogleProvider) {
        await AuthService.unlinkGoogle();
        setSecurityMsg('חשבון Google נותק בהצלחה.');
      } else {
        await AuthService.linkWithGoogle();
        setSecurityMsg('חיבור Google זמין בגרסת Staging.');
      }
    } catch (err: any) {
      setSecurityErr(err?.message || 'פעולת Google נכשלה.');
    } finally {
      setSecurityLoading(false);
    }
  };

  const handleSignOut = async () => {
    await AuthService.signOut();
    showToast('התנתקת בהצלחה', 'info');
    onRequestClose();
    router.replace('/(tabs)/home');
  };

  const handleConfirmDeleteAccount = async () => {
    setDeleting(true);
    setSecurityErr('');
    try {
      await AuthService.deleteAccount(deletePassword || undefined);
      setDeleteDialogOpen(false);
      showToast('החשבון נמחק בהצלחה', 'info');
      onRequestClose();
      router.replace('/(tabs)/home');
    } catch (err: any) {
      setSecurityErr(err?.message || 'מחיקת החשבון נכשלה.');
      setDeleteDialogOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <View style={styles.wrap}>
      {/* Profile header summary */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryText}>
          <Text style={styles.name}>{profile?.fullName || user?.displayName || 'משתמש'}</Text>
          <Text style={styles.email}>{user?.email || profile?.email || ''}</Text>
        </View>
        <Badge
          testID="profile-role-badge"
          label={ROLE_LABELS[role] || 'משתמש'}
          tone={role === 'manager' ? 'primary' : role === 'approved' ? 'success' : 'neutral'}
        />
      </View>

      {/* 3-Tab Profile Switcher (פרטים | אווטאר | אבטחה) */}
      <View style={styles.tabsRow}>
        <Chip
          testID="profile-tab-info"
          label="פרטים"
          selected={activeTab === 'info'}
          onPress={() => guardAvatarDirty(() => setActiveTab('info'))}
        />
        <Chip
          testID="profile-tab-avatar"
          label="אווטאר"
          selected={activeTab === 'avatar'}
          onPress={() => setActiveTab('avatar')}
        />
        <Chip
          testID="profile-tab-security"
          label="אבטחה"
          selected={activeTab === 'security'}
          onPress={() => guardAvatarDirty(() => setActiveTab('security'))}
        />
      </View>

      {activeTab === 'info' ? (
        <View style={styles.tabBody}>
          <View style={styles.field}>
            <Text style={styles.label}>שם תצוגה</Text>
            <TextInput
              testID="profile-fullname-input"
              value={fullName}
              onChangeText={setFullName}
              placeholder="שם מלא"
              placeholderTextColor={colors.ink4}
              style={styles.input}
            />
          </View>

          <View style={styles.field}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>קצת עליי</Text>
              <Text style={styles.counter}>{bio.length}/160</Text>
            </View>
            <TextInput
              testID="profile-bio-input"
              value={bio}
              onChangeText={(t) => setBio(t.slice(0, 160))}
              maxLength={160}
              multiline
              numberOfLines={3}
              placeholder="ספר בקצרה על הבישול שלך..."
              placeholderTextColor={colors.ink4}
              style={[styles.input, styles.bioInput]}
            />
          </View>

          {savedTag ? <Text style={styles.savedLabel}>✓ נשמר</Text> : null}

          <Button
            label="שמור שינויים"
            onPress={handleSaveProfile}
            loading={saving}
            fullWidth
            testID="profile-save-btn"
          />

          <Button
            label="התנתק"
            variant="secondary"
            onPress={handleSignOut}
            fullWidth
            testID="profile-signout-btn"
          />
        </View>
      ) : null}

      {activeTab === 'avatar' ? (
        <View style={styles.tabBody}>
          {registeredAvatarTabRenderer ? (
            registeredAvatarTabRenderer({
              onDirtyChange: handleDirty,
              onSaved: () => {
                handleDirty(false);
                void refreshProfile();
              },
            })
          ) : (
            <EmptyState
              icon="happy-outline"
              title="בונה אווטאר השף"
              subtitle="בונה האווטאר יהיה זמין לאחר טעינת מודול האווטאר."
            />
          )}
        </View>
      ) : null}

      {activeTab === 'security' ? (
        <View style={styles.tabBody}>
          {securityErr ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{securityErr}</Text>
            </View>
          ) : null}
          {securityMsg ? (
            <View style={styles.successBox}>
              <Text style={styles.successText}>{securityMsg}</Text>
            </View>
          ) : null}

          <Card style={styles.secCard} elevated={false}>
            <Text style={styles.secHeading}>שינוי סיסמה</Text>
            {hasPasswordProvider ? (
              <View style={styles.secFields}>
                <TextInput
                  testID="profile-current-password-input"
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  secureTextEntry
                  placeholder="סיסמה נוכחית"
                  placeholderTextColor={colors.ink4}
                  style={styles.input}
                />
                <TextInput
                  testID="profile-new-password-input"
                  value={newPassword}
                  onChangeText={setNewPassword}
                  secureTextEntry
                  placeholder="סיסמה חדשה"
                  placeholderTextColor={colors.ink4}
                  style={styles.input}
                />
                <TextInput
                  testID="profile-confirm-new-password-input"
                  value={confirmNewPassword}
                  onChangeText={setConfirmNewPassword}
                  secureTextEntry
                  placeholder="אימות סיסמה חדשה"
                  placeholderTextColor={colors.ink4}
                  style={styles.input}
                />
                <Button
                  label="עדכן סיסמה"
                  onPress={handleChangePassword}
                  loading={securityLoading}
                  testID="profile-change-password-btn"
                />
              </View>
            ) : (
              <Text style={styles.mutedNote}>
                החשבון שלך משתמש ב-Google Sign-In — אימות בסיסמה אינו מופעל.
              </Text>
            )}
          </Card>

          <Card style={styles.secCard} elevated={false}>
            <Text style={styles.secHeading}>חשבונות מחוברים</Text>
            <Button
              label={hasGoogleProvider ? 'נתק Google' : 'חבר Google'}
              variant="secondary"
              onPress={handleToggleGoogle}
              loading={securityLoading}
              testID="profile-google-link-btn"
            />
          </Card>

          <Card style={[styles.secCard, styles.dangerCard]} elevated={false}>
            <Text style={styles.dangerHeading}>אזור מסוכן</Text>
            <Text style={styles.mutedNote}>
              מחיקת החשבון תסיר את הפרופיל, האווטאר, הארוחה הפעילה והתראות המכשיר לצמיתות.
            </Text>
            <Button
              label="מחק חשבון"
              variant="danger"
              onPress={() => setDeleteDialogOpen(true)}
              testID="profile-delete-btn"
            />
          </Card>
        </View>
      ) : null}

      {/* Footer shortcut to My Meal */}
      <View style={styles.footerRow}>
        <Button
          label="הארוחה שלי"
          variant="outline"
          fullWidth
          onPress={() =>
            guardAvatarDirty(() => {
              onRequestClose();
              router.navigate('/(tabs)/my-meal');
            })
          }
          testID="profile-my-meal-btn"
        />
      </View>

      <ConfirmDialog
        visible={deleteDialogOpen}
        title="מחיקת חשבון"
        message="פעולה זו אינה ניתנת לביטול. האם למחוק את החשבון לצמיתות?"
        confirmLabel="מחק לצמיתות"
        destructive
        loading={deleting}
        onCancel={() => setDeleteDialogOpen(false)}
        onConfirm={handleConfirmDeleteAccount}
        confirmTestID="confirm-delete-account-btn"
      >
        {hasPasswordProvider ? (
          <TextInput
            value={deletePassword}
            onChangeText={setDeletePassword}
            secureTextEntry
            placeholder="סיסמה לאימות (אופציונלי אם התחברת כעת)"
            placeholderTextColor={colors.ink4}
            style={styles.input}
          />
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        visible={Boolean(discardTarget)}
        title="לסגור בלי לשמור?"
        message="יש שינויים שלא נשמרו באווטאר."
        confirmLabel="סגור בלי לשמור"
        cancelLabel="הישאר"
        destructive
        onCancel={() => setDiscardTarget(null)}
        onConfirm={() => {
          const fn = discardTarget;
          setDiscardTarget(null);
          handleDirty(false);
          fn?.();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.surface1,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  summaryText: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: typeScale.step1,
    fontFamily: fontFamilies.heading,
    color: colors.ink,
    textAlign: 'left',
  },
  email: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    textAlign: 'left',
  },
  tabsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tabBody: {
    gap: spacing.md,
  },
  field: {
    gap: 6,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink2,
    textAlign: 'left',
  },
  counter: {
    fontSize: 12,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
  },
  input: {
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.body,
    color: colors.ink,
    textAlign: 'right',
  },
  bioInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  savedLabel: {
    color: colors.primaryDark,
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyBold,
    textAlign: 'left',
  },
  secCard: {
    gap: spacing.sm,
    backgroundColor: colors.surface1,
  },
  dangerCard: {
    borderColor: colors.secondary,
  },
  secHeading: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyBold,
    color: colors.ink,
    textAlign: 'left',
  },
  dangerHeading: {
    fontSize: typeScale.step0,
    fontFamily: fontFamilies.bodyBold,
    color: colors.secondary,
    textAlign: 'left',
  },
  secFields: {
    gap: spacing.sm,
  },
  mutedNote: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
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
  footerRow: {
    marginTop: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
});
