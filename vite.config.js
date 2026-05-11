import { defineConfig } from 'vite';
import { resolve } from 'path';
import path from 'path';
import { sentryVitePlugin } from '@sentry/vite-plugin';

// Source maps are uploaded to Sentry only when all three are present.
// The plugin is a no-op otherwise (e.g. local builds without the auth token).
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
const sentryOrg = process.env.SENTRY_ORG;
const sentryProject = process.env.SENTRY_PROJECT;
const sentryRelease = process.env.VITE_SENTRY_RELEASE || process.env.COMMIT_REF;
const sentryEnabled = Boolean(sentryAuthToken && sentryOrg && sentryProject);

export default defineConfig({
  base: '/',
  plugins: [
    sentryEnabled &&
      sentryVitePlugin({
        org: sentryOrg,
        project: sentryProject,
        authToken: sentryAuthToken,
        release: sentryRelease ? { name: sentryRelease } : undefined,
        // Upload then delete sourcemaps so they're never served to users.
        sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
        telemetry: false,
      }),
  ].filter(Boolean),
  optimizeDependencies: false,
  build: {
    // 'hidden' generates source maps without a `sourceMappingURL` comment in the
    // minified JS, so browsers won't auto-fetch them. The Sentry plugin still
    // finds them by name and deletes them from dist/ after upload. When Sentry
    // is disabled (no auth token), no maps are generated at all — this avoids
    // leaking maps if a deploy lands before Sentry env vars are configured.
    sourcemap: sentryEnabled ? 'hidden' : false,
    rollupOptions: {
      input: {
        // SPA Architecture - Single Page Application
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
  resolve: {
    alias: {
      src: path.resolve(__dirname, 'src'),
    },
  },
  server: {
    // Enable History API fallback for SPA routing in development
    historyApiFallback: {
      // Fallback to index.html for any route that doesn't match static files
      rewrites: [
        {
          from: /^\/(?!src|tests|img|css|js|.*\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)).*$/,
          to: '/index.html',
        },
      ],
    },
  },
});
