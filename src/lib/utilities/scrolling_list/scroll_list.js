/**
 * ScrollingList Component
 * @class
 * @extends HTMLElement
 * 
 * @description
 * A custom web component that creates an efficient, scrollable list with lazy loading capabilities.
 * It supports expandable items and can handle both string content and DOM elements for item headers and content.
 * 
 * @example1
 * // HTML
 * <scrolling-list 
 *    id="myList" 
 *    height="400px" 
 *    width="300px" 
 *    expandable-items="true"
 *    background-color="#f0f0f0"
 *    text-color="#333333">
 * </scrolling-list>
 * 
 * // JavaScript
 * const list = document.getElementById('myList');
 * const items = [
 *   { header: "Item 1", content: "Content 1" },
 *   { header: "Item 2", content: "Content 2" },
 * ];
 * list.setItems(items);
 * 
 * @example2
 * // HTML
 * <scrolling-list id="myList" height="400px" width="300px" expandable-items="true"></scrolling-list>
 * 
 * // JavaScript
 * document.addEventListener('DOMContentLoaded', () => {
 *   const list = document.getElementById('myList');
 * 
 *   // Helper function to create header
 *   const createHeader = (content) => {
 *     // Create your header element here
 *     // This can be as simple or complex as you need
 *     // Example:
 *     const header = document.createElement('div');
 *     // Add your custom content to the header
 *     // This can be text, other elements, or a mix
 *     header.appendChild(content);
 *     return header;
 *   };
 * 
 *   // Helper function to create content
 *   const createContent = (content) => {
 *     // Create your content element here
 *     // This can include any HTML elements you want
 *     // Example:
 *     const contentDiv = document.createElement('div');
 *     // Add your custom content
 *     // This can include text, buttons, forms, etc.
 *     contentDiv.appendChild(content);
 *     return contentDiv;
 *   };
 * 
 *   // Create your list items
 *   const items = [
 *     {
 *       header: createHeader( Your header content ),
 *       content: createContent( Your content )
 *     },
 *     // Add more items as needed
 *   ];
 * 
 *   // Add items to the list
 *   list.setItems(items);
 * });
 * 
 * // Additional notes:
 * // 1. The `createHeader` and `createContent` functions can be customized to create any type of element structure you need.
 * // 2. You can add event listeners, styles, and other properties to your elements within these functions.
 * // 3. The `items` array can contain as many items as you need, each with its own unique header and content.
 * // 4. For more complex structures, you can create separate functions for different types of headers or content.
 * // 5. Remember that both header and content can be either simple strings or complex DOM structures.

 * 
 * @property {Array} items - The full list of items.
 * @property {Array} displayedItems - The currently displayed items.
 * @property {number} batchSize - The number of items to load in each batch.
 * @property {boolean} expandableItems - Whether items can be expanded.
 * @property {IntersectionObserver} intersectionObserver - Observer for infinite scrolling.
 * @property {boolean} isLoading - Flag to prevent concurrent loading operations.
 * 
 * @fires ScrollingList#item-expanded - When an item is expanded.
 * @fires ScrollingList#item-collapsed - When an item is collapsed.
 * 
 * @attr {string} height - Sets the height of the scrolling list (e.g., "400px", "50vh").
 * @attr {string} width - Sets the width of the scrolling list (e.g., "300px", "100%").
 * @attr {boolean} expandable-items - Enables/disables expandable items.
 */
class ScrollingList extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.items = [];
    this.displayedItems = [];
    this.batchSize = 20;
    this.expandableItems = false;
    this.intersectionObserver = null;
    this.isLoading = false;
  }

  static get observedAttributes() {
    return [
      'height',
      'width',
      'expandable-items',
      'header-background-color',
      'header-text-color',
      'content-background-color',
      'content-text-color',
    ];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== newValue) {
      switch (name) {
        case 'height':
          this.style.setProperty('--list-height', newValue);
          break;
        case 'width':
          this.style.setProperty('--list-width', newValue);
          break;
        case 'expandable-items':
          this.expandableItems = newValue === 'true';
          this.render();
          break;
        case 'header-background-color':
          this.style.setProperty('--header-background-color', newValue);
          break;
        case 'header-text-color':
          this.style.setProperty('--header-text-color', newValue);
          break;
        case 'content-background-color':
          this.style.setProperty('--content-background-color', newValue);
          break;
        case 'content-text-color':
          this.style.setProperty('--content-text-color', newValue);
          break;
      }
    }
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
    this.setupIntersectionObserver();

    this.dispatchEvent(new CustomEvent('scrolling-list-ready'));
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        ${this.styles()}
      </style>
      ${this.template()}
    `;
    this.listContainer = this.shadowRoot.querySelector('.list-container');
  }

  styles() {
    return `
      :host {
        display: block;
        width: var(--list-width, 100%);
        height: var(--list-height, 400px);
        overflow: hidden;
        --header-background-color: var(--surface-1, #fff);
        --header-text-color: var(--ink, #1f1d18);
        --content-background-color: var(--surface-0, #fafaf8);
        --content-text-color: var(--ink-3, rgba(31,29,24,0.55));
      }

      .scrolling-list {
        height: 100%;
        overflow-y: auto;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 4px 4px 8px;
        scrollbar-width: thin;
        scrollbar-color: var(--hairline-strong, rgba(31,29,24,0.15)) transparent;
        scrollbar-gutter: stable;
      }

      .scrolling-list::-webkit-scrollbar { width: 4px; }
      .scrolling-list::-webkit-scrollbar-track { background: transparent; }
      .scrolling-list::-webkit-scrollbar-thumb {
        background: var(--hairline-strong, rgba(31,29,24,0.15));
        border-radius: 2px;
      }

      .list-item {
        flex-shrink: 0;
        border-radius: var(--r-sm, 8px);
        border: 1px solid var(--hairline, rgba(31,29,24,0.08));
        background: var(--surface-1, #fff);
        overflow: hidden;
        position: relative;
        z-index: 0;
        transition: border-color var(--dur-1, 160ms), box-shadow var(--dur-1, 160ms);
      }

      .list-item:hover {
        border-color: var(--hairline-strong, rgba(31,29,24,0.15));
        box-shadow: var(--shadow-1, 0 1px 4px rgba(31,29,24,0.08));
        z-index: 1;
      }

      .list-item.expanded {
        border-color: var(--primary, #6a994e);
        box-shadow: 0 0 0 1px var(--primary, #6a994e),
                    var(--shadow-1, 0 1px 4px rgba(31,29,24,0.08));
        z-index: 2;
      }

      .list-item-header {
        padding: 10px 14px;
        background-color: var(--header-background-color);
        color: var(--header-text-color);
        font-family: var(--font-ui-he, sans-serif);
        font-size: 14px;
        line-height: 1.4;
      }

      .expandable .list-item-header {
        cursor: pointer;
        user-select: none;
        transition: background var(--dur-1, 160ms);
      }

      .expandable .list-item-header:hover {
        background-color: var(--surface-2, #f5f4f0);
      }

      .expandable .list-item-header:active {
        background-color: var(--neutral, #f2e8cf);
      }

      /* Hosts build item buttons with inline styles, which can't carry :active,
         so the list gives every button inside an item its pressed state. */
      .list-item button {
        transition: transform var(--dur-1, 160ms) var(--ease, ease);
      }

      .list-item button:active:not(:disabled) {
        transform: scale(var(--press-scale, 0.97));
      }

      .list-item-content {
        display: none;
        padding: 10px 14px;
        background-color: var(--content-background-color);
        color: var(--content-text-color);
        font-family: var(--font-ui-he, sans-serif);
        font-size: 13px;
        border-top: 1px solid var(--hairline, rgba(31,29,24,0.08));
      }

      .list-item.expanded .list-item-content {
        display: block;
      }

      #sentinel {
        height: 1px;
        flex-shrink: 0;
      }
    `;
  }

  template() {
    return `
      <div class="scrolling-list ${this.expandableItems ? 'expandable' : ''}">
        <div class="list-container"></div>
        <div id="sentinel"></div>
      </div>
    `;
  }

  setupEventListeners() {
    if (this.expandableItems) {
      this.listContainer.addEventListener('click', (e) => {
        const header = e.target.closest('.list-item-header');
        if (header) {
          const listItem = header.closest('.list-item');
          listItem.classList.toggle('expanded');
        }
      });
    }
  }

  setupIntersectionObserver() {
    const options = {
      root: this.shadowRoot.querySelector('.scrolling-list'),
      rootMargin: '100px',
      threshold: 0.1,
    };

    this.intersectionObserver = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !this.isLoading) {
        this.loadMoreItems();
      }
    }, options);

    const sentinel = this.shadowRoot.querySelector('#sentinel');
    this.intersectionObserver.observe(sentinel);
  }

  loadMoreItems() {
    if (this.isLoading || this.displayedItems.length >= this.items.length) {
      return;
    }
    this.isLoading = true;

    const startIndex = this.displayedItems.length;
    const endIndex = Math.min(startIndex + this.batchSize, this.items.length);
    const newItems = this.items.slice(startIndex, endIndex);
    this.displayedItems = [...this.displayedItems, ...newItems];
    this.renderNewItems(newItems);

    this.isLoading = false;
  }

  renderNewItems(newItems) {
    const fragment = document.createDocumentFragment();

    newItems.forEach((item) => {
      const listItem = document.createElement('div');
      listItem.classList.add('list-item');

      const headerContent = typeof item.header === 'string' ? item.header : '';
      const contentHtml = typeof item.content === 'string' ? item.content : '';

      listItem.innerHTML = `
        <div class="list-item-header">${headerContent}</div>
        <div class="list-item-content">${contentHtml}</div>
      `;

      if (typeof item.header !== 'string') {
        listItem.querySelector('.list-item-header').appendChild(item.header);
      }
      if (typeof item.content !== 'string') {
        listItem.querySelector('.list-item-content').appendChild(item.content);
      }
      fragment.appendChild(listItem);
    });
    this.listContainer.appendChild(fragment);
  }

  setItems(items) {
    this.items = items;
    this.displayedItems = [];
    this.listContainer.innerHTML = '';
    this.loadMoreItems();
  }
}

customElements.define('scrolling-list', ScrollingList);
