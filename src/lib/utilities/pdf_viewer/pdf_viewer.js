import {
  getFirestoreInstance,
  getStorageInstance,
} from '../../../js/services/_firebase/firebase-service.js';
import { doc, getDoc } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';

class PDFViewer extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.pdfPath = this.getAttribute('pdf-path');
    this.currentPage = this.getAttribute('start-page') || 1;
    this.totalPages = parseInt(this.getAttribute('total-pages')) || 92;
    this.isFullPage = false;
    this.handleKeyDown = this.handleKeyDown.bind(this);
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
    // Load initial image
    this.updateImage(this.currentPage);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  disconnectedCallback() {
    window.removeEventListener('keydown', this.handleKeyDown);
    if (this.isFullPage) {
      document.body.style.overflow = '';
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
      const db = getFirestoreInstance();
      if (!db) {
        console.error('Firestore not initialized');
        return {};
      }
      const [collectionName, fileName] = this.getAttribute('page-index').split('/'); // Split the attribute value
      const pageIndexRef = doc(db, collectionName, fileName);
      const pageIndexDocSnap = await getDoc(pageIndexRef);
      return pageIndexDocSnap.exists() ? pageIndexDocSnap.data() : {};
    } catch (error) {
      console.error('Error fetching page index:', error);
      return {};
    }
  }

  render() {
    // Initial rendering (only once)
    if (!this.shadowRoot.querySelector('.pdf_viewer')) {
      this.shadowRoot.innerHTML = `
              <style>
                .pdf_viewer {
                    width: 100%;
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

                .pdf_viewer__pdf-page img.loaded {
                    opacity: 1;
                }

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

                .loading-spinner.visible {
                    display: block;
                }

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

                .pdf_viewer.full-page .pdf_viewer__pdf-navigation {
                    display: none;
                }

                .recipe-search {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    padding: 12px 16px;
                    background: var(--surface-2, #f5f4f0);
                    gap: 12px;
                    flex-shrink: 0;
                    border-bottom: 1px solid var(--hairline, rgba(31,29,24,0.08));
                }

                .pdf_viewer.full-page .recipe-search {
                    display: none;
                }

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

                /* Full Page Controls */
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

                .fp-control:hover {
                    background: rgba(0, 0, 0, 0.7);
                }

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

                .fp-prev {
                    right: 20px;
                }

                .fp-next {
                    left: 20px;
                }

                /* Full-page open button (top-right overlay, always visible) */
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

                .fp-open:hover {
                    background: rgba(0, 0, 0, 0.6);
                    opacity: 1;
                }

                .pdf_viewer.full-page .fp-open {
                    display: none;
                }

                .pdf_viewer__pdf-navigation button:hover {
                    background: var(--primary-dark, #4a7c31);
                    transform: translateY(-1px);
                    box-shadow: var(--shadow-2, 0 4px 16px rgba(31,29,24,0.10));
                }

                .pdf_viewer__pdf-navigation button:active {
                    transform: translateY(0);
                }

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

                .pdf_viewer #category-select,
                .pdf_viewer #search-input {
                  padding: 10px 14px;
                  border: 1.5px solid var(--hairline-strong, rgba(31,29,24,0.15));
                  border-radius: var(--r-sm, 8px);
                  font-size: 14px;
                  font-family: var(--font-ui-he, inherit);
                  background: var(--surface-0, #fafaf8);
                  color: var(--ink, #1f1d18);
                  transition: border-color var(--dur-1, 160ms), box-shadow var(--dur-1, 160ms);
                }

                .pdf_viewer #category-select:focus,
                .pdf_viewer #search-input:focus {
                  outline: none;
                  border-color: var(--primary, #6a994e);
                  box-shadow: 0 0 0 3px rgba(106, 153, 78, 0.12);
                  background: var(--surface-1, #fff);
                }

                .pdf_viewer #category-select:hover,
                .pdf_viewer #search-input:hover {
                  border-color: var(--primary, #6a994e);
                }

                @media (max-width: 768px) {
                  .pdf_viewer__pdf-page {
                    padding: 12px;
                  }

                  .pdf_viewer__pdf-navigation {
                    padding: 6px 12px;
                  }

                  .recipe-search {
                    padding: 10px 12px;
                    gap: 8px;
                    flex-wrap: wrap;
                  }

                  .pdf_viewer #category-select,
                  .pdf_viewer #search-input {
                    padding: 10px 12px;
                    font-size: 16px;
                    min-width: 0;
                    flex: 1;
                  }

                  .pdf_viewer__pdf-navigation button {
                    padding: 8px 14px;
                    font-size: 13px;
                  }
                }
              </style>
              <div class="pdf_viewer">
                  ${
                    this.hasPageIndex
                      ? `
                    <div dir="rtl" class="recipe-search">  
                      <select id="category-select" class="category-select">
                          <option value="">כל הקטגוריות</option>
                          ${this.categories ? this.categories.map((category) => `<option value="${category}">${category}</option>`).join('') : ''}
                      </select>
                      <input list="recipe-list" type="text" class="search-input" id="search-input" placeholder="חיפוש...">
                      <datalist id="recipe-list"></datalist>
                    </div>
                  `
                      : ''
                  }
                  <div class="pdf_viewer__pdf-page">
                      <div class="loading-spinner"></div>
                      <img id="pdf_viewer__pdfImage" src="" alt="Page ${this.currentPage}">
                      <!-- Open full-page overlay button -->
                      <button class="fp-open" id="fp-open" title="מסך מלא (לחץ פעמיים על התמונה)">⛶</button>
                  </div>

                  <!-- Full Page Controls -->
                  <button class="fp-control fp-close" id="fp-close" title="סגור מסך מלא">✕</button>
                  <button class="fp-control fp-nav fp-prev" id="fp-prev" title="הקודם">❯</button>
                  <button class="fp-control fp-nav fp-next" id="fp-next" title="הבא">❮</button>

                  <div class="pdf_viewer__pdf-navigation">
                      <button id="pdf_viewer__nextPage">הבא</button>
                      <span id="pdf_viewer__pageNumber">עמוד ${this.currentPage}</span>
                      <button id="pdf_viewer__prevPage">הקודם</button>
                  </div>
              </div>
          `;
      this.addEventListeners(); // Attach event listeners after initial rendering
    } else {
      // Update only navigation state if already rendered (image update handled by updateImage)
      this.shadowRoot.getElementById('pdf_viewer__pageNumber').textContent =
        `עמוד ${this.currentPage}`;
    }
  }

  addEventListeners() {
    if (!this.shadowRoot.querySelector('#pdf_viewer__prevPage').hasAttribute('listener')) {
      // Standard Navigation
      this.shadowRoot
        .getElementById('pdf_viewer__prevPage')
        .addEventListener('click', () => this.goToPage(this.currentPage - 1));
      this.shadowRoot.getElementById('pdf_viewer__prevPage').setAttribute('listener', 'true');
      this.shadowRoot
        .getElementById('pdf_viewer__nextPage')
        .addEventListener('click', () => this.goToPage(this.currentPage + 1));
      this.shadowRoot.getElementById('pdf_viewer__nextPage').setAttribute('listener', 'true');

      // Full-page open: small overlay button + double-tap on image
      this.shadowRoot
        .getElementById('fp-open')
        .addEventListener('click', () => this.toggleFullPage());
      this.shadowRoot
        .getElementById('pdf_viewer__pdfImage')
        .addEventListener('dblclick', () => this.toggleFullPage());

      // Full Page Navigation
      this.shadowRoot
        .getElementById('fp-close')
        .addEventListener('click', () => this.toggleFullPage());
      this.shadowRoot
        .getElementById('fp-prev')
        .addEventListener('click', () => this.goToPage(this.currentPage - 1));
      this.shadowRoot
        .getElementById('fp-next')
        .addEventListener('click', () => this.goToPage(this.currentPage + 1));

      // Moved search-related event listeners here
      if (this.hasPageIndex) {
        this.searchInput = this.shadowRoot.getElementById('search-input');
        this.searchResults = this.shadowRoot.getElementById('recipe-list');
        this.categorySelect = this.shadowRoot.getElementById('category-select');
        this.searchInput.addEventListener('input', this.performSearch.bind(this));
        this.categorySelect.addEventListener('change', this.performSearch.bind(this));

        // Add event listener for search suggestions
        this.searchInput.addEventListener('input', () => {
          // Find the selected option in the datalist
          const selectedOption = this.searchResults.querySelector(
            `option[value="${this.searchInput.value}"]`,
          );
          if (selectedOption) {
            // Get the page number from the selected option's data attribute (if available)
            const pageNumber = selectedOption.dataset.pageNumber;
            if (pageNumber) {
              this.goToPage(pageNumber);
            }
          }
        });
      }
    }
  }

  performSearch() {
    const searchTerm = this.searchInput.value.toLowerCase();
    const selectedCategory = this.categorySelect.value;

    if (!this.pageIndex || !this.pageIndex.recipes) return;

    let recipes = Object.entries(this.pageIndex.recipes);

    if (selectedCategory) {
      recipes = recipes.filter(([recipeName, pageNumber]) => {
        const recipeCategory = this.getCategoryForPage(pageNumber);
        return recipeCategory === selectedCategory;
      });
    }

    const matchedRecipes = recipes.filter(([recipeName]) => {
      return recipeName.toLowerCase().includes(searchTerm);
    });

    this.updateSearchResults(matchedRecipes);
  }

  updateSearchResults(results) {
    this.searchResults.innerHTML = ''; // Clear previous results

    results.forEach(([recipeName, pageNumber]) => {
      const option = document.createElement('option');
      option.value = recipeName;
      option.dataset.pageNumber = pageNumber;
      this.searchResults.appendChild(option);
    });
  }

  getCategoryForPage(pageNumber) {
    if (!this.pageIndex || !this.pageIndex.categories) return null;

    for (const [categoryName, categoryData] of Object.entries(this.pageIndex.categories)) {
      if (pageNumber >= categoryData.startPage && pageNumber <= categoryData.endPage) {
        return categoryName;
      }
    }
    return null; // Or a default category if needed
  }

  async updateImage(pageNumber) {
    const img = this.shadowRoot.getElementById('pdf_viewer__pdfImage');
    const spinner = this.shadowRoot.querySelector('.loading-spinner');

    if (!img) return;

    // Show loading state
    img.classList.remove('loaded');
    if (spinner) spinner.classList.add('visible');

    // Update alt text
    img.alt = `Page ${pageNumber}`;

    try {
      const storage = getStorageInstance();
      if (!storage) {
        console.error('Storage not initialized');
        return;
      }

      // Construct reference to the file
      // pdfPath usually has form "grandmas_cookbook/original/"
      // We need to ensure we don't have double slashes if pdfPath ends with /
      const path = `${this.pdfPath}page.${pageNumber}.jpg`;
      const imageRef = ref(storage, path);

      const url = await getDownloadURL(imageRef);

      img.src = url;

      // Once loaded, show image and hide spinner
      img.onload = () => {
        img.classList.add('loaded');
        if (spinner) spinner.classList.remove('visible');
      };

      img.onerror = (e) => {
        console.error('Error loading image:', e);
        if (spinner) spinner.classList.remove('visible');
        // Could show an error placeholder here
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
      // Update navigation text immediately
      this.render();
      // Asynchronously update image
      this.updateImage(this.currentPage);
    }
  }
}

customElements.define('pdf-viewer', PDFViewer);
