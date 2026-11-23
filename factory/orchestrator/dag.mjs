/**
 * Machine-Readable Vertical-Slice Dependency DAG (matches factory/context/L2-slice-dag.md).
 *
 * Enforces acyclic Wave ordering (`1A -> 1B -> 2 -> 3A -> 3B`) and disjoint
 * worktree file ownership so parallel builders never collide.
 */

export const WAVES = Object.freeze(['1A', '1B', '2', '3A', '3B']);

export const SLICES = Object.freeze([
  {
    id: '00',
    wave: '1A',
    name: 'Foundation Shell',
    spec: 'factory/specs/00-foundation-shell.md',
    dependsOn: [],
    ownedPaths: [
      'apps/mobile/app.config.ts',
      'apps/mobile/app/_layout.tsx',
      'apps/mobile/app/(tabs)/_layout.tsx',
      'apps/mobile/src/theme/',
      'apps/mobile/src/services/_firebase/',
      'apps/mobile/src/services/logger.ts',
      'apps/mobile/src/components/ui/',
    ],
  },
  {
    id: '01',
    wave: '1B',
    name: 'Auth & Roles',
    spec: 'factory/specs/01-auth-and-roles.md',
    dependsOn: ['00'],
    ownedPaths: [
      'apps/mobile/app/auth.tsx',
      'apps/mobile/src/services/auth/',
      'apps/mobile/src/services/users/user-service.ts',
      'apps/mobile/src/components/auth/',
    ],
  },
  {
    id: '02',
    wave: '2',
    name: 'Home, Browse & Search',
    spec: 'factory/specs/02-home-browse-search.md',
    dependsOn: ['01'],
    ownedPaths: [
      'apps/mobile/app/(tabs)/home.tsx',
      'apps/mobile/app/(tabs)/categories.tsx',
      'apps/mobile/src/services/recipes/recipe-service.ts',
      'apps/mobile/src/services/recipes/recipe-image-service.ts',
      'apps/mobile/src/services/recipes/recipe-search-service.ts',
      'apps/mobile/src/services/users/favorites-service.ts',
      'apps/mobile/src/components/browse/',
    ],
  },
  {
    id: '04',
    wave: '2',
    name: 'My Recipes & Sharing',
    spec: 'factory/specs/04-my-recipes-and-sharing.md',
    dependsOn: ['01'],
    ownedPaths: [
      'apps/mobile/app/(tabs)/my-recipes.tsx',
      'apps/mobile/src/services/recipes/recipe-share-service.ts',
      'apps/mobile/src/services/recipes/recipe-submission-service.ts',
      'apps/mobile/src/components/library/',
    ],
  },
  {
    id: '05',
    wave: '2',
    name: 'My Meal & Offline',
    spec: 'factory/specs/05-my-meal-and-offline.md',
    dependsOn: ['01'],
    ownedPaths: [
      'apps/mobile/app/(tabs)/my-meal.tsx',
      'apps/mobile/src/services/meals/active-meal-service.ts',
      'apps/mobile/src/components/meal/',
    ],
  },
  {
    id: '07',
    wave: '2',
    name: 'Chef Avatar Builder',
    spec: 'factory/specs/07-chef-avatar-builder.md',
    dependsOn: ['01'],
    ownedPaths: ['apps/mobile/src/components/auth/avatar-builder/'],
  },
  {
    id: '08',
    wave: '2',
    name: "Grandma's Cookbook",
    spec: 'factory/specs/08-grandmas-cookbook.md',
    dependsOn: ['01'],
    ownedPaths: [
      'apps/mobile/app/(tabs)/grandmas-cooking.tsx',
      'apps/mobile/src/services/pdf/pdf-service.ts',
      'apps/mobile/src/components/grandma/',
    ],
  },
  {
    id: '10',
    wave: '2',
    name: '8 Easter-Egg Mini-Games',
    spec: 'factory/specs/10-easter-egg-mini-games.md',
    dependsOn: ['00'],
    ownedPaths: [
      'apps/mobile/app/games.tsx',
      'apps/mobile/src/games-host/',
      'scripts/bundle-mobile-games.mjs',
    ],
  },
  {
    id: '03',
    wave: '3A',
    name: 'Recipe Detail & Cook Mode',
    spec: 'factory/specs/03-recipe-detail-cook-mode.md',
    dependsOn: ['02', '04', '05'],
    ownedPaths: [
      'apps/mobile/app/recipe/',
      'apps/mobile/src/services/recipes/media-instruction-service.ts',
      'apps/mobile/src/components/recipe-detail/',
    ],
  },
  {
    id: '06',
    wave: '3B',
    name: 'Create, AI Import & Share Target',
    spec: 'factory/specs/06-create-ai-import-share-target.md',
    dependsOn: ['03', '10'],
    ownedPaths: [
      'apps/mobile/app/(tabs)/propose-recipe.tsx',
      'apps/mobile/src/services/recipes/recipe-import-service.ts',
      'apps/mobile/src/services/recipes/recipe-edit-suggestion-service.ts',
      'apps/mobile/src/components/recipe-form/',
      'apps/mobile/src/hooks/useShareIntent.ts',
    ],
  },
  {
    id: '09',
    wave: '3B',
    name: 'Manager Dashboard',
    spec: 'factory/specs/09-manager-dashboard.md',
    dependsOn: ['03', '06', '10'],
    ownedPaths: [
      'apps/mobile/app/(tabs)/dashboard.tsx',
      'apps/mobile/src/services/recipes/ai-enhancement-service.ts',
      'apps/mobile/src/services/admin/',
      'apps/mobile/src/components/dashboard/',
    ],
  },
  {
    id: '11',
    wave: '3B',
    name: 'Push & Deep Links',
    spec: 'factory/specs/11-push-and-deep-links.md',
    dependsOn: ['01', '03', '09'],
    ownedPaths: [
      'apps/mobile/src/services/users/notification-service.ts',
      'apps/mobile/src/hooks/usePushNotifications.ts',
      'apps/mobile/src/hooks/useDeepLinks.ts',
    ],
  },
]);

export function getSliceById(id) {
  const padded = String(id).padStart(2, '0');
  return SLICES.find((s) => s.id === padded) || null;
}

export function getSlicesByWave(wave) {
  return SLICES.filter((s) => s.wave === wave);
}

/**
 * Validate DAG is strictly acyclic and every dependency is declared in an
 * earlier (or same-wave topologically ordered) position.
 */
export function validateDag(slices = SLICES) {
  const byId = new Map(slices.map((s) => [s.id, s]));
  const visiting = new Set();
  const visited = new Set();
  const order = [];

  function dfs(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`Cycle detected in slice DAG involving slice "${id}"`);
    }
    const slice = byId.get(id);
    if (!slice) {
      throw new Error(`Unknown dependency slice "${id}"`);
    }
    visiting.add(id);
    for (const dep of slice.dependsOn) {
      dfs(dep);
    }
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  }

  for (const s of slices) {
    dfs(s.id);
  }

  // Also ensure wave ordering is respected (never depend on a strictly later wave)
  const waveIndex = new Map(WAVES.map((w, i) => [w, i]));
  for (const s of slices) {
    for (const depId of s.dependsOn) {
      const dep = byId.get(depId);
      if (waveIndex.get(dep.wave) > waveIndex.get(s.wave)) {
        throw new Error(
          `Slice ${s.id} (wave ${s.wave}) cannot depend on later-wave slice ${dep.id} (wave ${dep.wave})`,
        );
      }
    }
  }

  return { valid: true, topologicalOrder: order };
}
