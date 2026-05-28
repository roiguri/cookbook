/**
 * @fileoverview Main entry point for the Cookbook Single Page Application (SPA).
 * This file handles the initialization of the application, including:
 * - Firebase service initialization
 * - Core dependency loading (Auth, Search, etc.)
 * - Router and PageManager setup
 * - Route registration with code splitting (dynamic imports)
 */

import './styles/main.css';

// Register Service Worker for PWA functionality
import './js/sw-register.js';

import { initLogger, captureError } from './js/services/logger.js';
import { initFirebase } from './js/services/_firebase/firebase-service.js';
import firebaseConfig from './js/config/firebase-config.js';
import authService from './js/services/auth/auth-service.js';

// Import SPA core
import { AppRouter } from './app/core/router.js';
import { PageManager } from './app/core/page-manager.js';

// Initialize SPA when DOM is ready
document.addEventListener('DOMContentLoaded', initializeSPA);

/**
 * Initializes the SPA application when the DOM is ready.
 * Sets up Firebase, preloads essential components, and starts the router.
 */
async function initializeSPA() {
  // Initialize logger first so Firebase init errors below are captured.
  initLogger();

  try {
    initFirebase(firebaseConfig);

    // Start loading supplemental components and the most common first route in parallel
    Promise.all([
      import('./app/pages/home-page.js'),
      import('./lib/auth/auth-controller.js'),
      import('./lib/auth/components/auth-avatar.js'),
      import('./lib/auth/components/auth-content.js'),
      import('./lib/search/header-search-bar/header-search-bar.js'),
    ]).catch((err) => console.warn('Failed to preload supplemental components:', err));

    // Wait for critical nav components and auth state to resolve, then remove the shimmer
    Promise.all([
      customElements.whenDefined('header-search-bar'),
      customElements.whenDefined('auth-avatar'),
      customElements.whenDefined('auth-controller'),
      authService.waitForAuth(),
    ]).then(() => {
      requestAnimationFrame(() => {
        const header = document.querySelector('header.app-loading');
        if (header) {
          header.classList.remove('app-loading');
        }
      });
    });

    // Await components critical for the UI shell to avoid race conditions
    // (e.g., navigation-script handles link interception which the router depends on)
    await import('./js/navigation-script.js');

    // Easter egg: rapid-tap the brand logo to unlock the mini-games page.
    // Non-blocking — the user can't tap 7 times before this resolves, so we
    // don't gate SPA initialization on it.
    import('./lib/easter-egg/games-unlock.js').then(({ initGamesUnlock }) => initGamesUnlock());

    const contentContainer = document.getElementById('spa-content');
    if (!contentContainer) {
      throw new Error('SPA content container not found');
    }

    const router = new AppRouter();
    const pageManager = new PageManager(contentContainer);

    window.spa = { router, pageManager };

    registerRoutes(router, pageManager);
    router.initialize();
  } catch (error) {
    console.error('Failed to initialize SPA:', error);
    captureError(error, { service: 'spa-init', level: 'fatal' });
    showInitializationError(error);
  }
}

/**
 * Registers application routes and configures code splitting for pages.
 * Each route uses dynamic imports to lazily load the page module only when requested.
 *
 * @param {AppRouter} router - The application router instance
 * @param {PageManager} pageManager - The page manager instance for rendering pages
 */
function registerRoutes(router, pageManager) {
  router.registerRoute('/home', async (params) => {
    // Dynamic import ensures home-page chunk is loaded only when needed
    const module = await import('./app/pages/home-page.js');
    await pageManager.loadPage(module.default || module, {
      ...params,
      route: '/home',
    });
  });

  router.registerRoute('/categories', async (params) => {
    const module = await import('./app/pages/categories-page.js');
    await pageManager.loadPage(module.default || module, {
      ...params,
      route: '/categories',
    });
  });

  router.registerRoute('/recipe/:id', async (params) => {
    const module = await import('./app/pages/recipe-detail-page.js');
    await pageManager.loadPage(module.default || module, {
      ...params,
      route: '/recipe/:id',
    });
  });

  router.registerRoute('/propose-recipe', async (params) => {
    const module = await import('./app/pages/propose-recipe-page.js');
    await pageManager.loadPage(module.default || module, {
      ...params,
      route: '/propose-recipe',
    });
  });

  router.registerRoute('/grandmas-cooking', async (params) => {
    const module = await import('./app/pages/documents-page.js');
    await pageManager.loadPage(module.default || module, {
      ...params,
      route: '/grandmas-cooking',
    });
  });

  router.registerRoute('/dashboard', async (params) => {
    const module = await import('./app/pages/manager-dashboard-page.js');
    await pageManager.loadPage(module.default || module, {
      ...params,
      route: '/dashboard',
    });
  });

  router.registerRoute('/my-meal', async (params) => {
    const module = await import('./app/pages/my-meal-page.js');
    await pageManager.loadPage(module.default || module, {
      ...params,
      route: '/my-meal',
    });
  });

  router.registerRoute('/games', async (params) => {
    const module = await import('./app/pages/games-page.js');
    await pageManager.loadPage(module.default || module, {
      ...params,
      route: '/games',
    });
  });
}

function showInitializationError(error) {
  const contentContainer = document.getElementById('spa-content');
  if (contentContainer) {
    contentContainer.innerHTML = `
      <div style="padding: 2rem; text-align: center; color: #d32f2f;">
        <h2>Application Failed to Load</h2>
        <p>Sorry, there was an error initializing the application.</p>
        <details style="margin-top: 1rem; text-align: left; max-width: 600px; margin-left: auto; margin-right: auto;">
          <summary>Error Details</summary>
          <pre style="background: #f5f5f5; padding: 1rem; border-radius: 4px; overflow: auto;">${error.message}</pre>
        </details>
        <button onclick="window.location.reload()" style="margin-top: 1rem; padding: 0.5rem 1rem; background: #d32f2f; color: white; border: none; border-radius: 4px; cursor: pointer;">
          Reload Application
        </button>
      </div>
    `;
  }
}
