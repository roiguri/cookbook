# SPA Core Implementation Plan - Phase 1

## Building Foundation Services and Application Shell

---

## Overview

This plan focuses on building the core SPA infrastructure with hash-based routing, then creating the application shell with header/footer. Each step includes specific tasks, deliverables, and testable success metrics.

**Timeline**: 1-2 weeks  
**Approach**: Build and test services first, then create skeleton shell  
**Routing**: Hash-based (`#/page`) with future migration to History API

---

## Step 1: Core Router Service (Days 1-2)

### Tasks

- [x] Create `src/app/core/router.js` with hash-based routing
- [x] Implement route registration, navigation, and URL parsing
- [x] Add browser back/forward button support
- [x] Create simple test harness to verify routing logic

### Implementation Details

**Router Core Features:**

```javascript
// src/app/core/router.js
class AppRouter {
  constructor() {
    this.routes = new Map();
    this.currentRoute = null;
    this.defaultRoute = '/home';
  }

  // Route management
  registerRoute(path, handler) {}
  navigate(path) {}
  getCurrentRoute() {}

  // Event handling
  handleHashChange() {}
  handlePopState() {}

  // URL management
  updateURL(path) {}
  parseCurrentRoute() {}
}
```

**Test Setup:**

- Create simple test page at `test-router.html`
- Register test routes that show different content
- Test navigation programmatically and via URL changes

### Deliverables

- Working router class in `src/app/core/router.js`
- Test page demonstrating router functionality
- Basic documentation of router API

### Success Metrics

- [x] **Route Registration**: Can register routes and retrieve them
- [x] **Navigation**: `router.navigate('#/test')` changes URL and triggers route handler
- [x] **URL Parsing**: Router correctly parses `#/page/param` into route and parameters
- [x] **Browser Integration**: Back/forward buttons work correctly
- [x] **Default Route**: Navigating to `#/` redirects to default route
- [x] **Error Handling**: Invalid routes show appropriate fallback
- [x] **Event System**: Route changes trigger proper event callbacks
- [x] **No Console Errors**: Router operates without JavaScript errors

**Testing Method:**

```javascript
// Manual testing in browser console
router.navigate('#/test1'); // Should show test1 content
router.navigate('#/test2'); // Should show test2 content
history.back(); // Should go back to test1
```

---

## Step 2: Page Manager Service (Days 3-4)

### Tasks

- [x] Create `src/app/core/page-manager.js` for page lifecycle management
- [x] Implement page loading, rendering, and cleanup
- [x] Add support for page modules with render/mount/unmount lifecycle
- [x] Create test page modules to verify functionality

### Implementation Details

**Page Manager Features:**

```javascript
// src/app/core/page-manager.js
class PageManager {
  constructor(contentContainer) {
    this.contentContainer = contentContainer;
    this.currentPage = null;
    this.currentPageModule = null;
  }

  // Page lifecycle
  async loadPage(pageModule, params = {}) {}
  async unloadCurrentPage() {}
  renderPageContent(html) {}

  // Page module interface
  async callPageMethod(method, ...args) {}

  // Utility
  updatePageTitle(title) {}
  updatePageMeta(meta) {}
}
```

**Test Page Module Interface:**

```javascript
// Test page module structure
export default {
  async render(params) {
    return `<div>Test Page: ${params.id || 'default'}</div>`;
  },

  async mount(container) {
    console.log('Test page mounted');
  },

  async unmount() {
    console.log('Test page unmounted');
  },

  getTitle() {
    return 'Test Page Title';
  },
};
```

### Deliverables

- Working page manager class in `src/app/core/page-manager.js`
- 2-3 test page modules demonstrating different scenarios
- Integration test showing router + page manager working together

### Success Metrics

- [x] **Page Loading**: Can load page modules dynamically using import()
- [x] **Lifecycle Management**: Calls render(), mount(), unmount() in correct order
- [x] **Content Rendering**: Page HTML renders correctly in content container
- [x] **Cleanup**: Previous page unmounts before new page mounts
- [x] **Parameter Passing**: Route parameters passed correctly to page modules
- [x] **Title Updates**: Document title updates when page changes
- [x] **Error Handling**: Graceful handling of page loading errors
- [x] **Memory Management**: No memory leaks when switching pages
- [x] **Router Integration**: Works seamlessly with router service

**Testing Method:**

```javascript
// Integration test
const pageManager = new PageManager(document.getElementById('content'));
const router = new AppRouter();

router.registerRoute('/test1', () => pageManager.loadPage(testPage1));
router.registerRoute('/test2', () => pageManager.loadPage(testPage2));
router.navigate('#/test1'); // Should load and mount test1
router.navigate('#/test2'); // Should unmount test1, load and mount test2
```

---

## Step 3: Integrated Core System (Day 5)

### Tasks

- [x] Create integrated test showing router + page manager working together
- [x] Add error handling and fallback mechanisms
- [x] Test edge cases (invalid routes, failed page loads, etc.)
- [x] Create mini-documentation for the core system

### Implementation Details

**Integration Test Setup:**

- Create `test-spa-core.html` demonstrating full system
- Include multiple test pages with different content
- Test navigation between pages
- Verify cleanup and lifecycle management

**Error Handling:**

- 404 page for invalid routes
- Error page for failed page loads
- Graceful degradation when modules fail to import

### Deliverables

- Complete integration test demonstrating core SPA functionality
- Error handling for common failure scenarios
- Basic documentation of the system architecture

### Success Metrics

- [x] **Full Navigation Flow**: Complete page-to-page navigation works flawlessly
- [x] **Error Recovery**: System handles errors gracefully without breaking
- [x] **Performance**: Page transitions happen smoothly without delays
- [x] **Browser Compatibility**: Works in modern browsers (Chrome, Firefox, Safari)
- [x] **Memory Efficiency**: No memory leaks during extended navigation testing
- [x] **State Preservation**: URL state maintained through browser refresh
- [x] **Concurrent Navigation**: Handles rapid navigation changes correctly

---

## Step 4: Application Shell Creation (Days 6-7)

### Tasks

- [x] Create `app.html` as the main SPA shell
- [x] Extract header/footer structure from existing pages
- [x] Import existing auth components and services
- [x] Set up content container for page rendering
- [x] Create main SPA entry point

### Implementation Details

**App Shell Structure:**

```html
<!-- app.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Our Kitchen Chronicles</title>
    <!-- Existing favicon and meta tags -->
    <script type="module" src="/src/app.js" defer></script>
  </head>
  <body>
    <!-- Existing header structure -->
    <header class="header-container">
      <!-- Copy from existing header with navigation links disabled -->
    </header>

    <!-- SPA content container -->
    <main id="spa-content" class="spa-content">
      <!-- Page content will be rendered here -->
    </main>

    <!-- Existing footer structure -->
    <footer>
      <!-- Copy from existing footer -->
    </footer>

    <!-- Existing auth components -->
    <auth-controller>
      <!-- Copy from existing auth setup -->
    </auth-controller>
  </body>
</html>
```

**Main Entry Point:**

```javascript
// src/app.js
import { initFirebase } from './js/services/firebase-service.js';
import firebaseConfig from './js/config/firebase-config.js';

// Initialize Firebase
initFirebase(firebaseConfig);

// Import existing components
import './lib/auth/auth-controller.js';
// ... other existing components

// Import SPA core
import { AppRouter } from './app/core/router.js';
import { PageManager } from './app/core/page-manager.js';

// Initialize SPA
document.addEventListener('DOMContentLoaded', initializeSPA);
```

### Deliverables

- Complete `app.html` with header/footer structure
- Main entry point (`src/app.js`) initializing the SPA
- Header with navigation links (initially disabled/placeholder)
- Working authentication components in SPA context

### Success Metrics

- [x] **Shell Loading**: `app.html` loads without errors
- [x] **Existing Components**: All existing auth components work in SPA context
- [x] **Styling**: Header/footer styling matches existing pages exactly
- [x] **Firebase Integration**: Firebase services initialize correctly
- [x] **Auth Flow**: Authentication components function normally
- [x] **Responsive Design**: Shell works on mobile and desktop
- [x] **Content Container**: SPA content area renders correctly
- [x] **Navigation Structure**: Header contains all navigation items (even if disabled)

**Testing Method:**

- Load `app.html` and verify no console errors
- Test authentication flow (login, logout, profile)
- Verify responsive behavior on different screen sizes
- Confirm styling matches existing site appearance

---

## Step 5: First Page Integration (Days 8-9)

### Tasks

- [x] Create first page module (`home-page.js`) using existing home page structure
- [x] Import existing home page components and services
- [x] Integrate page with router and page manager
- [x] Test complete flow from URL to rendered page

### Implementation Details

**Home Page Module:**

```javascript
// src/app/pages/home-page.js
import { FirestoreService } from '../../js/services/firestore-service.js';
import '../../lib/recipes/recipe-card/recipe-card.js';
import '../../lib/utilities/element-scroller/element-scroller.js';

export default {
  async render(params) {
    // Return HTML structure from existing index.html
    return `
      <section class="hero">
        <div>Discover homemade goodness in every bite</div>
      </section>
      
      <section class="quick-links">
        <h2>Explore Recipes</h2>
        <div class="category-jars">
          <!-- Category navigation -->
        </div>
      </section>
      
      <section class="featured-recipes">
        <h2>Recently Added</h2>
        <element-scroller id="featured-recipes-grid">
          <div slot="items"></div>
        </element-scroller>
      </section>
    `;
  },

  async mount(container) {
    // Initialize featured recipes using existing logic
    await this.loadFeaturedRecipes();
    this.setupCategoryNavigation();
  },

  async unmount() {
    // Cleanup if needed
  },

  getTitle() {
    return 'Our Kitchen Chronicles';
  },
};
```

**Integration Setup:**

```javascript
// In src/app.js
import homePageModule from './app/pages/home-page.js';

// Register home route
router.registerRoute('/home', () => pageManager.loadPage(homePageModule));
router.registerRoute('/', () => router.navigate('#/home')); // Default route
```

### Deliverables

- Working home page module with existing functionality
- Complete integration with router and page manager
- Featured recipes loading and displaying correctly
- Category navigation structure in place

### Success Metrics

- [x] **Page Loading**: Home page loads when navigating to `#/home`
- [x] **Content Rendering**: Page renders identically to existing home page
- [x] **Component Integration**: Featured recipes component works correctly
- [x] **Data Loading**: Recipe data loads using existing Firebase services
- [x] **Styling**: All existing CSS styles apply correctly
- [x] **Interactions**: Category links are present (even if not functional yet)
- [x] **Performance**: Page loads within reasonable time (< 2 seconds)
- [x] **Mobile Responsive**: Works correctly on mobile devices
- [x] **Error Handling**: Graceful handling of data loading failures

**Testing Method:**

- Navigate to `/app.html#/home` and verify page loads
- Check that featured recipes display with real data
- Verify page appearance matches existing home page
- Test on mobile device for responsiveness

---

## Overall Success Metrics

### Technical Metrics

- [x] **Zero Breaking Changes**: Existing site continues to work unchanged
- [x] **Performance**: SPA shell loads in < 2 seconds
- [x] **Memory Usage**: No memory leaks during navigation testing
- [x] **Error Rate**: < 1% error rate in console during normal usage
- [x] **Browser Support**: Works in Chrome, Firefox, Safari (latest versions)

### Functional Metrics

- [x] **Feature Parity**: Home page in SPA has same functionality as original
- [x] **Authentication**: All auth flows work in SPA context
- [x] **Navigation**: Smooth transitions between test pages
- [x] **URL Handling**: Proper URL updates and browser history support
- [x] **Responsive Design**: Works on desktop, tablet, and mobile

### Development Metrics

- [x] **Code Organization**: Clear separation between router, page manager, and pages
- [x] **Reusability**: Existing components work without modification
- [x] **Maintainability**: Code is well-documented and follows established patterns
- [x] **Testability**: Each component can be tested independently

---

## Risk Mitigation

### Technical Risks

1. **Component Compatibility**: Existing components may not work in SPA context

   - **Mitigation**: Test each component individually as it's integrated
   - **Fallback**: Keep original pages as backup during development

2. **Performance Issues**: Large JavaScript bundles

   - **Mitigation**: Use dynamic imports for page modules
   - **Monitoring**: Track bundle sizes during development

3. **Browser Compatibility**: Modern JavaScript features
   - **Mitigation**: Use Vite's built-in transpilation
   - **Testing**: Test on multiple browsers regularly

### Development Risks

1. **Scope Creep**: Trying to migrate too much at once

   - **Mitigation**: Stick strictly to defined steps and success metrics
   - **Review**: Regular checkpoints to ensure step completion

2. **Integration Complexity**: Existing services not working in SPA
   - **Mitigation**: Test each service integration thoroughly
   - **Documentation**: Clear documentation of any required changes

---

## Next Steps After Phase 1

Once this foundation is complete:

1. **Page Migration**: Migrate remaining pages one by one
2. **Navigation Activation**: Enable header links as pages are migrated
3. **Performance Optimization**: Implement code splitting and caching
4. **History API Migration**: Upgrade from hash routing to clean URLs
5. **Advanced Features**: Add page transitions, preloading, etc.

---

## Testing Strategy

### Manual Testing Checklist

- [x] Load `app.html` without errors
- [x] Navigate between test routes using URL bar
- [x] Use browser back/forward buttons
- [x] Test on mobile device
- [x] Verify authentication flows work
- [x] Check home page functionality matches original

### Automated Testing (Future)

- Unit tests for router and page manager
- Integration tests for complete navigation flows
- Performance tests for page load times
- Cross-browser compatibility tests

---

## Documentation Requirements

### Code Documentation

- [x] README with setup instructions
- [x] API documentation for router and page manager
- [x] Code comments explaining complex logic
- [x] Examples of page module creation

### Architecture Documentation

- [x] System overview diagram
- [x] Data flow documentation
- [x] Integration points with existing system
- [x] Migration path for remaining pages
