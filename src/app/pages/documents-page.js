import { UserService } from '../../js/services/users/user-service.js';
import authService from '../../js/services/auth/auth-service.js';
import { AppConfig } from '../../js/config/app-config.js';
import '../../styles/pages/documents-spa.css';
import '../../styles/components/pdf-toc-drawer.css';

export default {
  async render(params) {
    const response = await fetch(new URL('./documents-page.html', import.meta.url));
    if (!response.ok) {
      throw new Error(
        `Failed to load documents page template: ${response.status} ${response.statusText}`,
      );
    }
    return await response.text();
  },

  async mount(container, params) {
    // Wait for authentication to be ready and check access permissions
    const currentUser = await authService.waitForAuth();
    if (!currentUser) {
      this.redirectToHome();
      return;
    }

    const hasAccess = await this.checkDocumentAccessStatus(currentUser);
    if (!hasAccess) {
      this.redirectToHome();
      return;
    }

    await this.importComponents();
    this.setupAuthListener();
  },

  async unmount() {
    if (this.authUnsubscribe) {
      this.authUnsubscribe();
    }
  },

  getTitle() {
    return AppConfig.getPageTitle('ספר המתכונים של סבתא');
  },

  getMeta() {
    return {
      description: 'ספר המתכונים המקורי של סבתא - אוסף מתכונים משפחתיים עתיקים',
      keywords: 'ספר מתכונים, מתכונים של סבתא, מתכונים משפחתיים, מתכונים עתיקים',
    };
  },

  async importComponents() {
    await import('../../lib/utilities/pdf_viewer/pdf_viewer.js');
    await import('../../lib/utilities/modal/modal.js');
  },

  async checkDocumentAccessStatus(user) {
    try {
      const userDoc = await UserService.get(user.uid);
      if (userDoc) {
        const userRole = userDoc.role;
        return userRole === 'manager' || userRole === 'approved';
      }
      return false;
    } catch (error) {
      console.error('Error checking document access status:', error);
      return false;
    }
  },

  redirectToHome() {
    // Use SPA navigation to redirect to home
    if (window.spa && window.spa.router) {
      window.spa.router.navigate('/home');
    } else {
      // Fallback to traditional redirect
      window.location.href = '/';
    }
  },

  setupAuthListener() {
    // Listen for auth state changes to detect logout
    this.authUnsubscribe = authService.onAuthStateChanged((user) => {
      if (!user) {
        // User logged out, redirect to home
        this.redirectToHome();
      }
    });
  },
};
