/**
 * MediaScroller - Simplified horizontal scroller for media instructions
 *
 * @attribute {string} media-data - JSON string of media items with {path, caption, type}
 * @attribute {string} item-width - Fixed width for each item (default: 280px)
 * @attribute {string} item-height - Height for each item (default: auto)
 *
 * @fires itemclick - Dispatched when a media item is clicked
 *
 * @example
 * <media-scroller
 *   item-width="280px"
 *   item-height="auto"
 *   media-data='[{"path": "url", "caption": "text", "type": "image"}]'>
 * </media-scroller>
 */

class MediaScroller extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    // Defaults
    this.mediaItems = [];
    this.itemWidth = '280px';
    this.itemHeight = 'auto';
  }

  static get observedAttributes() {
    return ['media-data', 'item-width', 'item-height'];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== newValue) {
      switch (name) {
        case 'media-data':
          try {
            this.mediaItems = JSON.parse(newValue) || [];
          } catch (e) {
            console.error('[MediaScroller] Invalid media-data JSON:', e);
            this.mediaItems = [];
          }
          break;
        case 'item-width':
          this.itemWidth = newValue || '280px';
          break;
        case 'item-height':
          this.itemHeight = newValue || 'auto';
          break;
      }
      if (this.isConnected) {
        this.render();
      }
    }
  }

  attachItemClickListeners() {
    const items = this.shadowRoot.querySelectorAll('.media-scroller__item');
    items.forEach((itemElement) => {
      itemElement.addEventListener('click', (e) => {
        const index = parseInt(itemElement.getAttribute('data-index'), 10);
        const item = this.mediaItems[index];

        // Defensive check: validate that item exists at this index
        if (!item) {
          console.warn(`[MediaScroller] No item found at index ${index}`);
          return;
        }

        this.dispatchEvent(
          new CustomEvent('itemclick', {
            detail: { index, item },
            bubbles: true,
            composed: true,
          }),
        );
      });
    });
  }

  render() {
    const styles = `
      <style>
        :host {
          display: block;
          width: 100%;
        }

        .media-scroller {
          width: 100%;
          direction: rtl;
        }

        .media-scroller__items {
          display: flex;
          gap: 20px;
          overflow-x: auto;
          overflow-y: hidden;
          padding: 0;
          padding-bottom: 10px;
          scroll-behavior: smooth;
          -webkit-overflow-scrolling: touch;
        }

        /* Scrollbar styling */
        .media-scroller__items::-webkit-scrollbar {
          height: 8px;
        }

        .media-scroller__items::-webkit-scrollbar-track {
          background: var(--background-light, #f5f5f5);
          border-radius: 4px;
        }

        .media-scroller__items::-webkit-scrollbar-thumb {
          background: var(--primary-color, #3498db);
          border-radius: 4px;
        }

        .media-scroller__items::-webkit-scrollbar-thumb:hover {
          background: var(--primary-dark, #2980b9);
        }

        .media-scroller__item {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          box-sizing: border-box;
          width: 90%; /* Mobile: 90% of container width for full visibility with scrollbar */
          min-width: 250px; /* Ensure minimum readable size */
          min-height: ${this.itemHeight};
          flex-shrink: 0;
          border: 1px solid var(--border-color, #ddd);
          border-radius: 8px;
          padding: 15px;
          background-color: var(--background-light, #f9f9f9);
          transition: all 0.3s ease;
          position: relative;
          cursor: pointer;
        }

        /* Tablet and up: use fixed width */
        @media (min-width: 768px) {
          .media-scroller__item {
            width: ${this.itemWidth};
          }
        }

        .media-scroller__item:hover {
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
          transform: translateY(-2px);
        }

        .media-scroller__item:active {
          transform: scale(var(--press-scale-card, 0.985));
          transition-duration: var(--dur-1, 160ms);
        }

        .media-scroller__media-container {
          position: relative;
          width: 100%;
          height: 180px;
          margin-bottom: 10px;
          background-color: var(--surface-2, #f6eed6);
          border-radius: 5px;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .media-scroller__media {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          opacity: 0;
          transition: opacity 0.3s ease;
        }

        .media-scroller__media.loaded {
          opacity: 1;
        }

        .media-scroller__spinner {
          width: 24px;
          height: 24px;
          border: 3px solid rgba(0, 0, 0, 0.1);
          border-top-color: var(--primary, #6a994e);
          border-radius: 50%;
          animation: ms-spin 0.8s linear infinite;
        }

        @keyframes ms-spin {
          to { transform: rotate(360deg); }
        }

        .media-scroller__caption {
          margin-top: 5px;
          text-align: center;
          font-family: var(--body-font, Arial, sans-serif);
          font-size: 14px;
          direction: rtl;
          width: 100%;
          word-wrap: break-word;
        }
      </style>
    `;

    const container = document.createElement('div');
    container.className = 'media-scroller';

    const itemsContainer = document.createElement('div');
    itemsContainer.className = 'media-scroller__items';

    this.mediaItems.forEach((item, index) => {
      const isVideo = item.type === 'video';

      if (!item.type) {
        console.warn(`[MediaScroller] Item at index ${index} is missing 'type' field`);
      }

      const itemElement = document.createElement('div');
      itemElement.className = 'media-scroller__item';
      itemElement.setAttribute('data-index', index.toString());

      const mediaContainer = document.createElement('div');
      mediaContainer.className = 'media-scroller__media-container';

      const spinner = document.createElement('div');
      spinner.className = 'media-scroller__spinner';
      mediaContainer.appendChild(spinner);

      const handleLoad = (element) => {
        element.classList.add('loaded');
        if (spinner.parentNode) {
          spinner.parentNode.removeChild(spinner);
        }
      };

      if (isVideo) {
        const video = document.createElement('video');
        video.className = 'media-scroller__media';
        video.controls = true;

        video.addEventListener('loadeddata', () => handleLoad(video));
        video.addEventListener('error', () => handleLoad(video));

        const source = document.createElement('source');
        source.src = item.path;
        source.type = 'video/mp4';

        video.appendChild(source);
        mediaContainer.appendChild(video);
      } else {
        const img = document.createElement('img');
        img.className = 'media-scroller__media';

        img.addEventListener('load', () => handleLoad(img));
        img.addEventListener('error', () => handleLoad(img));

        img.src = item.path;
        img.alt = item.caption || '';
        mediaContainer.appendChild(img);
      }

      itemElement.appendChild(mediaContainer);

      if (item.caption) {
        const caption = document.createElement('div');
        caption.className = 'media-scroller__caption';
        caption.textContent = item.caption;
        itemElement.appendChild(caption);
      }

      itemsContainer.appendChild(itemElement);
    });

    container.appendChild(itemsContainer);

    this.shadowRoot.innerHTML = styles;
    this.shadowRoot.appendChild(container);

    this.attachItemClickListeners();
  }
}

customElements.define('media-scroller', MediaScroller);
