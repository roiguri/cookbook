/**
 * App Drawer Component
 * @class
 * @extends HTMLElement
 *
 * @description
 * A reusable light-DOM drawer/sidebar element. It owns lifecycle (open/close,
 * scroll lock, backdrop, Escape key) but is "headless" w.r.t. styling — the
 * consumer supplies the class names applied to the drawer host, the backdrop,
 * and the active state, so that any existing CSS keeps working unchanged.
 *
 * The backdrop is created as a sibling appended to <body> so the drawer's own
 * `overflow: hidden` cannot clip it.
 *
 * @example
 * <app-drawer
 *   drawer-class="mobile-nav-drawer"
 *   backdrop-class="mobile-nav-backdrop"
 *   active-class="active"
 *   position="end">
 *   <!-- arbitrary content -->
 * </app-drawer>
 *
 * const drawer = document.querySelector('app-drawer');
 * drawer.open();
 * drawer.addEventListener('app-drawer-open', () => {});
 * drawer.addEventListener('app-drawer-close', () => {});
 *
 * @attr {string} drawer-class - Class name applied to the host element.
 * @attr {string} backdrop-class - Class name applied to the backdrop element.
 * @attr {string} active-class - Class added to host + backdrop when open (default: "active").
 * @attr {"start"|"end"} position - Hint for which side the drawer sits on. Used only as a data-* hook for CSS; the component does not enforce positioning.
 * @attr {boolean} close-on-backdrop - If present, backdrop click closes the drawer (default: true unless attribute === "false").
 * @attr {boolean} close-on-escape - If present, Escape key closes the drawer (default: true unless attribute === "false").
 * @attr {boolean} lock-scroll - If present, document.body scroll is locked while open (default: true unless attribute === "false").
 *
 * @fires app-drawer-open - When the drawer opens.
 * @fires app-drawer-close - When the drawer closes.
 */
class AppDrawer extends HTMLElement {
  constructor() {
    super();
    this._backdrop = null;
    this._previouslyFocused = null;
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onBackdropClick = this._onBackdropClick.bind(this);
  }

  connectedCallback() {
    const drawerClass = this.getAttribute('drawer-class');
    if (drawerClass) {
      drawerClass
        .split(/\s+/)
        .filter(Boolean)
        .forEach((c) => this.classList.add(c));
    }

    const position = this.getAttribute('position');
    if (position) {
      this.dataset.position = position;
    }

    this._backdrop = document.createElement('div');
    const backdropClass = this.getAttribute('backdrop-class');
    if (backdropClass) {
      backdropClass
        .split(/\s+/)
        .filter(Boolean)
        .forEach((c) => this._backdrop.classList.add(c));
    }
    this._backdrop.addEventListener('click', this._onBackdropClick);
    document.body.appendChild(this._backdrop);

    document.addEventListener('keydown', this._onKeyDown);
  }

  disconnectedCallback() {
    if (this._backdrop) {
      this._backdrop.removeEventListener('click', this._onBackdropClick);
      this._backdrop.remove();
      this._backdrop = null;
    }
    document.removeEventListener('keydown', this._onKeyDown);
    if (this._lockedScroll) {
      document.body.style.overflow = '';
      this._lockedScroll = false;
    }
  }

  get isOpen() {
    return this.classList.contains(this._activeClass());
  }

  open() {
    if (this.isOpen) return;
    const active = this._activeClass();
    this.classList.add(active);
    if (this._backdrop) this._backdrop.classList.add(active);

    if (this._boolAttr('lock-scroll', true)) {
      document.body.style.overflow = 'hidden';
      this._lockedScroll = true;
    }

    this._previouslyFocused = document.activeElement;
    this.dispatchEvent(new CustomEvent('app-drawer-open', { bubbles: true, composed: true }));
  }

  close() {
    if (!this.isOpen) return;
    const active = this._activeClass();
    this.classList.remove(active);
    if (this._backdrop) this._backdrop.classList.remove(active);

    if (this._lockedScroll) {
      document.body.style.overflow = '';
      this._lockedScroll = false;
    }

    if (
      this._previouslyFocused &&
      typeof this._previouslyFocused.focus === 'function' &&
      document.contains(this._previouslyFocused)
    ) {
      this._previouslyFocused.focus();
    }
    this._previouslyFocused = null;

    this.dispatchEvent(new CustomEvent('app-drawer-close', { bubbles: true, composed: true }));
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  _activeClass() {
    return this.getAttribute('active-class') || 'active';
  }

  _boolAttr(name, defaultValue) {
    if (!this.hasAttribute(name)) return defaultValue;
    const v = this.getAttribute(name);
    return !(v === 'false' || v === '0');
  }

  _onBackdropClick() {
    if (this._boolAttr('close-on-backdrop', true)) {
      this.close();
    }
  }

  _onKeyDown(e) {
    if (e.key === 'Escape' && this.isOpen && this._boolAttr('close-on-escape', true)) {
      this.close();
    }
  }
}

if (!customElements.get('app-drawer')) {
  customElements.define('app-drawer', AppDrawer);
}

export default AppDrawer;
