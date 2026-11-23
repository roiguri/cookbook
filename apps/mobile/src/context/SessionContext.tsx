import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { captureError, setTelemetryUser } from '@/services/logger';
import {
  fetchUserProfile,
  initializeBackend,
  onAuthSessionChanged,
  subscribeUserProfile,
  type UserProfileDoc,
  type UserRole,
} from '@/services/users/session-service';

export interface SessionUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  providerIds: string[];
}

export type BeforeSignOutHook = (uid: string) => Promise<void> | void;

interface SessionContextValue {
  user: SessionUser | null;
  profile: UserProfileDoc | null;
  role: UserRole;
  loading: boolean;
  isAuthenticated: boolean;
  isApproved: boolean;
  isManager: boolean;
  refreshProfile: () => Promise<void>;
  registerBeforeSignOutHook: (hook: BeforeSignOutHook) => () => void;
  runBeforeSignOutHooks: (uid: string) => Promise<void>;
}

const beforeSignOutRegistry = new Set<BeforeSignOutHook>();

export function registerGlobalBeforeSignOutHook(hook: BeforeSignOutHook): () => void {
  beforeSignOutRegistry.add(hook);
  return () => beforeSignOutRegistry.delete(hook);
}

export async function executeGlobalBeforeSignOutHooks(uid: string): Promise<void> {
  for (const hook of Array.from(beforeSignOutRegistry)) {
    try {
      await hook(uid);
    } catch (err) {
      captureError(err, { service: 'session', op: 'beforeSignOutHook', uid });
    }
  }
}

const SessionContext = createContext<SessionContextValue>({
  user: null,
  profile: null,
  role: 'guest',
  loading: true,
  isAuthenticated: false,
  isApproved: false,
  isManager: false,
  refreshProfile: async () => {},
  registerBeforeSignOutHook: registerGlobalBeforeSignOutHook,
  runBeforeSignOutHooks: executeGlobalBeforeSignOutHooks,
});

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [profile, setProfile] = useState<UserProfileDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const unsubProfileRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    initializeBackend();
    const unsubAuth = onAuthSessionChanged((fbUser) => {
      if (unsubProfileRef.current) {
        unsubProfileRef.current();
        unsubProfileRef.current = null;
      }

      if (!fbUser) {
        setUser(null);
        setProfile(null);
        setTelemetryUser(null, 'guest');
        setLoading(false);
        return;
      }

      const mapped: SessionUser = {
        uid: fbUser.uid,
        email: fbUser.email,
        displayName: fbUser.displayName,
        providerIds: (fbUser.providerData || []).map((p) => p.providerId),
      };
      setUser(mapped);

      unsubProfileRef.current = subscribeUserProfile(
        fbUser.uid,
        (doc) => {
          setProfile(doc);
          const resolvedRole: UserRole = doc?.role || 'user';
          setTelemetryUser(fbUser.uid, resolvedRole);
          setLoading(false);
        },
        (err) => {
          captureError(err, { service: 'session', op: 'subscribeUserProfile', uid: fbUser.uid });
          setTelemetryUser(fbUser.uid, 'user');
          setLoading(false);
        },
      );
    });

    return () => {
      unsubAuth();
      if (unsubProfileRef.current) unsubProfileRef.current();
    };
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const fresh = await fetchUserProfile(user.uid);
      setProfile(fresh);
      setTelemetryUser(user.uid, fresh?.role || 'user');
    } catch (err) {
      captureError(err, { service: 'session', op: 'refreshProfile', uid: user.uid });
    }
  }, [user?.uid]);

  const role: UserRole = !user ? 'guest' : profile?.role || 'user';
  const isAuthenticated = Boolean(user);
  const isApproved = role === 'approved' || role === 'manager';
  const isManager = role === 'manager';

  return (
    <SessionContext.Provider
      value={{
        user,
        profile,
        role,
        loading,
        isAuthenticated,
        isApproved,
        isManager,
        refreshProfile,
        registerBeforeSignOutHook: registerGlobalBeforeSignOutHook,
        runBeforeSignOutHooks: executeGlobalBeforeSignOutHooks,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
