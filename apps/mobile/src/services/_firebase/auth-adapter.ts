import {
  EmailAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  deleteUser,
  linkWithCredential,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut,
  unlink,
  updatePassword,
  updateProfile,
  type User,
} from 'firebase/auth';
import { ensureFirebaseReady, getFirebaseAuth } from './firebase-app';

export type FirebaseAuthUser = User;

export function getCurrentAuthUser(): User | null {
  ensureFirebaseReady();
  return getFirebaseAuth().currentUser;
}

export function subscribeAuthState(callback: (user: User | null) => void): () => void {
  ensureFirebaseReady();
  return onAuthStateChanged(getFirebaseAuth(), callback);
}

export async function signInEmailPassword(email: string, password: string) {
  ensureFirebaseReady();
  return signInWithEmailAndPassword(getFirebaseAuth(), email, password);
}

export async function createEmailPasswordUser(email: string, password: string) {
  ensureFirebaseReady();
  return createUserWithEmailAndPassword(getFirebaseAuth(), email, password);
}

export async function signOutAuth() {
  ensureFirebaseReady();
  return signOut(getFirebaseAuth());
}

export async function resetPasswordByEmail(email: string) {
  ensureFirebaseReady();
  return sendPasswordResetEmail(getFirebaseAuth(), email);
}

export async function updateAuthDisplayName(user: User, displayName: string) {
  return updateProfile(user, { displayName });
}

export async function reauthWithEmailPassword(user: User, email: string, password: string) {
  const cred = EmailAuthProvider.credential(email, password);
  return reauthenticateWithCredential(user, cred);
}

export async function changeAuthPassword(user: User, newPassword: string) {
  return updatePassword(user, newPassword);
}

export async function signInWithGoogleTokens(idToken?: string | null, accessToken?: string | null) {
  ensureFirebaseReady();
  const cred = GoogleAuthProvider.credential(idToken || null, accessToken || null);
  return signInWithCredential(getFirebaseAuth(), cred);
}

export async function linkGoogleTokens(
  user: User,
  idToken?: string | null,
  accessToken?: string | null,
) {
  const cred = GoogleAuthProvider.credential(idToken || null, accessToken || null);
  return linkWithCredential(user, cred);
}

export async function unlinkAuthProvider(user: User, providerId: string) {
  return unlink(user, providerId);
}

export async function deleteAuthUser(user: User) {
  return deleteUser(user);
}
