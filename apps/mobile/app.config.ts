import fs from 'node:fs';
import path from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';
import { withAndroidManifest } from 'expo/config-plugins';

type AppVariant = 'e2e' | 'staging' | 'production';

const VARIANT = (process.env.APP_VARIANT || 'e2e') as AppVariant;
const ENABLE_APPLE_PAID = process.env.EXPO_ENABLE_APPLE_PAID_ENTITLEMENTS === 'true';

const VARIANT_META: Record<
  AppVariant,
  { name: string; bundleId: string; scheme: string; configDir: string }
> = {
  e2e: {
    name: 'ספר המתכונים (E2E)',
    bundleId: 'com.roiguri.cookbook.e2e',
    scheme: 'cookbook-e2e',
    configDir: 'config/e2e',
  },
  staging: {
    name: 'ספר המתכונים (Staging)',
    bundleId: 'com.roiguri.cookbook.staging',
    scheme: 'cookbook-staging',
    configDir: 'config/staging',
  },
  production: {
    name: 'ספר המתכונים',
    bundleId: 'com.roiguri.cookbook',
    scheme: 'cookbook',
    configDir: 'config/production',
  },
};

function existingConfigFile(relPath: string): string | undefined {
  const full = path.resolve(__dirname, relPath);
  return fs.existsSync(full) ? `./${relPath}` : undefined;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const meta = VARIANT_META[VARIANT] || VARIANT_META.e2e;
  const googleServicesFile = existingConfigFile(`${meta.configDir}/google-services.json`);
  const googleServiceInfoPlist = existingConfigFile(`${meta.configDir}/GoogleService-Info.plist`);

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
  ];

  // Physical-device Apple capabilities requiring a paid Apple Developer account
  // (APNs remote push, Associated Domains Universal Links, Share Extension App Groups)
  // stay cleanly disabled by default in $0 v1 and flip on in Phase 6.
  const iosPaidEntitlements = ENABLE_APPLE_PAID
    ? {
        associatedDomains: ['applinks:cookbook.example.com'],
        entitlements: {
          'aps-environment': VARIANT === 'production' ? 'production' : 'development',
        },
      }
    : {};

  const baseConfig: ExpoConfig = {
    ...config,
    name: meta.name,
    slug: 'cookbook-mobile',
    version: '1.0.0',
    scheme: meta.scheme,
    orientation: 'default',
    userInterfaceStyle: 'light',
    newArchEnabled: true,
    extra: {
      appVariant: VARIANT,
      useDtu: VARIANT === 'e2e' || process.env.EXPO_PUBLIC_USE_DTU === 'true',
      applePaidEntitlementsEnabled: ENABLE_APPLE_PAID,
      supportsRTL: true,
      forcesRTL: true,
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
        backgroundColor: '#faf6ec',
      },
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
    plugins,
  };

  // E2E-only cleartext loopback access to local Cookbook DTU (never enabled on staging/prod)
  if (VARIANT === 'e2e') {
    return withAndroidManifest(baseConfig, (mod) => {
      const app = mod.modResults.manifest.application?.[0];
      if (app) {
        app.$['android:usesCleartextTraffic'] = 'true';
      }
      return mod;
    });
  }

  return baseConfig;
};
