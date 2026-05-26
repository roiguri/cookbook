import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { forceLazyImages } from '../utils/test-helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Home Page Sanity', () => {
  test.beforeEach(async ({ page }) => {
    // Read the browser-compatible mock files
    const mockFirestorePath = path.resolve(
      __dirname,
      '../../common/mocks/firestore-service.browser.js',
    );
    const mockFirestoreContent = fs.readFileSync(mockFirestorePath, 'utf8');
    const mockStoragePath = path.resolve(
      __dirname,
      '../../common/mocks/storage-service.browser.js',
    );
    const mockStorageContent = fs.readFileSync(mockStoragePath, 'utf8');

    // Mock FirestoreService — use RegExp to match Vite's timestamped URLs (e.g. ?t=123)
    await page.route(/\/src\/js\/services\/_firebase\/firestore-service\.js/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: mockFirestoreContent,
      });
    });

    // Mock StorageService — use RegExp to match Vite's timestamped URLs (e.g. ?t=123)
    await page.route(/\/src\/js\/services\/_firebase\/storage-service\.js/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: mockStorageContent,
      });
    });

    // Debug: Log browser console messages
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));

    await page.goto('/');
  });

  test('loads the home page and key elements', async ({ page }) => {
    // Check page title
    await expect(page).toHaveTitle(/Kitchen Chronicles/);

    // Verify Header
    const header = page.locator('.header-container');
    await expect(header).toBeVisible();

    // Verify Main Content Area
    const main = page.locator('main');
    await expect(main).toBeVisible();

    // Verify Recipe Feed
    const recipeList = page.locator('#featured-recipes-strip');
    await expect(recipeList).toBeVisible();
  });

  test('visual snapshot of home page', async ({ page }) => {
    // Wait for content
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#featured-recipes-strip')).toBeVisible();

    // Wait for at least one recipe card to ensure feed is populated
    // This confirms our mock data is working and rendering
    await page
      .locator('recipe-card')
      .first()
      .waitFor({ timeout: 5000 })
      .catch(() => {
        console.log('No recipe cards found - check mock injection');
      });

    // FORCE LOAD LAZY IMAGES using helper
    await forceLazyImages(page);

    // Give a grace period for images/layout to settle
    await page.waitForTimeout(3000);

    // Take a full page snapshot
    await expect(page).toHaveScreenshot('home-page-desktop.png', { fullPage: true });
  });
});
