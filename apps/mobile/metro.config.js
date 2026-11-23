const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch shared monorepo packages so Metro resolves @cookbook/core & @cookbook/tokens live
config.watchFolders = [
  path.resolve(workspaceRoot, 'packages/cookbook-core'),
  path.resolve(workspaceRoot, 'packages/cookbook-tokens'),
];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Required for Firebase JS SDK v11 compatibility under Expo SDK 53 / Metro 0.82
config.resolver.sourceExts = Array.from(new Set([...(config.resolver.sourceExts || []), 'cjs']));
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
