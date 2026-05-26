import { PdfService } from '../../../js/services/pdf/pdf-service.js';
import '../app-drawer/app-drawer.js';

class PDFViewer extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.pdfPath = this.getAttribute('pdf-path');
    this.currentPage = this.getAttribute('start-page') || 1;
    this.totalPages = parseInt(this.getAttribute('total-pages')) || 92;
    this.isFullPage = false;
    this._tocDrawer = null;
    this._mq = window.matchMedia('(max-width: 768px)');
    this._isMobile = this._mq.matches;
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this._onMqChange = this._onMqChange.bind(this);
  }

  async connectedCallback() {
    this.hasPageIndex = this.hasAttribute('page-index');

    if (this.hasPageIndex) {
      this.pageIndex = await this.fetchPageIndex();
      if (this.pageIndex && this.pageIndex.categories) {
        this.categories = Object.keys(this.pageIndex.categories);
      } else {
        this.categories = [];
      }
    }

    this.render();
    this.addEventListeners();
    this.updateImage(this.currentPage);
    window.addEventListener('keydown', this.handleKeyDown);
    if (this._mq.addEventListener) {
      this._mq.addEventListener('change', this._onMqChange);
    } else if (this._mq.addListener) {
      this._mq.addListener(this._onMqChange);
    }
  }

  disconnectedCallback() {
    window.removeEventListener('keydown', this.handleKeyDown);
    if (this._mq.removeEventListener) {
      this._mq.removeEventListener('change', this._onMqChange);
    } else if (this._mq.removeListener) {
      this._mq.removeListener(this._onMqChange);
    }
    if (this.isFullPage) {
      document.body.style.overflow = '';
    }
    if (this._tocDrawer) {
      this._tocDrawer.remove();
      this._tocDrawer = null;
    }
  }

  handleKeyDown(e) {
    if (!this.isFullPage) return;

    switch (e.key) {
      case 'Escape':
        this.toggleFullPage();
        break;
      case 'ArrowRight':
        this.goToPage(this.currentPage - 1); // Previous in RTL
        break;
      case 'ArrowLeft':
        this.goToPage(this.currentPage + 1); // Next in RTL
        break;
    }
  }

  toggleFullPage() {
    this.isFullPage = !this.isFullPage;
    const container = this.shadowRoot.querySelector('.pdf_viewer');

    if (this.isFullPage) {
      container.classList.add('full-page');
      document.body.style.overflow = 'hidden';
    } else {
      container.classList.remove('full-page');
      document.body.style.overflow = '';
    }
  }

  async fetchPageIndex() {
    try {
      const [collectionName, fileName] = this.getAttribute('page-index').split('/');
      const data = await PdfService.getPageIndex(collectionName, fileName);
      return data || {};
    } catch (error) {
      console.error('Error fetching page index:', error);
      return {};
    }
  }

  _buildTocHtml() {
    if (!this.hasPageIndex || !this.pageIndex || !this.pageIndex.categories) return '';

    const recipesByCategory = new Map();
    for (const name of this.categories) recipesByCategory.set(name, []);

    if (this.pageIndex.recipes) {
      for (const [recipeName, pageNumber] of Object.entries(this.pageIndex.recipes)) {
        const cat = this.getCategoryForPage(pageNumber);
        if (cat && recipesByCategory.has(cat)) {
          recipesByCategory.get(cat).push({ name: recipeName, page: Number(pageNumber) });
        }
      }
    }

    const escapeHtml = (s) =>
      String(s).replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
      );

    const items = this.categories
      .map((catName) => {
        const range = this.pageIndex.categories[catName];
        const recipes = (recipesByCategory.get(catName) || []).sort((a, b) => a.page - b.page);
        const recipesHtml = recipes
          .map(
            (r) =>
              `<li><button type="button" class="toc__recipe" data-page="${r.page}" data-name="${escapeHtml(r.name.toLowerCase())}">${escapeHtml(r.name)}<span class="toc__page">${r.page}</span></button></li>`,
          )
          .join('');
        return `
          <details class="toc__cat" data-name="${escapeHtml(catName.toLowerCase())}" open>
            <summary class="toc__summary">
              <span class="toc__cat-name">${escapeHtml(catName)}</span>
              <span class="toc__cat-range">${range.startPage}–${range.endPage}</span>
            </summary>
            <ul class="toc__list">${recipesHtml}</ul>
          </details>
        `;
      })
      .join('');

    return `
      <div class="toc__head">
        <label class="toc__search-label" for="toc-search">
          <input id="toc-search" type="search" class="toc__search" placeholder="חיפוש מתכון או קטגוריה...">
        </label>
      </div>
      <div class="toc__body">${items}</div>
    `;
  }

  _buildSidebarHtml() {
    if (!this.hasPageIndex) return '';
    return `
      <aside class="pdf_viewer__sidebar" dir="rtl" aria-label="תוכן עניינים">
        <div class="pdf_viewer__sidebar-head">
          <span class="pdf_viewer__sidebar-title">תוכן עניינים</span>
          <button type="button" class="pdf_viewer__sidebar-collapse" id="sidebar-collapse" title="הסתר תוכן עניינים" aria-label="הסתר תוכן עניינים">‹</button>
        </div>
        <div class="toc" data-toc-root="sidebar">
          ${this._buildTocHtml()}
        </div>
      </aside>
    `;
  }

  _buildToolbarHtml() {
    if (!this.hasPageIndex) return '';
    return `
      <div class="pdf_viewer__toolbar" dir="rtl">
        <button type="button" class="pdf_viewer__toc-toggle" id="toc-toggle" aria-label="פתח תוכן עניינים">
          <span class="pdf_viewer__toc-toggle-icon" aria-hidden="true">☰</span>
          <span class="pdf_viewer__toc-toggle-label">תוכן עניינים</span>
        </button>
      </div>
    `;
  }

  render() {
    if (!this.shadowRoot.querySelector('.pdf_viewer')) {
      this.shadowRoot.innerHTML = `
        <style>${this._styles()}</style>
        <div class="pdf_viewer">
          <div class="pdf_viewer__body" dir="rtl">
            ${this._buildSidebarHtml()}
            <div class="pdf_viewer__main">
              ${this._buildToolbarHtml()}
              <div class="pdf_viewer__pdf-page">
                <div class="loading-spinner"></div>
                <img id="pdf_viewer__pdfImage" src="" alt="Page ${this.currentPage}">
                <button class="fp-open" id="fp-open" title="מסך מלא (לחץ פעמיים על התמונה)">⛶</button>
              </div>
              <div class="pdf_viewer__pdf-navigation">
                <button id="pdf_viewer__nextPage">הבא</button>
                <span id="pdf_viewer__pageNumber">עמוד ${this.currentPage}</span>
                <button id="pdf_viewer__prevPage">הקודם</button>
              </div>
            </div>
          </div>

          <button class="fp-control fp-close" id="fp-close" title="סגור מסך מלא">✕</button>
          <button class="fp-control fp-nav fp-prev" id="fp-prev" title="הקודם">❯</button>
          <button class="fp-control fp-nav fp-next" id="fp-next" title="הבא">❮</button>
        </div>
      `;

      if (this.hasPageIndex) {
        this._ensureMobileDrawer();
      }
      this._updateActiveToc();
    } else {
      this.shadowRoot.getElementById('pdf_viewer__pageNumber').textContent =
        `עמוד ${this.currentPage}`;
      this._updateActiveToc();
    }
  }

  _ensureMobileDrawer() {
    if (this._tocDrawer) return;
    const drawer = document.createElement('app-drawer');
    drawer.setAttribute('drawer-class', 'pdf-toc-drawer');
    drawer.setAttribute('backdrop-class', 'pdf-toc-drawer__backdrop');
    drawer.setAttribute('active-class', 'active');
    drawer.setAttribute('position', 'end');
    drawer.setAttribute('aria-label', 'תוכן עניינים');
    drawer.innerHTML = `
      <div class="pdf-toc-drawer__head" dir="rtl">
        <span class="pdf-toc-drawer__title">תוכן עניינים</span>
        <button type="button" class="pdf-toc-drawer__close" aria-label="סגור">✕</button>
      </div>
      <div class="toc pdf-toc-drawer__toc" dir="rtl" data-toc-root="drawer">
        ${this._buildTocHtml()}
      </div>
    `;
    document.body.appendChild(drawer);
    this._tocDrawer = drawer;

    drawer.querySelector('.pdf-toc-drawer__close').addEventListener('click', () => drawer.close());

    this._wireTocRoot(drawer.querySelector('[data-toc-root="drawer"]'), { isDrawer: true });
  }

  _wireTocRoot(root, { isDrawer }) {
    if (!root) return;

    root.addEventListener('click', (e) => {
      const btn = e.target.closest('.toc__recipe');
      if (!btn) return;
      const page = parseInt(btn.dataset.page, 10);
      if (!Number.isNaN(page)) {
        this.goToPage(page);
        if (isDrawer && this._tocDrawer) this._tocDrawer.close();
      }
    });

    const input = root.querySelector('#toc-search');
    if (input) {
      input.addEventListener('input', (e) => this._filterToc(e.target.value));
    }
  }

  addEventListeners() {
    if (!this.shadowRoot.querySelector('#pdf_viewer__prevPage').hasAttribute('listener')) {
      this.shadowRoot
        .getElementById('pdf_viewer__prevPage')
        .addEventListener('click', () => this.goToPage(this.currentPage - 1));
      this.shadowRoot.getElementById('pdf_viewer__prevPage').setAttribute('listener', 'true');
      this.shadowRoot
        .getElementById('pdf_viewer__nextPage')
        .addEventListener('click', () => this.goToPage(this.currentPage + 1));
      this.shadowRoot.getElementById('pdf_viewer__nextPage').setAttribute('listener', 'true');

      this.shadowRoot
        .getElementById('fp-open')
        .addEventListener('click', () => this.toggleFullPage());
      this.shadowRoot
        .getElementById('pdf_viewer__pdfImage')
        .addEventListener('dblclick', () => this.toggleFullPage());

      this.shadowRoot
        .getElementById('fp-close')
        .addEventListener('click', () => this.toggleFullPage());
      this.shadowRoot
        .getElementById('fp-prev')
        .addEventListener('click', () => this.goToPage(this.currentPage - 1));
      this.shadowRoot
        .getElementById('fp-next')
        .addEventListener('click', () => this.goToPage(this.currentPage + 1));

      if (this.hasPageIndex) {
        const sidebarRoot = this.shadowRoot.querySelector('[data-toc-root="sidebar"]');
        this._wireTocRoot(sidebarRoot, { isDrawer: false });

        const collapseBtn = this.shadowRoot.getElementById('sidebar-collapse');
        if (collapseBtn) {
          collapseBtn.addEventListener('click', () => this._toggleSidebarCollapsed());
        }

        const tocToggle = this.shadowRoot.getElementById('toc-toggle');
        if (tocToggle) {
          tocToggle.addEventListener('click', () => this._handleTocToggleClick());
        }
      }
    }
  }

  _handleTocToggleClick() {
    if (this._isMobile) {
      if (this._tocDrawer) this._tocDrawer.open();
    } else {
      this._toggleSidebarCollapsed();
    }
  }

  _toggleSidebarCollapsed() {
    const root = this.shadowRoot.querySelector('.pdf_viewer');
    if (!root) return;
    root.classList.toggle('sidebar-collapsed');
  }

  _onMqChange(e) {
    this._isMobile = e.matches;
    const root = this.shadowRoot.querySelector('.pdf_viewer');
    if (root) root.classList.remove('sidebar-collapsed');
    if (!this._isMobile && this._tocDrawer && this._tocDrawer.isOpen) {
      this._tocDrawer.close();
    }
  }

  _filterToc(term) {
    const q = (term || '').trim().toLowerCase();
    const roots = [
      this.shadowRoot.querySelector('[data-toc-root="sidebar"]'),
      this._tocDrawer && this._tocDrawer.querySelector('[data-toc-root="drawer"]'),
    ].filter(Boolean);

    for (const root of roots) {
      const cats = root.querySelectorAll('.toc__cat');
      cats.forEach((cat) => {
        const catName = cat.dataset.name || '';
        let visibleRecipes = 0;
        const recipes = cat.querySelectorAll('.toc__recipe');
        recipes.forEach((r) => {
          const name = r.dataset.name || '';
          const match = !q || name.includes(q) || catName.includes(q);
          r.parentElement.classList.toggle('hidden', !match);
          if (match) visibleRecipes++;
        });
        const catMatches = !q || catName.includes(q) || visibleRecipes > 0;
        cat.classList.toggle('hidden', !catMatches);
        if (q && visibleRecipes > 0) cat.open = true;
      });

      // sync search input values between sidebar and drawer
      const input = root.querySelector('#toc-search');
      if (input && input.value !== (term || '')) input.value = term || '';
    }
  }

  _updateActiveToc() {
    if (!this.hasPageIndex) return;
    const page = Number(this.currentPage);
    const roots = [
      this.shadowRoot.querySelector('[data-toc-root="sidebar"]'),
      this._tocDrawer && this._tocDrawer.querySelector('[data-toc-root="drawer"]'),
    ].filter(Boolean);

    const activeCategory = this.getCategoryForPage(page);

    for (const root of roots) {
      root
        .querySelectorAll('.toc__recipe--active')
        .forEach((el) => el.classList.remove('toc__recipe--active'));
      root
        .querySelectorAll('.toc__cat--active')
        .forEach((el) => el.classList.remove('toc__cat--active'));

      const matches = root.querySelectorAll(`.toc__recipe[data-page="${page}"]`);
      matches.forEach((m) => {
        m.classList.add('toc__recipe--active');
        const details = m.closest('details.toc__cat');
        if (details) {
          details.open = true;
          details.classList.add('toc__cat--active');
        }
      });

      if (matches.length === 0 && activeCategory) {
        const safe = String(activeCategory).toLowerCase();
        root.querySelectorAll('.toc__cat').forEach((c) => {
          if (c.dataset.name === safe) c.classList.add('toc__cat--active');
        });
      }
    }
  }

  getCategoryForPage(pageNumber) {
    if (!this.pageIndex || !this.pageIndex.categories) return null;
    const n = Number(pageNumber);
    for (const [categoryName, categoryData] of Object.entries(this.pageIndex.categories)) {
      if (n >= categoryData.startPage && n <= categoryData.endPage) {
        return categoryName;
      }
    }
    return null;
  }

  async updateImage(pageNumber) {
    const img = this.shadowRoot.getElementById('pdf_viewer__pdfImage');
    const spinner = this.shadowRoot.querySelector('.loading-spinner');

    if (!img) return;

    img.classList.remove('loaded');
    if (spinner) spinner.classList.add('visible');

    img.alt = `Page ${pageNumber}`;

    try {
      const path = `${this.pdfPath}page.${pageNumber}.jpg`;
      const url = await PdfService.getPageImageUrl(path);

      img.src = url;

      img.onload = () => {
        img.classList.add('loaded');
        if (spinner) spinner.classList.remove('visible');
      };

      img.onerror = (e) => {
        console.error('Error loading image:', e);
        if (spinner) spinner.classList.remove('visible');
      };
    } catch (error) {
      console.error('Error fetching image URL:', error);
      if (spinner) spinner.classList.remove('visible');
    }
  }

  goToPage(pageNumber) {
    const newPage = Math.max(1, Math.min(pageNumber, this.totalPages));
    if (newPage !== this.currentPage) {
      this.currentPage = newPage;
      this.render();
      this.updateImage(this.currentPage);
    }
  }

  _styles() {
    return `
      :host { display: block; height: 100%; }

      .pdf_viewer {
        width: 100%;
        height: 100%;
        border-radius: var(--r-lg, 20px);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        background: var(--surface-1, #fff);
        box-shadow: var(--shadow-2, 0 4px 16px rgba(31,29,24,0.1));
        border: 1px solid var(--hairline, rgba(31,29,24,0.08));
      }

      .pdf_viewer.full-page {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        z-index: var(--z-fullscreen);
        border-radius: 0;
        margin: 0;
      }

      .pdf_viewer__body {
        display: flex;
        flex-direction: row;
        flex-grow: 1;
        min-height: 0;
      }

      /* --- Sidebar --- */
      .pdf_viewer__sidebar {
        width: 300px;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        background: var(--surface-2, #f5f4f0);
        border-inline-start: 1px solid var(--hairline, rgba(31,29,24,0.08));
        overflow: hidden;
        transition: width var(--dur-2, 280ms) var(--ease-out, ease),
                    border-color var(--dur-2, 280ms) var(--ease-out, ease);
      }

      .pdf_viewer.sidebar-collapsed .pdf_viewer__sidebar {
        width: 0;
        border-inline-start-width: 0;
      }

      .pdf_viewer__sidebar-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 14px;
        border-bottom: 1px solid var(--hairline, rgba(31,29,24,0.08));
        background: var(--surface-1, #fff);
        flex-shrink: 0;
      }

      .pdf_viewer__sidebar-title {
        font-family: var(--font-ui-he, inherit);
        font-weight: 600;
        color: var(--ink, #1f1d18);
        font-size: 14px;
      }

      .pdf_viewer__sidebar-collapse {
        width: 28px;
        height: 28px;
        border: 1px solid var(--hairline-strong, rgba(31,29,24,0.15));
        background: var(--surface-0, #fafaf8);
        color: var(--ink-2, #2c2a25);
        border-radius: var(--r-pill, 999px);
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background var(--dur-1, 160ms), border-color var(--dur-1, 160ms);
      }

      .pdf_viewer__sidebar-collapse:hover {
        background: var(--surface-1, #fff);
        border-color: var(--primary, #6a994e);
        color: var(--primary, #6a994e);
      }

      /* --- TOC tree --- */
      .toc {
        display: flex;
        flex-direction: column;
        flex-grow: 1;
        min-height: 0;
      }

      .toc__head {
        padding: 10px 12px;
        flex-shrink: 0;
      }

      .toc__search {
        width: 100%;
        padding: 9px 12px;
        border: 1.5px solid var(--hairline-strong, rgba(31,29,24,0.15));
        border-radius: var(--r-sm, 8px);
        font-size: 14px;
        font-family: var(--font-ui-he, inherit);
        background: var(--surface-0, #fafaf8);
        color: var(--ink, #1f1d18);
        transition: border-color var(--dur-1, 160ms), box-shadow var(--dur-1, 160ms);
        box-sizing: border-box;
      }

      .toc__search:focus {
        outline: none;
        border-color: var(--primary, #6a994e);
        box-shadow: 0 0 0 3px rgba(106, 153, 78, 0.12);
        background: var(--surface-1, #fff);
      }

      .toc__body {
        flex-grow: 1;
        overflow-y: auto;
        padding: 4px 8px 12px;
      }

      .toc__cat {
        margin-bottom: 2px;
        border-radius: var(--r-sm, 8px);
      }

      .toc__cat.hidden,
      .toc__list .hidden {
        display: none;
      }

      .toc__summary {
        list-style: none;
        cursor: pointer;
        padding: 8px 10px;
        border-radius: var(--r-sm, 8px);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        font-family: var(--font-ui-he, inherit);
        font-weight: 600;
        color: var(--ink, #1f1d18);
        font-size: 14px;
        transition: background var(--dur-1, 160ms);
      }

      .toc__summary::-webkit-details-marker { display: none; }
      .toc__summary::marker { content: ''; }

      .toc__summary::before {
        content: '▸';
        color: var(--ink-3, rgba(31,29,24,0.55));
        font-size: 10px;
        transition: transform var(--dur-1, 160ms);
        display: inline-block;
      }

      .toc__cat[open] > .toc__summary::before {
        transform: rotate(90deg);
      }

      .toc__cat-name {
        flex-grow: 1;
        text-align: start;
      }

      .toc__cat-range {
        font-family: var(--font-mono, monospace);
        font-size: 11px;
        color: var(--ink-3, rgba(31,29,24,0.55));
        background: var(--surface-1, #fff);
        padding: 2px 8px;
        border-radius: var(--r-pill, 999px);
        border: 1px solid var(--hairline, rgba(31,29,24,0.08));
      }

      .toc__summary:hover {
        background: var(--surface-1, #fff);
      }

      .toc__cat--active > .toc__summary {
        background: rgba(106, 153, 78, 0.10);
      }

      .toc__list {
        list-style: none;
        margin: 2px 0 6px;
        padding: 0 0 0 12px;
      }

      .toc__recipe {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
        text-align: start;
        padding: 7px 10px;
        margin: 1px 0;
        border: 0;
        background: transparent;
        border-radius: var(--r-xs, 6px);
        cursor: pointer;
        font-family: var(--font-ui-he, inherit);
        font-size: 13px;
        color: var(--ink-2, #2c2a25);
        transition: background var(--dur-1, 160ms), color var(--dur-1, 160ms);
      }

      .toc__recipe:hover {
        background: var(--surface-1, #fff);
        color: var(--ink, #1f1d18);
      }

      .toc__recipe--active {
        background: var(--primary, #6a994e);
        color: #fff;
        font-weight: 500;
      }

      .toc__recipe--active:hover {
        background: var(--primary-dark, #4a7c31);
        color: #fff;
      }

      .toc__page {
        font-family: var(--font-mono, monospace);
        font-size: 11px;
        opacity: 0.7;
      }

      /* --- Main column --- */
      .pdf_viewer__main {
        display: flex;
        flex-direction: column;
        flex-grow: 1;
        min-width: 0;
        min-height: 0;
      }

      .pdf_viewer__toolbar {
        display: none;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        background: var(--surface-2, #f5f4f0);
        border-bottom: 1px solid var(--hairline, rgba(31,29,24,0.08));
        flex-shrink: 0;
      }

      .pdf_viewer__toc-toggle {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        background: var(--surface-1, #fff);
        color: var(--ink, #1f1d18);
        border: 1px solid var(--hairline-strong, rgba(31,29,24,0.15));
        padding: 8px 14px;
        border-radius: var(--r-sm, 8px);
        cursor: pointer;
        font-family: var(--font-ui-he, inherit);
        font-size: 14px;
        font-weight: 500;
        transition: background var(--dur-1, 160ms), border-color var(--dur-1, 160ms);
      }

      .pdf_viewer__toc-toggle:hover {
        background: var(--surface-0, #fafaf8);
        border-color: var(--primary, #6a994e);
      }

      .pdf_viewer__toc-toggle-icon { font-size: 16px; line-height: 1; }

      .pdf_viewer__pdf-page {
        display: flex;
        justify-content: center;
        align-items: center;
        flex-grow: 1;
        overflow: auto;
        padding: 20px;
        background: var(--surface-0, #fafaf8);
        position: relative;
        min-height: 400px;
      }

      .pdf_viewer.full-page .pdf_viewer__pdf-page {
        height: 100vh;
        padding: 0;
      }

      .pdf_viewer__pdf-page img {
        max-width: 100%;
        max-height: 100%;
        height: auto;
        object-fit: contain;
        border-radius: var(--r-md, 12px);
        box-shadow: var(--shadow-2, 0 4px 16px rgba(31,29,24,0.10));
        transition: transform var(--dur-1, 160ms) var(--ease-out, ease),
                    box-shadow var(--dur-1, 160ms) var(--ease-out, ease),
                    opacity var(--dur-2, 260ms);
        opacity: 0;
      }

      .pdf_viewer__pdf-page img.loaded { opacity: 1; }

      .pdf_viewer__pdf-page img:hover {
        transform: scale(1.02);
        box-shadow: var(--shadow-3, 0 8px 32px rgba(31,29,24,0.16));
      }

      .pdf_viewer.full-page .pdf_viewer__pdf-page img {
        border-radius: 0;
        box-shadow: none;
      }

      .loading-spinner {
        position: absolute;
        width: 40px;
        height: 40px;
        border: 4px solid var(--hairline, rgba(31,29,24,0.08));
        border-top-color: var(--primary, #6a994e);
        border-radius: 50%;
        animation: spin 1s linear infinite;
        display: none;
      }

      .loading-spinner.visible { display: block; }

      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }

      .pdf_viewer__pdf-navigation {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 16px;
        background: var(--surface-2, #f5f4f0);
        flex-shrink: 0;
        border-top: 1px solid var(--hairline, rgba(31,29,24,0.08));
      }

      .pdf_viewer.full-page .pdf_viewer__pdf-navigation { display: none; }

      .pdf_viewer__pdf-navigation button {
        background: var(--primary, #6a994e);
        color: #fff;
        border: none;
        padding: 10px 20px;
        border-radius: var(--r-sm, 8px);
        cursor: pointer;
        font-family: var(--font-ui-he, inherit);
        font-weight: 500;
        font-size: 14px;
        transition: background var(--dur-1, 160ms), transform var(--dur-1, 160ms),
                    box-shadow var(--dur-1, 160ms);
        box-shadow: var(--shadow-1, 0 1px 4px rgba(31,29,24,0.08));
      }

      .pdf_viewer__pdf-navigation button:hover {
        background: var(--primary-dark, #4a7c31);
        transform: translateY(-1px);
        box-shadow: var(--shadow-2, 0 4px 16px rgba(31,29,24,0.10));
      }

      .pdf_viewer__pdf-navigation button:active { transform: translateY(0); }

      .pdf_viewer__pdf-navigation button:disabled {
        background: var(--hairline-strong, rgba(31,29,24,0.15));
        color: var(--ink-4, rgba(31,29,24,0.35));
        cursor: not-allowed;
        transform: none;
        box-shadow: none;
      }

      .pdf_viewer__pdf-navigation span {
        background: var(--surface-1, #fff);
        padding: 6px 16px;
        border-radius: var(--r-pill, 999px);
        font-weight: 500;
        font-family: var(--font-mono, monospace);
        font-size: 12px;
        color: var(--ink-3, rgba(31,29,24,0.55));
        border: 1px solid var(--hairline-strong, rgba(31,29,24,0.15));
      }

      /* --- Full Page overlay controls --- */
      .fp-control {
        display: none;
        position: absolute;
        background: rgba(0, 0, 0, 0.5);
        color: white;
        border: none;
        cursor: pointer;
        z-index: calc(var(--z-fullscreen) + 1);
        transition: background var(--dur-1, 160ms);
      }

      .pdf_viewer.full-page .fp-control {
        display: flex;
        justify-content: center;
        align-items: center;
      }

      .fp-control:hover { background: rgba(0, 0, 0, 0.7); }

      .fp-close {
        top: 20px;
        left: 20px;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        font-size: 24px;
        line-height: 1;
      }

      .fp-nav {
        top: 50%;
        transform: translateY(-50%);
        width: 50px;
        height: 80px;
        font-size: 30px;
        border-radius: var(--r-sm, 8px);
      }

      .fp-prev { right: 20px; }
      .fp-next { left: 20px; }

      .fp-open {
        display: flex;
        justify-content: center;
        align-items: center;
        position: absolute;
        top: 10px;
        right: 10px;
        width: 32px;
        height: 32px;
        border-radius: var(--r-xs, 6px);
        background: rgba(0, 0, 0, 0.35);
        color: white;
        border: none;
        cursor: pointer;
        z-index: 5;
        font-size: 14px;
        transition: background var(--dur-1, 160ms), opacity var(--dur-1, 160ms);
        opacity: 0.6;
      }

      .fp-open:hover { background: rgba(0, 0, 0, 0.6); opacity: 1; }
      .pdf_viewer.full-page .fp-open { display: none; }

      /* Show toolbar on desktop only when the sidebar is collapsed so the
         user has a way to re-open it (the in-sidebar collapse arrow is
         hidden along with the rest of the sidebar). */
      .pdf_viewer.sidebar-collapsed .pdf_viewer__toolbar { display: flex; }

      /* --- Mobile --- */
      @media (max-width: 768px) {
        .pdf_viewer__sidebar { display: none; }

        .pdf_viewer__toolbar { display: flex; }

        .pdf_viewer__pdf-page { padding: 12px; }

        .pdf_viewer__pdf-navigation { padding: 6px 12px; }

        .pdf_viewer__pdf-navigation button {
          padding: 8px 14px;
          font-size: 13px;
        }
      }

      .pdf_viewer.full-page .pdf_viewer__sidebar,
      .pdf_viewer.full-page .pdf_viewer__toolbar {
        display: none !important;
      }
    `;
  }
}

customElements.define('pdf-viewer', PDFViewer);
