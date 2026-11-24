import fs from 'node:fs';
import path from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';
import { withAndroidManifest } from 'expo/config-plugins';

type AppVariant = 'e2e' | 'staging' | 'production';

const VARIANT = (process.env.APP_VARIANT || 'e2e') as AppVariant;
const ENABLE_APPLE_PAID = process.env.EXPO_ENABLE_APPLE_PAID_ENTITLEMENTS === 'true';
const PROD_PROJECT_ID = 'my-cook-book-67fde';

const VARIANT_META: Record<
  AppVariant,
  {
    name: string;
    bundleId: string;
    scheme: string;
    configDir: string;
    iconDir: 'dev' | 'staging' | 'prod';
    adaptiveBg: string;
  }
> = {
  e2e: {
    name: 'ספר המתכונים (E2E)',
    bundleId: 'com.roiguri.cookbook.e2e',
    scheme: 'cookbook-e2e',
    configDir: 'config/e2e',
    iconDir: 'dev',
    adaptiveBg: '#0daed1',
  },
  staging: {
    name: 'ספר המתכונים (Staging)',
    bundleId: 'com.roiguri.cookbook.staging',
    scheme: 'cookbook-staging',
    configDir: 'config/staging',
    iconDir: 'staging',
    adaptiveBg: '#3744cf',
  },
  production: {
    name: 'ספר המתכונים',
    bundleId: 'com.roiguri.cookbook',
    scheme: 'cookbook',
    configDir: 'config/production',
    iconDir: 'prod',
    adaptiveBg: '#2a9b69',
  },
};

function existingConfigFile(relPath: string): string | undefined {
  const full = path.resolve(__dirname, relPath);
  return fs.existsSync(full) ? `./${relPath}` : undefined;
}

function readPlistString(xml: string, key: string): string {
  const re = new RegExp(`<key>${key}<\\/key>\\s*<string>([^<]+)<\\/string>`);
  return xml.match(re)?.[1]?.trim() || '';
}

function loadGoogleAuthConfig(configDir: string) {
  let webClientId = '';
  let iosClientId = '';
  let iosUrlScheme = 'com.googleusercontent.apps.cookbook-e2e';

  const androidPath = path.resolve(__dirname, `${configDir}/google-services.json`);
  if (fs.existsSync(androidPath)) {
    const raw = fs.readFileSync(androidPath, 'utf8');
    if (VARIANT !== 'production' && raw.includes(PROD_PROJECT_ID)) {
      throw new Error(
        `Refusing to load production Firebase project (${PROD_PROJECT_ID}) into ${VARIANT} build.`,
      );
    }
    const parsed = JSON.parse(raw);
    const client = (parsed.client || [])[0] || {};
    const oauthClients: Array<{ client_id?: string; client_type?: number }> = [
      ...(client.oauth_client || []),
      ...(client.services?.appinvite_service?.other_platform_oauth_client || []),
    ];
    const webClient = oauthClients.find((c) => c.client_type === 3 && c.client_id);
    if (webClient?.client_id) {
      webClientId = webClient.client_id;
    }
    const iosClientFromJson = oauthClients.find((c) => c.client_type === 2 && c.client_id);
    if (iosClientFromJson?.client_id) {
      iosClientId = iosClientFromJson.client_id;
    }
  }

  const iosPlistPath = path.resolve(__dirname, `${configDir}/GoogleService-Info.plist`);
  if (fs.existsSync(iosPlistPath)) {
    const xml = fs.readFileSync(iosPlistPath, 'utf8');
    if (VARIANT !== 'production' && xml.includes(PROD_PROJECT_ID)) {
      throw new Error(
        `Refusing to load production Firebase project (${PROD_PROJECT_ID}) into ${VARIANT} build.`,
      );
    }
    const plistClientId = readPlistString(xml, 'CLIENT_ID');
    const plistReversedId = readPlistString(xml, 'REVERSED_CLIENT_ID');
    if (plistClientId) iosClientId = plistClientId;
    if (plistReversedId) iosUrlScheme = plistReversedId;
  }

  return { webClientId, iosClientId, iosUrlScheme };
}

function loadStagingFirebaseConfig(relPath: string) {
  const full = path.resolve(__dirname, relPath);
  if (!fs.existsSync(full)) return null;
  const raw = fs.readFileSync(full, 'utf8');
  if (raw.includes(PROD_PROJECT_ID)) {
    throw new Error(
      `Refusing to load production Firebase project (${PROD_PROJECT_ID}) into ${VARIANT} build.`,
    );
  }
  const parsed = JSON.parse(raw);
  const projectInfo = parsed.project_info || {};
  const client = (parsed.client || [])[0] || {};
  return {
    apiKey: client.api_key?.[0]?.current_key || '',
    authDomain: `${projectInfo.project_id}.firebaseapp.com`,
    projectId: projectInfo.project_id || '',
    storageBucket: projectInfo.storage_bucket || '',
    messagingSenderId: projectInfo.project_number || '',
    appId: client.client_info?.mobilesdk_app_id || '',
  };
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const meta = VARIANT_META[VARIANT] || VARIANT_META.e2e;
  const googleServicesFile = existingConfigFile(`${meta.configDir}/google-services.json`);
  const googleServiceInfoPlist = existingConfigFile(`${meta.configDir}/GoogleService-Info.plist`);
  const googleAuth = loadGoogleAuthConfig(meta.configDir);

  const firebaseConfig =
    VARIANT === 'staging'
      ? loadStagingFirebaseConfig(`${meta.configDir}/google-services.json`)
      : {
          apiKey: 'demo-cookbook-e2e-key',
          authDomain: 'demo-cookbook.firebaseapp.com',
          projectId: 'demo-cookbook',
          storageBucket: 'demo-cookbook.appspot.com',
          messagingSenderId: '000000000000',
          appId: '1:000000000000:web:cookbooke2e',
        };

  const plugins: NonNullable<ExpoConfig['plugins']> = [
    'expo-router',
    [
      'expo-localization',
      {
        supportedLocales: {
          ios: ['he', 'en'],
          android: ['he', 'en'],
        },
      },
    ],
    [
      '@react-native-google-signin/google-signin',
      {
        iosUrlScheme: googleAuth.iosUrlScheme,
      },
    ],
    [
      'expo-notifications',
      {
        color: '#6a994e',
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'האפליקציה זקוקה לגישה לתמונות כדי להוסיף תמונות מתכון ולייבא מתכונים.',
        cameraPermission: 'האפליקציה זקוקה לגישה למצלמה כדי לצלם תמונות מתכון או לסרוק מתכון.',
      },
    ],
    'expo-screen-orientation',
    'expo-web-browser',
  ];

  // Physical-device Apple capabilities requiring a paid Apple Developer account
  // stay cleanly disabled by default in $0 v1 and flip on in Phase 6.
  const iosPaidEntitlements = ENABLE_APPLE_PAID
    ? {
        associatedDomains: ['applinks:cookbook.example.com'],
        entitlements: {
          'aps-environment': VARIANT === 'production' ? 'production' : 'development',
        },
      }
    : {};

  const iconPath = `./assets/icons/${meta.iconDir}/wooden-spoon-maskable-512.png`;
  const splashImagePath = `./assets/icons/${meta.iconDir}/wooden-spoon-512.png`;

  const baseConfig: ExpoConfig = {
    ...config,
    name: meta.name,
    slug: 'cookbook-mobile',
    version: '1.0.0',
    scheme: meta.scheme,
    icon: iconPath,
    splash: {
      image: splashImagePath,
      resizeMode: 'contain',
      backgroundColor: '#faf6ec',
    },
    orientation: 'default',
    userInterfaceStyle: 'light',
    newArchEnabled: true,
    extra: {
      appVariant: VARIANT,
      useDtu: VARIANT === 'e2e' || process.env.EXPO_PUBLIC_USE_DTU === 'true',
      applePaidEntitlementsEnabled: ENABLE_APPLE_PAID,
      supportsRTL: true,
      forcesRTL: true,
      firebaseConfig,
      googleAuth: {
        webClientId: googleAuth.webClientId,
        iosClientId: googleAuth.iosClientId,
      },
      sentryDsn: VARIANT === 'staging' ? process.env.EXPO_PUBLIC_SENTRY_DSN_STAGING || '' : '',
    },
    ios: {
      bundleIdentifier: meta.bundleId,
      supportsTablet: true,
      infoPlist: {
        CFBundleDevelopmentRegion: 'he',
        CFBundleLocalizations: ['he', 'en'],
        ...(VARIANT === 'e2e' ? { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } } : {}),
      },
      ...(googleServiceInfoPlist ? { googleServicesFile: googleServiceInfoPlist } : {}),
      ...iosPaidEntitlements,
    },
    android: {
      package: meta.bundleId,
      edgeToEdgeEnabled: true,
      adaptiveIcon: {
        foregroundImage: iconPath,
        backgroundColor: meta.adaptiveBg,
      },
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
    plugins,
  };

  return withAndroidManifest(baseConfig, (mod) => {
    const app = mod.modResults.manifest.application?.[0];
    if (app) {
      app.$['android:supportsRtl'] = 'true';
      if (VARIANT === 'e2e') {
        app.$['android:usesCleartextTraffic'] = 'true';
      }
      // Add Android ACTION_SEND share target for URLs / recipe photos
      const mainActivity = app.activity?.find((act) => act.$['android:name'] === '.MainActivity');
      if (mainActivity) {
        mainActivity['intent-filter'] = mainActivity['intent-filter'] || [];
        const hasShare = mainActivity['intent-filter'].some((f) =>
          f.action?.some((a) => a.$['android:name'] === 'android.intent.action.SEND'),
        );
        if (!hasShare) {
          mainActivity['intent-filter'].push({
            action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
            category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
            data: [
              { $: { 'android:mimeType': 'text/plain' } },
              { $: { 'android:mimeType': 'image/*' } },
            ],
          });
        }
      }
    }
    return mod;
  });
};
