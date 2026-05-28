# Testing Guide

This document defines the testing strategy, tools, and protocols for the Cookbook project.

## 1. Overview

The project employs a multi-layered testing strategy:

- **Unit Tests (Jest)**: For logic, services, and utilities.
- **Visual/Component Tests (Playwright)**: For web components (`recipe-card`), validating rendering and interactions in a real browser.
- **E2E Tests (Playwright)**: For critical user flows (e.g., Home Page) using mock data.

## 2. Running Tests

### Unit Tests (Jest)

```bash
npm run test
```

_Located in `tests/js/`_

### Component & Visual Tests (Playwright)

```bash
npx playwright test tests/visuals/components
```

_Located in `tests/visuals/components/`_

### E2E Tests (Playwright)

```bash
npx playwright test tests/visuals/e2e
```

_Located in `tests/visuals/e2e/`_

### Update Snapshots

```bash
npx playwright test --update-snapshots
```

## 3. Directory Structure

```
tests/
├── js/                  # Unit tests (Jest)
│   ├── services/
│   └── utils/
├── lib/                 # Component logic tests (Jest)
├── visuals/             # Browser tests (Playwright)
│   ├── components/      # Component visual/interaction tests
│   ├── e2e/             # End-to-End flow tests
│   └── utils/           # E2E specific helpers (e.g. test-helpers.js)
└── common/
    └── mocks/           # Shared mock files (Browser & Node)
```

## 4. Developer Protocols (Critical)

**When working on this codebase, verify you follow these rules:**

### 🔍 Focus & Scope

- **One at a time:** Focus on one component or one flow at a time. Do not attempt to cover multiple unrelated areas in a single task.
- **Irrelevant Changes:** If you find missing coverage in an area unrelated to your current task, **document it in `TEST_CHECKLIST.md`**. Do **NOT** fix it as part of the current task.

### 🛠️ Use of Mocks & Utils

- **Centralization:** Always use centralized mocks located in `tests/common/mocks/`.
- **Browser Mocks:** For Playwright `page.route` interception, use `.browser.js` mocks (e.g., `tests/common/mocks/firestore-service.browser.js`).
- **Helpers:** Use `tests/visuals/utils/test-helpers.js` for common E2E patterns (e.g., `forceLazyImages`).

### 🚫 Code Modification

- **Immutable Production:** Do **NOT** change non-test files (production code) to facilitate testing, unless a functional bug is found.
- **Bug Fixes:** If a bug is found in production code:
  1.  Create a separate atomic PR/Commit for the fix.
  2.  Include ONLY the relevant tests for that specific bug.
  3.  Do not bundle refactors or coverage improvements with bug fixes.

## 5. Mocking Strategy

### E2E / Visual Tests

We use **Network Interception** (`page.route`) to mock backend services.

- **Do not** depend on the live Firebase emulator or production database.
- Inject mocks at the module level (intercepting requests to `firestore-service.js`).
- **Images:** Use Mock Data URIs (Base64) to ensure snapshots are deterministic and do not depend on external CDNs.

### Unit Tests

We use **Jest Mocks** (`jest.mock(...)`).

- Mock dependencies relative to the file being tested.
- Ensure mocks reset between tests.
