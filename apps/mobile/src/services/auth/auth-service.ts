import { IS_DTU_MODE } from '../_firebase/firebase-app';
import {
  changeAuthPassword,
  createEmailPasswordUser,
  deleteAuthUser,
  getCurrentAuthUser,
  linkGoogleTokens,
  reauthWithEmailPassword,
  resetPasswordByEmail,
  signInEmailPassword,
  signInWithGoogleTokens,
  signOutAuth,
  unlinkAuthProvider,
  updateAuthDisplayName,
} from '../_firebase/auth-adapter';
import { captureError, setTelemetryUser } from '../logger';
import { UserService } from '../users/user-service';
import {
  executeGlobalBeforeSignOutHooks,
  registerGlobalBeforeSignOutHook,
} from '@/context/SessionContext';

const HEBREW_AUTH_ERRORS: Record<string, string> = {
  'auth/invalid-email': 'כתובת האימייל אינה תקינה.',
  'auth/user-disabled': 'חשבון זה הושבת. פנה למנהל המערכת.',
  'auth/user-not-found': 'אימייל או סיסמה שגויים.',
  'auth/wrong-password': 'אימייל או סיסמה שגויים.',
  'auth/invalid-credential': 'אימייל או סיסמה שגויים.',
  'auth/invalid-login-credentials': 'אימייל או סיסמה שגויים.',
  'auth/email-already-in-use': 'כתובת אימייל זו כבר רשומה במערכת.',
  'auth/weak-password': 'הסיסמה חלשה מדי — יש לבחור סיסמה בת 6 תווים לפחות.',
  'auth/too-many-requests': 'יותר מדי ניסיונות כושלים. נסה שוב בעוד מספר דקות.',
  'auth/network-request-failed': 'אין חיבור לרשת. בדוק את החיבור ונסה שוב.',
  'auth/requires-recent-login': 'לצורך פעולה זו יש להתחבר מחדש לחשבון.',
  'auth/provider-already-linked': 'חשבון Google כבר מחובר למשתמש זה.',
  'auth/credential-already-in-use': 'חשבון Google זה כבר משויך למשתמש אחר.',
};

export function mapAuthErrorToHebrew(error: any): string {
  const rawCode = String(error?.code || '');
  const rawMessage = String(error?.message || '');
  if (rawCode === 'auth/internal-error' && rawMessage.includes('INVALID_LOGIN_CREDENTIALS')) {
    return HEBREW_AUTH_ERRORS['auth/invalid-credential'];
  }
  return HEBREW_AUTH_ERRORS[rawCode] || 'אירעה שגיאה בהתחברות. נסה שוב.';
}

export const AuthService = {
  registerBeforeSignOutHook: registerGlobalBeforeSignOutHook,

  async signInWithEmail(email: string, password: string) {
    try {
      const cred = await signInEmailPassword(email.trim(), password);
      const profile = await UserService.get(cred.user.uid).catch(() => null);
      setTelemetryUser(cred.user.uid, profile?.role || 'user');
      return {
        user: cred.user,
        profile: profile || { id: cred.user.uid, role: 'user', favorites: [] },
      };
    } catch (err) {
      captureError(err, { service: 'auth', op: 'signInWithEmail' });
      throw new Error(mapAuthErrorToHebrew(err));
    }
  },

  /**
   * INV-P0-02: Always creates users/{uid} with hardcoded role: 'user'.
   */
  async signUpWithEmail({
    fullName,
    email,
    password,
  }: {
    fullName: string;
    email: string;
    password: string;
  }) {
    try {
      const trimmedName = fullName.trim();
      const trimmedEmail = email.trim().toLowerCase();
      const cred = await createEmailPasswordUser(trimmedEmail, password);
      await updateAuthDisplayName(cred.user, trimmedName).catch(() => {});
      await UserService.create(cred.user.uid, {
        fullName: trimmedName,
        email: trimmedEmail,
      });
      setTelemetryUser(cred.user.uid, 'user');
      return cred.user;
    } catch (err) {
      captureError(err, { service: 'auth', op: 'signUpWithEmail' });
      throw new Error(mapAuthErrorToHebrew(err));
    }
  },

  /**
   * Native Google Sign-In (deterministic DTU Emulator flow in e2e mode;
   * cleanly swallows SIGN_IN_CANCELLED without emitting Sentry noise).
   */
  async signInWithGoogle(googleTokens?: { idToken?: string | null; accessToken?: string | null }) {
    try {
      if (IS_DTU_MODE && !googleTokens?.idToken) {
        // Deterministic Auth Emulator Google test sign-in (creates user with role 'user')
        const dtuGoogleEmail = 'google-dtu-user@cookbook.test';
        const dtuGooglePass = 'DtuGoogle123!';
        let cred;
        try {
          cred = await signInEmailPassword(dtuGoogleEmail, dtuGooglePass);
        } catch {
          cred = await createEmailPasswordUser(dtuGoogleEmail, dtuGooglePass);
          await updateAuthDisplayName(cred.user, 'משתמש Google');
        }
        const existing = await UserService.get(cred.user.uid);
        if (!existing) {
          await UserService.create(cred.user.uid, {
            fullName: cred.user.displayName || 'משתמש Google',
            email: dtuGoogleEmail,
          });
        }
        setTelemetryUser(cred.user.uid, existing?.role || 'user');
        return cred.user;
      }

      if (!googleTokens?.idToken && !googleTokens?.accessToken) {
        const cancelErr: any = new Error('Google Sign-In cancelled');
        cancelErr.code = 'SIGN_IN_CANCELLED';
        throw cancelErr;
      }

      const cred = await signInWithGoogleTokens(googleTokens.idToken, googleTokens.accessToken);
      const existing = await UserService.get(cred.user.uid);
      if (!existing) {
        await UserService.create(cred.user.uid, {
          fullName: cred.user.displayName || 'משתמש חדש',
          email: cred.user.email || '',
          avatarUrl: cred.user.photoURL || null,
        });
      }
      setTelemetryUser(cred.user.uid, existing?.role || 'user');
      return cred.user;
    } catch (err: any) {
      if (err?.code === 'SIGN_IN_CANCELLED' || err?.code === 'ERR_REQUEST_CANCELED') {
        return null;
      }
      captureError(err, { service: 'auth', op: 'signInWithGoogle' });
      throw new Error(mapAuthErrorToHebrew(err));
    }
  },

  async sendPasswordReset(email: string): Promise<string> {
    try {
      await resetPasswordByEmail(email.trim());
      return 'הקישור נשלח — בדוק את תיבת הדואר שלך.';
    } catch (err) {
      captureError(err, { service: 'auth', op: 'sendPasswordReset' });
      throw new Error(mapAuthErrorToHebrew(err));
    }
  },

  async updateProfile({
    fullName,
    bio,
    avatarUrl,
    avatarConfig,
  }: {
    fullName?: string;
    bio?: string;
    avatarUrl?: string | null;
    avatarConfig?: Record<string, any> | null;
  }) {
    const current = getCurrentAuthUser();
    if (!current) throw new Error('נדרשת התחברות כדי לעדכן פרופיל.');

    const updates: Record<string, any> = {};
    if (fullName !== undefined) {
      updates.fullName = fullName.trim();
      await updateAuthDisplayName(current, updates.fullName).catch(() => {});
    }
    if (bio !== undefined) {
      updates.bio = bio.trim().slice(0, 160);
    }
    if (avatarUrl !== undefined) {
      updates.avatarUrl = avatarUrl;
    }
    if (avatarConfig !== undefined) {
      updates.avatarConfig = avatarConfig;
    }

    await UserService.update(current.uid, updates);
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const current = getCurrentAuthUser();
    if (!current || !current.email) {
      throw new Error('לא ניתן לשנות סיסמה עבור חשבון זה.');
    }
    try {
      await reauthWithEmailPassword(current, current.email, currentPassword);
      await changeAuthPassword(current, newPassword);
    } catch (err) {
      captureError(err, { service: 'auth', op: 'changePassword', uid: current.uid });
      throw new Error(mapAuthErrorToHebrew(err));
    }
  },

  async linkWithGoogle(googleTokens?: { idToken?: string | null; accessToken?: string | null }) {
    const current = getCurrentAuthUser();
    if (!current) throw new Error('נדרשת התחברות.');
    if (!googleTokens?.idToken && !googleTokens?.accessToken) {
      return false;
    }
    try {
      await linkGoogleTokens(current, googleTokens.idToken, googleTokens.accessToken);
      return true;
    } catch (err) {
      captureError(err, { service: 'auth', op: 'linkWithGoogle', uid: current.uid });
      throw new Error(mapAuthErrorToHebrew(err));
    }
  },

  async unlinkGoogle(): Promise<void> {
    const current = getCurrentAuthUser();
    if (!current) throw new Error('נדרשת התחברות.');
    const providers = (current.providerData || []).map((p) => p.providerId);
    if (providers.length <= 1 && providers.includes('google.com')) {
      throw new Error('לא ניתן לנתק — אין שיטת כניסה נוספת');
    }
    try {
      await unlinkAuthProvider(current, 'google.com');
    } catch (err) {
      captureError(err, { service: 'auth', op: 'unlinkGoogle', uid: current.uid });
      throw new Error(mapAuthErrorToHebrew(err));
    }
  },

  async signOut(): Promise<void> {
    const current = getCurrentAuthUser();
    if (current?.uid) {
      await executeGlobalBeforeSignOutHooks(current.uid);
    }
    await signOutAuth();
    setTelemetryUser(null, 'guest');
  },

  /**
   * Safe account deletion: verifies recent auth before mutating Firestore, then
   * cleans up user-avatars/{uid}.png, device docs, active_meals/{uid}, users/{uid},
   * and finally deletes the Firebase Auth user.
   */
  async deleteAccount(currentPassword?: string): Promise<void> {
    const current = getCurrentAuthUser();
    if (!current) throw new Error('אין משתמש מחובר.');
    const uid = current.uid;

    try {
      if (currentPassword && current.email) {
        await reauthWithEmailPassword(current, current.email, currentPassword);
      }

      // Clean up Storage & Firestore artifacts before removing Auth credentials
      // (while request.auth.uid == uid still satisfies Firestore/Storage rules).
      await executeGlobalBeforeSignOutHooks(uid);
      await UserService.deleteAvatar(uid);
      await UserService.deleteAllDevices(uid);
      await UserService.deleteActiveMeal(uid);
      await UserService.delete(uid);

      await deleteAuthUser(current);
      setTelemetryUser(null, 'guest');
    } catch (err) {
      captureError(err, { service: 'auth', op: 'deleteAccount', uid });
      throw new Error(mapAuthErrorToHebrew(err));
    }
  },
};
