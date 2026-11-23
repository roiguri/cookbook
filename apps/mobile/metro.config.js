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

module.exports = config;
