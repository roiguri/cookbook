/**
 * Dashboard Refresh Manager
 * Centralized utility for managing dashboard section refreshes with loading states
 */

export const DASHBOARD_SECTIONS = {
  USERS: 'users',
  ALL_RECIPES: 'all-recipes',
  PENDING_RECIPES: 'pending-recipes',
  PENDING_EDITS: 'pending-edits',
  PENDING_IMAGES: 'pending-images',
  IMAGE_ENHANCEMENT: 'image-enhancement',
  FAILED_URLS: 'failed-urls',
};

export class DashboardRefreshManager {
  constructor(dashboardController) {
    this.controller = dashboardController;
    this.loadingStates = new Map();
    this.refreshIconElements = new Map();
  }

  /**
   * Register a refresh icon element for a specific section
   * @param {string} section - Section identifier from DASHBOARD_SECTIONS
   * @param {HTMLElement} iconElement - The refresh icon DOM element
   */
  registerIcon(section, iconElement) {
    this.refreshIconElements.set(section, iconElement);
  }

  /**
   * Set loading state for a section's refresh icon
   * @param {string} section - Section identifier
   * @param {boolean} isLoading - Whether the section is loading
   */
  setLoading(section, isLoading) {
    this.loadingStates.set(section, isLoading);
    const icon = this.refreshIconElements.get(section);
    if (icon) {
      if (isLoading) {
        icon.classList.add('spinning');
        icon.style.pointerEvents = 'none';
      } else {
        icon.classList.remove('spinning');
        icon.style.pointerEvents = 'auto';
      }
    }
  }

  /**
   * Set loading state for master refresh icon
   * @param {boolean} isLoading - Whether any section is loading
   */
  setMasterLoading(isLoading) {
    const masterIcon = this.refreshIconElements.get('master');
    if (masterIcon) {
      if (isLoading) {
        masterIcon.classList.add('spinning');
        masterIcon.style.pointerEvents = 'none';
      } else {
        masterIcon.classList.remove('spinning');
        masterIcon.style.pointerEvents = 'auto';
      }
    }
  }

  /**
   * Refresh specific dashboard sections
   * @param {string[]} sections - Array of section identifiers to refresh
   * @param {number} delay - Optional delay in milliseconds before refresh
   * @returns {Promise<void>}
   */
  async refreshDashboards(sections = [], delay = 0) {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const refreshPromises = sections.map(async (section) => {
      this.setLoading(section, true);
      try {
        await this._refreshSection(section);
      } catch (error) {
        console.error(`Error refreshing ${section}:`, error);
      } finally {
        this.setLoading(section, false);
      }
    });

    await Promise.all(refreshPromises);
  }

  /**
   * Refresh all dashboard sections
   * @returns {Promise<void>}
   */
  async refreshAll() {
    const allSections = Object.values(DASHBOARD_SECTIONS);
    this.setMasterLoading(true);

    try {
      await this.refreshDashboards(allSections);
    } finally {
      this.setMasterLoading(false);
    }
  }

  /**
   * Internal method to refresh a specific section
   * @param {string} section - Section identifier
   * @returns {Promise<void>}
   * @private
   */
  async _refreshSection(section) {
    switch (section) {
      case DASHBOARD_SECTIONS.USERS:
        await this.controller.loadUserList();
        break;
      case DASHBOARD_SECTIONS.ALL_RECIPES:
        await this.controller.loadAllRecipes();
        break;
      case DASHBOARD_SECTIONS.PENDING_RECIPES:
        await this.controller.loadPendingRecipes();
        break;
      case DASHBOARD_SECTIONS.PENDING_EDITS:
        await this.controller.loadPendingEdits();
        break;
      case DASHBOARD_SECTIONS.PENDING_IMAGES:
        await this.controller.loadPendingImages();
        break;
      case DASHBOARD_SECTIONS.IMAGE_ENHANCEMENT:
        await this.controller.loadImageEnhancement();
        break;
      case DASHBOARD_SECTIONS.FAILED_URLS:
        await this.controller.loadFailedUrls();
        break;
      default:
        console.warn(`Unknown section: ${section}`);
    }
  }

  /**
   * Convenience method: Refresh recipe-related sections (All + Pending)
   * @param {number} delay - Optional delay in milliseconds
   * @returns {Promise<void>}
   */
  async refreshRecipes(delay = 0) {
    await this.refreshDashboards(
      [
        DASHBOARD_SECTIONS.ALL_RECIPES,
        DASHBOARD_SECTIONS.PENDING_RECIPES,
        DASHBOARD_SECTIONS.IMAGE_ENHANCEMENT,
      ],
      delay,
    );
  }

  /**
   * Convenience method: Refresh only pending edits
   * @param {number} delay - Optional delay in milliseconds
   * @returns {Promise<void>}
   */
  async refreshPendingEdits(delay = 0) {
    await this.refreshDashboards([DASHBOARD_SECTIONS.PENDING_EDITS], delay);
  }

  /**
   * Convenience method: Refresh image-related sections
   * @param {number} delay - Optional delay in milliseconds
   * @returns {Promise<void>}
   */
  async refreshImages(delay = 0) {
    await this.refreshDashboards(
      [
        DASHBOARD_SECTIONS.ALL_RECIPES,
        DASHBOARD_SECTIONS.PENDING_IMAGES,
        DASHBOARD_SECTIONS.IMAGE_ENHANCEMENT,
      ],
      delay,
    );
  }

  /**
   * Convenience method: Refresh only pending images
   * @param {number} delay - Optional delay in milliseconds
   * @returns {Promise<void>}
   */
  async refreshPendingImages(delay = 0) {
    await this.refreshDashboards([DASHBOARD_SECTIONS.PENDING_IMAGES], delay);
  }
}
