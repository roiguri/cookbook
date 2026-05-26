import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

export default [
  {
    ignores: ['coverage/', 'dist/'],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },
    plugins: {
      import: importPlugin,
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'firebase',
              importNames: ['default'],
              message:
                'Default import of Firebase is restricted. Use only named imports for helpers or use firebase-service.js.',
            },
            {
              name: 'firebase/auth',
              importNames: ['default'],
              message:
                'Default import of Firebase Auth is restricted. Use only named imports for helpers or use firebase-service.js.',
            },
            {
              name: 'firebase/firestore',
              importNames: ['default'],
              message:
                'Default import of Firestore is restricted. Use only named imports for helpers or use firebase-service.js.',
            },
            {
              name: 'firebase/storage',
              importNames: ['default'],
              message:
                'Default import of Storage is restricted. Use only named imports for helpers or use firebase-service.js.',
            },
          ],
          patterns: [{ group: ['firebase/compat/*'], message: 'Do not use compat API' }],
        },
      ],
    },
  },
  // Strict service-layer boundary: lib/, page/, and other non-service src/ code
  // must go through a domain service. Direct imports of _firebase/* services
  // or raw firebase/{firestore,storage,auth} SDKs are forbidden here. The
  // exception is src/js/services/** itself, which is the only place those
  // SDKs are allowed.
  {
    files: ['src/**/*.{js,mjs}'],
    ignores: ['src/js/services/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['firebase/compat/*'],
              message: 'Do not use compat API.',
            },
            {
              group: ['firebase/firestore', 'firebase/storage', 'firebase/auth'],
              message: 'Raw Firebase SDKs are only allowed inside src/js/services/**.',
            },
            {
              group: ['**/_firebase/firestore-service*', '**/_firebase/storage-service*'],
              message:
                'Use a domain service (RecipeService, RecipeImageService, MediaInstructionService, PdfService, UserService, etc.) instead of importing _firebase/* directly.',
            },
          ],
        },
      ],
    },
  },
];
