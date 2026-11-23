import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import * as FirebaseAuth from 'firebase/auth';
import { connectAuthEmulator, getAuth, initializeAuth, type Auth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  type Firestore,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions';
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';

const extra = (Constants.expoConfig?.extra || {}) as Record<string, any>;

export const APP_VARIANT: 'e2e' | 'staging' | 'production' = extra.appVariant || 'e2e';
export const IS_DTU_MODE: boolean =
  APP_VARIANT === 'e2e' || Boolean(extra.useDtu) || process.env.EXPO_PUBLIC_USE_DTU === 'true';

let resolvedDtuHost = '127.0.0.1';
let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;
let storageInstance: FirebaseStorage | null = null;
let functionsInstance: Functions | null = null;
let emulatorsWired = false;

export function getDtuBaseHost(): string {
  return resolvedDtuHost;
}

export function getDtuSeedUrl(): string {
  const override = process.env.EXPO_PUBLIC_DTU_SEED_URL;
  if (override) return override;
  return `http://${resolvedDtuHost}:9200`;
}

export async function probeDtuHealth(): Promise<{
  connected: boolean;
  profile: string | null;
  host: string;
}> {
  if (!IS_DTU_MODE) {
    return { connected: false, profile: null, host: '' };
  }
  const hosts = Platform.OS === 'android' ? ['127.0.0.1', '10.0.2.2'] : ['127.0.0.1'];
  for (const host of hosts) {
    try {
      const res = await fetch(`http://${host}:9200/health`);
      if (res.ok) {
        const json = await res.json();
        resolvedDtuHost = host;
        return { connected: true, profile: json.lastProfile || 'ready', host };
      }
    } catch {
      // Try fallback host
    }
  }
  return { connected: false, profile: null, host: resolvedDtuHost };
}

function getFirebaseConfig() {
  const cfg = extra.firebaseConfig;
  if (cfg && cfg.projectId) {
    return cfg;
  }
  return {
    apiKey: 'demo-cookbook-e2e-key',
    authDomain: 'demo-cookbook.firebaseapp.com',
    projectId: 'demo-cookbook',
    storageBucket: 'demo-cookbook.appspot.com',
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:cookbooke2e',
  };
}

export function getFirebaseApp(): FirebaseApp {
  if (appInstance) return appInstance;
  const existing = getApps();
  appInstance = existing.length ? getApp() : initializeApp(getFirebaseConfig());
  return appInstance;
}

function createAuthInstance(app: FirebaseApp): Auth {
  try {
    const getRNPersistence = (FirebaseAuth as any).getReactNativePersistence;
    if (typeof getRNPersistence === 'function') {
      return initializeAuth(app, {
        persistence: getRNPersistence(AsyncStorage),
      });
    }
    return initializeAuth(app);
  } catch {
    return getAuth(app);
  }
}

export function getFirebaseAuth(): Auth {
  if (authInstance) return authInstance;
  authInstance = createAuthInstance(getFirebaseApp());
  wireEmulatorsIfNeeded();
  return authInstance;
}

export function getFirebaseDb(): Firestore {
  if (dbInstance) return dbInstance;
  const app = getFirebaseApp();
  try {
    dbInstance = initializeFirestore(app, {
      experimentalAutoDetectLongPolling: true,
    });
  } catch {
    dbInstance = getFirestore(app);
  }
  wireEmulatorsIfNeeded();
  return dbInstance;
}

export function getFirebaseStorage(): FirebaseStorage {
  if (storageInstance) return storageInstance;
  const app = getFirebaseApp();
  storageInstance = getStorage(app);
  wireEmulatorsIfNeeded();
  return storageInstance;
}

export function getFirebaseFunctions(): Functions {
  if (functionsInstance) return functionsInstance;
  const app = getFirebaseApp();
  functionsInstance = getFunctions(app, 'us-central1');
  wireEmulatorsIfNeeded();
  return functionsInstance;
}

export function wireEmulatorsIfNeeded(): void {
  if (!IS_DTU_MODE || emulatorsWired) return;
  emulatorsWired = true;
  const host = resolvedDtuHost;
  try {
    if (authInstance) {
      connectAuthEmulator(authInstance, `http://${host}:9099`, { disableWarnings: true });
    }
  } catch {
    // Already connected
  }
  try {
    if (dbInstance) {
      connectFirestoreEmulator(dbInstance, host, 8080);
    }
  } catch {
    // Already connected
  }
  try {
    if (storageInstance) {
      connectStorageEmulator(storageInstance, host, 9199);
    }
  } catch {
    // Already connected
  }
  try {
    if (functionsInstance) {
      connectFunctionsEmulator(functionsInstance, host, 5001);
    }
  } catch {
    // Already connected
  }
}

/**
 * Eagerly initializes all Firebase clients and wires DTU emulators before any
 * query or listener starts.
 */
export function ensureFirebaseReady(): void {
  const app = getFirebaseApp();
  if (!authInstance) {
    authInstance = createAuthInstance(app);
  }
  if (!dbInstance) {
    try {
      dbInstance = initializeFirestore(app, {
        experimentalAutoDetectLongPolling: true,
      });
    } catch {
      dbInstance = getFirestore(app);
    }
  }
  if (!storageInstance) {
    storageInstance = getStorage(app);
  }
  if (!functionsInstance) {
    functionsInstance = getFunctions(app, 'us-central1');
  }
  wireEmulatorsIfNeeded();
}
