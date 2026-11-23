# L2 Pyramid Summary — Vertical Slice Dependency DAG & Worktree Ownership

> Guides the Factory Orchestrator (`factory/orchestrator/`) when scheduling Waves 1–3 across parallel Git worktrees on `native-mobile` without merge conflicts.

## 1. Execution Waves & Slice Dependency Graph

```mermaid
flowchart LR
    S00["00 Foundation Shell<br/>(Wave 1A)"] --> S01["01 Auth & Roles<br/>(Wave 1B)"]
    S01 --> S02["02 Home, Browse & Search<br/>(Wave 2)"]
    S01 --> S03["03 Recipe Detail & Cook Mode<br/>(Wave 2)"]
    S01 --> S04["04 My Recipes & Sharing<br/>(Wave 2)"]
    S01 --> S05["05 My Meal & Offline<br/>(Wave 2)"]
    S01 --> S07["07 Chef Avatar Builder<br/>(Wave 2)"]
    S01 --> S08["08 Grandma's Cookbook<br/>(Wave 2)"]
    S02 --> S06["06 Create, AI Import & Share Target<br/>(Wave 3)"]
    S03 --> S06
    S04 --> S06
    S03 --> S09["09 Manager Dashboard<br/>(Wave 3)"]
    S04 --> S09
    S06 --> S09
    S00 --> S10["10 8 Easter-Egg Mini-Games<br/>(Wave 3)"]
    S01 --> S11["11 Push & Deep Links<br/>(Wave 3)"]
    S03 --> S11
    S09 --> S11
```

## 2. File Ownership Boundaries (Zero Worktree Conflicts)

|  Wave  | Slice | Spec File                                           | Owned Paths under `apps/mobile/`                                                                                                                                                                                                |
| :----: | ----- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1A** | `00`  | `factory/specs/00-foundation-shell.md`              | `app.config.ts`, `app/_layout.tsx`, `app/(tabs)/_layout.tsx`, `src/theme/*`, `src/services/_firebase/*`, `src/services/logger.ts`, `src/components/ui/*`                                                                        |
| **1B** | `01`  | `factory/specs/01-auth-and-roles.md`                | `app/auth.tsx`, `src/services/auth/*`, `src/services/users/user-service.ts`, `src/components/auth/*` (except `avatar-builder`)                                                                                                  |
| **2**  | `02`  | `factory/specs/02-home-browse-search.md`            | `app/(tabs)/home.tsx`, `app/(tabs)/categories.tsx`, `src/services/recipes/recipe-service.ts` (read/list), `src/services/recipes/recipe-search-service.ts`, `src/services/users/favorites-service.ts`, `src/components/browse/*` |
| **2**  | `03`  | `factory/specs/03-recipe-detail-cook-mode.md`       | `app/recipe/[id].tsx`, `src/services/recipes/recipe-image-service.ts`, `src/services/recipes/media-instruction-service.ts`, `src/components/recipe-detail/*`                                                                    |
| **2**  | `04`  | `factory/specs/04-my-recipes-and-sharing.md`        | `app/(tabs)/my-recipes.tsx`, `src/services/recipes/recipe-share-service.ts`, `src/services/recipes/recipe-submission-service.ts`, `src/components/library/*`                                                                    |
| **2**  | `05`  | `factory/specs/05-my-meal-and-offline.md`           | `app/(tabs)/my-meal.tsx`, `src/services/meals/active-meal-service.ts`, `src/components/meal/*`                                                                                                                                  |
| **2**  | `07`  | `factory/specs/07-chef-avatar-builder.md`           | `src/components/auth/avatar-builder/*`                                                                                                                                                                                          |
| **2**  | `08`  | `factory/specs/08-grandmas-cookbook.md`             | `app/(tabs)/grandmas-cooking.tsx`, `src/services/pdf/pdf-service.ts`, `src/components/grandma/*`                                                                                                                                |
| **3**  | `06`  | `factory/specs/06-create-ai-import-share-target.md` | `app/(tabs)/propose-recipe.tsx`, `src/services/recipes/ai-enhancement-service.ts`, `src/services/recipes/recipe-image-proposal-service.ts`, `src/components/recipe-form/*`, `src/hooks/useShareIntent.ts`                       |
| **3**  | `09`  | `factory/specs/09-manager-dashboard.md`             | `app/(tabs)/dashboard.tsx`, `src/services/recipes/recipe-edit-suggestion-service.ts`, `src/services/admin/*`, `src/components/dashboard/*`                                                                                      |
| **3**  | `10`  | `factory/specs/10-easter-egg-mini-games.md`         | `app/games.tsx`, `src/games-host/*`, `scripts/bundle-mobile-games.mjs`                                                                                                                                                          |
| **3**  | `11`  | `factory/specs/11-push-and-deep-links.md`           | `src/services/users/notification-service.ts`, `src/hooks/usePushNotifications.ts`, `src/hooks/useDeepLinks.ts`                                                                                                                  |

## 3. Visible Inner Gate (Must Pass Before AI-to-AI Review)

Every slice worktree MUST pass all visible checks before submitting to the AI-to-AI Reviewer:

1. `npm --prefix apps/mobile run typecheck` (`tsc --noEmit` — 0 errors)
2. `npm run lint` & `npm --prefix functions run lint` (0 errors, incl. two-tier Firebase, RTL logical props, zero raw hex rules)
3. `npm run check:tokens` & `node scripts/sync-shared.mjs --check`
4. `npm test` (web + shared unit tests + mobile RNTL unit tests)
5. `npm run test:rules` & `npm run test:functions` (when backend/shared untouched, confirms 0 regressions)
6. `npm run build` (web SPA production build remains 100% green)
7. `npm run mobile:build:android && npm run mobile:smoke:android` (local WSL2 Android Emulator smoke against DTU)
