import { ensureFirebaseReady } from '../_firebase/firebase-app';
import {
  getCurrentAuthUser,
  subscribeAuthState,
  type FirebaseAuthUser,
} from '../_firebase/auth-adapter';
import { getDocument, subscribeDocument } from '../_firebase/firestore-adapter';

export type UserRole = 'guest' | 'user' | 'approved' | 'manager';

export interface UserProfileDoc {
  id: string;
  fullName?: string;
  email?: string;
  role?: 'user' | 'approved' | 'manager';
  bio?: string;
  avatarUrl?: string | null;
  avatarConfig?: Record<string, any> | null;
  favorites?: string[];
  createdAt?: any;
  updatedAt?: any;
}

export function initializeBackend(): void {
  ensureFirebaseReady();
}

export function getAuthUserSnapshot(): FirebaseAuthUser | null {
  return getCurrentAuthUser();
}

export function onAuthSessionChanged(cb: (user: FirebaseAuthUser | null) => void): () => void {
  return subscribeAuthState(cb);
}

export function subscribeUserProfile(
  uid: string,
  onData: (profile: UserProfileDoc | null) => void,
  onError?: (err: Error) => void,
): () => void {
  return subscribeDocument<UserProfileDoc>('users', onData, onError, uid);
}

export async function fetchUserProfile(uid: string): Promise<UserProfileDoc | null> {
  return getDocument<UserProfileDoc>('users', uid);
}
