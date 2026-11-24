import Constants from 'expo-constants';
import {
  GoogleSignin,
  isCancelledResponse,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
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

let googleSignInConfigured = false;

function getGoogleAuthExtra(): { webClientId?: string; iosClientId?: string } {
  const extra = (Constants.expoConfig?.extra || {}) as Record<string, any>;
  return (extra.googleAuth || {}) as { webClientId?: string; iosClientId?: string };
}

function ensureGoogleSignInConfigured(): { webClientId?: string; iosClientId?: string } {
  const { webClientId, iosClientId } = getGoogleAuthExtra();
  if (!googleSignInConfigured) {
    GoogleSignin.configure({
      ...(webClientId ? { webClientId } : {}),
      ...(iosClientId ? { iosClientId } : {}),
    });
    googleSignInConfigured = true;
  }
  return { webClientId, iosClientId };
}

function isGoogleCancelError(error: any): boolean {
  if (!error) return false;
  if (error?.code === 'SIGN_IN_CANCELLED' || error?.code === 'ERR_REQUEST_CANCELED') {
    return true;
  }
  if (isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED) {
    return true;
  }
  return false;
}

async function acquireNativeGoogleTokens(): Promise<{
  idToken: string | null;
  accessToken: string | null;
} | null> {
  const { webClientId } = ensureGoogleSignInConfigured();
  if (!webClientId) {
    throw new Error('הגדרות Google Sign-In חסרות בגרסה זו.');
  }
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const response = await GoogleSignin.signIn();
  if (isCancelledResponse(response) || !isSuccessResponse(response)) {
    return null;
  }
  let idToken = response.data.idToken || null;
  let accessToken: string | null = null;
  if (!idToken) {
    const tokens = await GoogleSignin.getTokens().catch(() => null);
    idToken = tokens?.idToken || null;
    accessToken = tokens?.accessToken || null;
  }
  if (!idToken && !accessToken) {
    throw new Error('לא התקבל אסימון אימות מ-Google. נסה שוב.');
  }
  return { idToken, accessToken };
}

async function signOutGoogleIfNeeded(): Promise<void> {
  if (IS_DTU_MODE) return;
  try {
    const { webClientId, iosClientId } = getGoogleAuthExtra();
    if (!webClientId && !iosClientId) return;
    ensureGoogleSignInConfigured();
    await GoogleSignin.signOut();
  } catch {
    // Best-effort cleanup so Google account chooser re-appears on next sign-in
  }
}

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
  if (isErrorWithCode(error)) {
    if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      return 'שירותי Google Play אינם זמינים במכשיר זה.';
    }
    if (error.code === statusCodes.IN_PROGRESS) {
      return 'התחברות עם Google כבר מתבצעת.';
    }
  }
  if (rawCode === 'auth/internal-error' && rawMessage.includes('INVALID_LOGIN_CREDENTIALS')) {
    return HEBREW_AUTH_ERRORS['auth/invalid-credential'];
  }
  if (HEBREW_AUTH_ERRORS[rawCode]) {
    return HEBREW_AUTH_ERRORS[rawCode];
  }
  if (!rawCode && /[\u0590-\u05FF]/.test(rawMessage)) {
    return rawMessage;
  }
  return 'אירעה שגיאה בהתחברות. נסה שוב.';
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

      let idToken = googleTokens?.idToken || null;
      let accessToken = googleTokens?.accessToken || null;
      if (!idToken && !accessToken) {
        const nativeTokens = await acquireNativeGoogleTokens();
        if (!nativeTokens) {
          return null;
        }
        idToken = nativeTokens.idToken;
        accessToken = nativeTokens.accessToken;
      }

      const cred = await signInWithGoogleTokens(idToken, accessToken);
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
      if (isGoogleCancelError(err)) {
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
    if (IS_DTU_MODE && !googleTokens?.idToken && !googleTokens?.accessToken) {
      return false;
    }
    try {
      let idToken = googleTokens?.idToken || null;
      let accessToken = googleTokens?.accessToken || null;
      if (!idToken && !accessToken) {
        const nativeTokens = await acquireNativeGoogleTokens();
        if (!nativeTokens) {
          return false;
        }
        idToken = nativeTokens.idToken;
        accessToken = nativeTokens.accessToken;
      }
      await linkGoogleTokens(current, idToken, accessToken);
      return true;
    } catch (err: any) {
      if (isGoogleCancelError(err)) {
        return false;
      }
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
    await Promise.allSettled([signOutAuth(), signOutGoogleIfNeeded()]);
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

      // Clean up Storage & Firestore artifacts in parallel before removing Auth
      // credentials (while request.auth.uid == uid still satisfies rules).
      await Promise.allSettled([
        executeGlobalBeforeSignOutHooks(uid),
        UserService.deleteAvatar(uid),
        UserService.deleteAllDevices(uid),
        UserService.deleteActiveMeal(uid),
      ]);
      await UserService.delete(uid);

      await deleteAuthUser(current);
      await signOutGoogleIfNeeded();
      setTelemetryUser(null, 'guest');
    } catch (err) {
      captureError(err, { service: 'auth', op: 'deleteAccount', uid });
      throw new Error(mapAuthErrorToHebrew(err));
    }
  },
};
