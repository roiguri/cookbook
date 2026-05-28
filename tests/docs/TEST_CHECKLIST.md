# Test Coverage Checklist

This document tracks the testing status of the Cookbook integration. Use this to identify gaps and plan future work.

## 🚦 Application Flows (E2E)

_Critical consumer flows that must work._

- [x] **Home Page Sanity**
  - [x] Page loads successfully
  - [x] Header visible
  - [x] Recipe Feed visible
  - [x] Lazy loading images work
- [ ] **Recipe Interaction**
  - [ ] Opening a recipe (Navigation to details)
  - [ ] Adding to Favorites (as User)
  - [ ] Adding to Favorites (as Guest -> Redirect)
- [ ] **Meal Planning**
  - [ ] Add recipe to "My Meal"
  - [ ] View "My Meal" page
  - [ ] Remove recipe from "My Meal"
  - [ ] Generate Shopping List (if available)
- [ ] **Recipe Submission** (Propose Page)
  - [ ] Form validation
  - [ ] Image upload flow
  - [ ] Successful submission

## 🧩 Components

_Visual and interaction tests for UI blocks._

## 🧩 Component Coverage

**Legend:** 📸 Visual (Snapshot), 🖱️ Interaction (Playwright), 🧠 Logic (Jest)

### Recipes

| Component                   | 📸  | 🖱️  | 🧠  | Status     |
| --------------------------- | :-: | :-: | :-: | ---------- |
| `recipe-card`               | ✅  | ✅  | ✅  | **Stable** |
| `recipe-component`          | ✅  | ✅  | [ ] | **Stable** |
| `recipe-form-component`     | [ ] | [ ] | [ ] | Untested   |
| `edit-recipe-component`     | [ ] | [ ] | [ ] | Untested   |
| `propose-recipe-component`  | [ ] | [ ] | [ ] | Untested   |
| `recipe-preview-modal`      | [ ] | [ ] | [ ] | Untested   |
| `cook-mode-toggle`          | [ ] | [ ] | [ ] | Untested   |
| `media-instructions-editor` | [ ] | [ ] | [ ] | Untested   |

### Auth

| Component         | 📸  | 🖱️  | 🧠  | Status     |
| ----------------- | :-: | :-: | :-: | ---------- |
| `auth-avatar`     | ✅  | ✅  | [ ] | **Stable** |
| `login-form`      | ✅  | ✅  | [ ] | **Stable** |
| `signup-form`     | ✅  | ✅  | [ ] | **Stable** |
| `forgot-password` | ✅  | ✅  | [ ] | **Stable** |
| `user-profile`    | [ ] | [ ] | [ ] | Untested   |

### Collections (Feeds & Grids)

| Component                  | 📸  | 🖱️  | 🧠  | Status        |
| -------------------------- | :-: | :-: | :-: | ------------- |
| `recipe-scroller`          | ✅  | [ ] | [ ] | Partial (E2E) |
| `recipe-pagination`        | [ ] | [ ] | [ ] | Untested      |
| `recipe-presentation-grid` | [ ] | [ ] | [ ] | Untested      |
| `category-navigation`      | [ ] | [ ] | [ ] | Untested      |
| `unified-recipe-filter`    | [ ] | [ ] | [ ] | Untested      |

### Search & Filters

| Component           | 📸  | 🖱️  | 🧠  | Status   |
| ------------------- | :-: | :-: | :-: | -------- |
| `header-search-bar` | [ ] | [ ] | [ ] | Untested |
| `filter-search-bar` | [ ] | [ ] | [ ] | Untested |
| `filter-manager`    | [ ] | [ ] | [ ] | Untested |

### Modals & Media

| Component                 | 📸  | 🖱️  | 🧠  | Status     |
| ------------------------- | :-: | :-: | :-: | ---------- |
| `modal-component`         | ✅  | ✅  | [ ] | **Stable** |
| `confirmation-modal`      | [ ] | [ ] | [ ] | Untested   |
| `image-approval-multi`    | [ ] | [ ] | [ ] | Untested   |
| `fullscreen-media-viewer` | [ ] | [ ] | [ ] | Untested   |
| `pdf-viewer`              | [ ] | [ ] | [ ] | Untested   |
| `image-carousel`          | [ ] | [ ] | [ ] | Untested   |

### Utilities

| Component            | 📸  | 🖱️  | 🧠  | Status   |
| -------------------- | :-: | :-: | :-: | -------- |
| `toast-notification` | [ ] | [ ] | ✅  | Partial  |
| `loading-spinner`    | [ ] | [ ] | [ ] | Untested |
| `scroll-list`        | [ ] | [ ] | [ ] | Untested |

## 📄 Pages

_Integration tests for full pages._

- [ ] `home-page.js`
- [ ] `recipe-detail-page.js`
- [ ] `my-meal-page.js`
- [ ] `propose-recipe-page.js`
- [ ] `manager-dashboard-page.js`
- [ ] `documents-page.js`
- [ ] `categories-page.js`

## 🛠️ Services & Logic

_Unit tests for business logic._

- [x] `firestore-service.js`
- [x] `storage-service.js`
- [x] `auth-service.js`
- [x] `favorites-service.js`
- [x] `recipe-data-utils.js`
- [x] `recipe-image-utils.js`
- [x] `form-validation-utils.js`
- [x] `active-meal-service.js`
- [x] `router.js` (Core routing logic)
- [x] `common-utils.js`
- [x] `error-handler.js`

## 🐛 Known Bugs / Issues

_Document bugs found during testing here. Do not fix unless prioritized._

- [ ] (Example) `recipe-filter` does not reset when changing categories.

## 📝 Protocol for Agents

1.  **Read this file** before starting work to find a high-priority gap.
2.  **Update this file** if you discover a new gap or complete a task.
3.  **Do not fix** multiple items at once. Pick ONE.
