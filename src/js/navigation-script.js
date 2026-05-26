import { icons } from './icons.js';
import '../lib/utilities/app-drawer/app-drawer.js';

// Module-scope DOM element references
let navToggle = null;
let mobileDrawer = null;

function initializeNavigation() {
  // Cache DOM element references
  navToggle = document.querySelector('.nav-toggle');

  if (window.innerWidth <= 768) {
    createMobileDrawer();
  }

  if (navToggle) {
    navToggle.addEventListener('click', toggleMobileDrawer);
  }

  window.addEventListener('resize', handleResize);

  initializeSPANavigation();
}

function createMobileDrawer() {
  if (mobileDrawer) return;

  mobileDrawer = document.createElement('app-drawer');
  mobileDrawer.setAttribute('drawer-class', 'mobile-nav-drawer');
  mobileDrawer.setAttribute('backdrop-class', 'mobile-nav-backdrop');
  mobileDrawer.setAttribute('active-class', 'active');
  mobileDrawer.setAttribute('position', 'end');

  mobileDrawer.addEventListener('app-drawer-open', () => {
    if (navToggle) navToggle.classList.add('active', 'drawer-open');
  });
  mobileDrawer.addEventListener('app-drawer-close', () => {
    if (navToggle) navToggle.classList.remove('active', 'drawer-open');
  });

  // 1. Drawer Head
  const drawerHeader = document.createElement('div');
  drawerHeader.className = 'drawer-head';

  const brand = document.createElement('a');
  brand.className = 'drawer-brand';
  brand.href = '/home';
  brand.innerHTML = `
    <div class="words">Our Kitchen <em>Chronicles</em></div>
  `;
  brand.addEventListener('click', (e) => {
    e.preventDefault();
    if (window.spa && window.spa.router) {
      window.spa.router.navigate('/home');
      closeMobileDrawer();
    }
  });

  const drawerClose = document.createElement('button');
  drawerClose.className = 'drawer-close';
  drawerClose.setAttribute('aria-label', 'Close menu');
  drawerClose.addEventListener('click', closeMobileDrawer);

  drawerHeader.appendChild(brand);
  drawerHeader.appendChild(drawerClose);
  mobileDrawer.appendChild(drawerHeader);

  // 2. Index Label
  const drawerIdx = document.createElement('div');
  drawerIdx.className = 'drawer-idx';
  drawerIdx.textContent = 'תפריט';
  mobileDrawer.appendChild(drawerIdx);

  // Navigation will be inserted here by syncMobileDrawerNavigation

  // 3. Drawer Foot
  const drawerFoot = document.createElement('div');
  drawerFoot.className = 'drawer-foot';
  drawerFoot.innerHTML = ``;
  mobileDrawer.appendChild(drawerFoot);

  document.body.appendChild(mobileDrawer);

  syncMobileDrawerNavigation();

  document.addEventListener('auth-state-changed', syncMobileDrawerNavigation);

  const headerNav = document.querySelector('header nav');
  if (headerNav) {
    const observer = new MutationObserver(syncMobileDrawerNavigation);
    observer.observe(headerNav, {
      childList: true,
      subtree: true,
    });

    mobileDrawer._navObserver = observer;
  }
}

function syncMobileDrawerNavigation() {
  if (!mobileDrawer) return;

  const headerNav = document.querySelector('header nav');
  if (!headerNav) return;

  const existingNav = mobileDrawer.querySelector('nav');
  if (existingNav) {
    existingNav.remove();
  }

  const drawerNav = headerNav.cloneNode(true);

  // Map icons to links
  const iconMap = [
    { key: 'favorites=true', icon: 'heart' },
    { key: '/grandmas-cooking', icon: 'archive' },
    { key: '/dashboard', icon: 'userShield' },
    { key: '/home', icon: 'home' },
    { key: '/categories', icon: 'bookOpen' },
    { key: '/propose-recipe', icon: 'plusCircle' },
    { key: '/my-meal', icon: 'utensils' },
  ];

  const navLinks = drawerNav.querySelectorAll('a');
  navLinks.forEach((link) => {
    try {
      const url = new URL(link.href);
      const path = url.pathname;
      const search = url.search;

      let iconKey = 'link';

      for (const item of iconMap) {
        if (item.key.includes('=') && search.includes(item.key)) {
          iconKey = item.icon;
          break;
        } else if (path === item.key) {
          iconKey = item.icon;
          break;
        }
      }

      const iconSpan = document.createElement('span');
      iconSpan.className = 'ico';
      iconSpan.innerHTML = icons[iconKey] ?? icons.link;
      link.prepend(iconSpan);
    } catch (e) {
      console.warn('Invalid link in drawer:', link.href);
    }
  });

  // Insert before the footer
  const drawerFoot = mobileDrawer.querySelector('.drawer-foot');
  mobileDrawer.insertBefore(drawerNav, drawerFoot);
}

function toggleMobileDrawer() {
  if (!mobileDrawer) return;
  if (!mobileDrawer.isOpen) {
    mobileDrawer.open();
  }
}

function closeMobileDrawer() {
  if (!mobileDrawer) return;
  mobileDrawer.close();
}

function handleResize() {
  const isMobile = window.innerWidth <= 768;

  if (isMobile && !mobileDrawer) {
    createMobileDrawer();
  } else if (!isMobile && mobileDrawer) {
    closeMobileDrawer();
    if (mobileDrawer._navObserver) {
      mobileDrawer._navObserver.disconnect();
    }
    document.removeEventListener('auth-state-changed', syncMobileDrawerNavigation);
    mobileDrawer.remove();
    mobileDrawer = null;
  }
}

function initializeSPANavigation() {
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a');

    if (link && link.href && isInternalLink(link)) {
      if (
        e.defaultPrevented || // Event already handled
        e.button !== 0 || // Not a left click (middle/right click)
        e.metaKey || // Cmd/Meta key (Mac)
        e.ctrlKey || // Ctrl key (Windows/Linux)
        e.shiftKey || // Shift key
        e.altKey // Alt key
      ) {
        return;
      }

      e.preventDefault();

      const url = new URL(link.href);
      const fullPath = url.pathname + url.search;

      if (window.spa && window.spa.router) {
        window.spa.router.navigate(fullPath);
        closeHamburgerMenuIfOpen();
        setTimeout(updateActiveNavigation, 100);
      } else {
        console.warn('SPA router not available, falling back to default navigation');
        window.location.href = link.href;
      }
    }
  });

  updateActiveNavigation();

  window.addEventListener('popstate', updateActiveNavigation);

  window.addEventListener('spa-navigation', () => {
    setTimeout(updateActiveNavigation, 100);
  });

  document.addEventListener('submit', (e) => {
    if (e.target.classList.contains('search-form')) {
      closeHamburgerMenuIfOpen();
    }
  });
}

function closeHamburgerMenuIfOpen() {
  if (mobileDrawer && mobileDrawer.classList.contains('active')) {
    closeMobileDrawer();
  }
}

function updateActiveNavigation() {
  const currentPath = window.location.pathname;

  const navLinks = document.querySelectorAll('header nav a, .mobile-nav-drawer nav a');

  navLinks.forEach((link) => {
    link.classList.remove('active');

    try {
      const linkUrl = new URL(link.href);
      const linkPath = linkUrl.pathname;

      const linkSearchParams = linkUrl.search;
      const currentSearchParams = window.location.search;
      const currentUrlParams = new URLSearchParams(currentSearchParams);
      const linkUrlParams = new URLSearchParams(linkSearchParams);

      const pathMatches =
        linkPath === currentPath ||
        (linkPath === '/home' && currentPath === '/') ||
        (linkPath === '/' && currentPath === '/home');

      let shouldBeActive = false;

      if (pathMatches) {
        if (linkPath === '/categories') {
          if (linkUrlParams.has('favorites')) {
            shouldBeActive = currentUrlParams.get('favorites') === 'true';
          } else {
            shouldBeActive =
              !currentUrlParams.has('favorites') || currentUrlParams.get('favorites') !== 'true';
          }
        } else {
          shouldBeActive = linkSearchParams === currentSearchParams;
        }
      }

      if (shouldBeActive) {
        link.classList.add('active');
      }
    } catch (e) {
      console.warn('Invalid navigation link URL:', link.href);
    }
  });
}

function isInternalLink(link) {
  // Check if link is internal (same origin and starts with /)
  try {
    const linkUrl = new URL(link.href);
    const currentUrl = new URL(window.location.href);

    return (
      linkUrl.origin === currentUrl.origin &&
      linkUrl.pathname.startsWith('/') &&
      !linkUrl.pathname.startsWith('/api') &&
      !link.hasAttribute('target') &&
      !link.download
    );
  } catch (e) {
    return false;
  }
}

// Generic navigation interceptor for pages
class NavigationInterceptor {
  constructor() {
    this.handlers = new Map();
  }

  addHandler(selector, callback) {
    const handler = (event) => {
      const link = event.target.closest(selector);
      if (!link) return;

      // Allow browser default behavior for modifier keys and non-left clicks
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const currentRoute = window.spa?.router?.getCurrentRoute();
      if (currentRoute === '/categories') {
        event.preventDefault();
        callback(event, link);
      }
    };

    this.handlers.set(selector, handler);
    document.addEventListener('click', handler, true);
  }

  removeHandler(selector) {
    const handler = this.handlers.get(selector);
    if (handler) {
      document.removeEventListener('click', handler, true);
      this.handlers.delete(selector);
    }
  }

  removeAllHandlers() {
    this.handlers.forEach((handler, selector) => {
      document.removeEventListener('click', handler, true);
    });
    this.handlers.clear();
  }
}

// Make functions available globally for other components
window.updateActiveNavigation = updateActiveNavigation;
window.closeHamburgerMenuIfOpen = closeHamburgerMenuIfOpen;
window.closeMobileDrawer = closeMobileDrawer;
window.syncMobileDrawerNavigation = syncMobileDrawerNavigation;
window.NavigationInterceptor = NavigationInterceptor;

// Initialize immediately if DOM is ready, otherwise wait for it
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeNavigation);
} else {
  initializeNavigation();
}
