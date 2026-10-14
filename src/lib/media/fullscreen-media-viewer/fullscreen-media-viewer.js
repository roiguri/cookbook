/**
 * FullscreenMediaViewer - Modal for displaying media instructions in fullscreen
 *
 * @attribute {string} media-data - JSON string of media items with {path, caption, type}
 * @attribute {number} initial-index - Starting index (default: 0)
 *
 * @fires viewer-closed - Dispatched when the viewer is closed
 *
 * @example
 * <fullscreen-media-viewer
 *   media-data='[{"path": "url", "caption": "text", "type": "image"}]'
 *   initial-index="0">
 * </fullscreen-media-viewer>
 */

class FullscreenMediaViewer extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    // State
    this.mediaItems = [];
    this.currentIndex = 0;
    this.isOpen = false;
    this.originalOverflow = '';

    // Bind methods
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handlePrevious = this.handlePrevious.bind(this);
    this.handleNext = this.handleNext.bind(this);
    this.close = this.close.bind(this);
  }

  static get observedAttributes() {
    return ['media-data', 'initial-index'];
  }

  connectedCallback() {
    this.render();
    this.attachEventListeners();
  }

  disconnectedCallback() {
    this.removeEventListeners();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== newValue) {
      switch (name) {
        case 'media-data':
          try {
            const parsed = newValue ? JSON.parse(newValue) : [];
            this.mediaItems = Array.isArray(parsed) ? parsed : [];
          } catch (e) {
            console.error('[FullscreenMediaViewer] Invalid media-data JSON:', e);
            this.mediaItems = [];
          }
          break;
        case 'initial-index':
          this.currentIndex = parseInt(newValue, 10) || 0;
          break;
      }
      if (this.isConnected && this.isOpen) {
        this.updateContent();
      }
    }
  }

  attachEventListeners() {
    const overlay = this.shadowRoot.querySelector('.viewer-overlay');
    const closeBtn = this.shadowRoot.querySelector('.viewer-close');
    const prevBtn = this.shadowRoot.querySelector('.viewer-nav--prev');
    const nextBtn = this.shadowRoot.querySelector('.viewer-nav--next');

    overlay?.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });
    closeBtn?.addEventListener('click', this.close);
    prevBtn?.addEventListener('click', this.handlePrevious);
    nextBtn?.addEventListener('click', this.handleNext);
  }

  removeEventListeners() {
    window.removeEventListener('keydown', this.handleKeyDown);
  }

  handleKeyDown(event) {
    if (!this.isOpen) return;

    switch (event.key) {
      case 'Escape':
        this.close();
        break;
      case 'ArrowLeft':
        this.handlePrevious();
        break;
      case 'ArrowRight':
        this.handleNext();
        break;
    }
  }

  handlePrevious() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.updateContent();
    }
  }

  handleNext() {
    if (this.currentIndex < this.mediaItems.length - 1) {
      this.currentIndex++;
      this.updateContent();
    }
  }

  open(index = 0) {
    this.currentIndex = Math.max(0, Math.min(index, this.mediaItems.length - 1));
    this.isOpen = true;

    const overlay = this.shadowRoot.querySelector('.viewer-overlay');
    if (overlay) {
      overlay.style.display = 'flex';
      // Force reflow for animation
      overlay.offsetWidth;
      overlay.classList.add('open');
    }

    this.updateContent();
    window.addEventListener('keydown', this.handleKeyDown);
    this.lockScroll();
  }

  close() {
    this.isOpen = false;

    const overlay = this.shadowRoot.querySelector('.viewer-overlay');
    if (overlay) {
      overlay.classList.remove('open');
      setTimeout(() => {
        if (!this.isOpen) {
          overlay.style.display = 'none';
        }
      }, 300);
    }

    window.removeEventListener('keydown', this.handleKeyDown);
    this.unlockScroll();

    this.dispatchEvent(
      new CustomEvent('viewer-closed', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  updateContent() {
    if (this.mediaItems.length === 0) return;

    const item = this.mediaItems[this.currentIndex];
    const mediaContainer = this.shadowRoot.querySelector('.viewer-media');
    const captionEl = this.shadowRoot.querySelector('.viewer-caption');
    const counterEl = this.shadowRoot.querySelector('.viewer-counter');
    const prevBtn = this.shadowRoot.querySelector('.viewer-nav--prev');
    const nextBtn = this.shadowRoot.querySelector('.viewer-nav--next');

    // Update media
    if (mediaContainer) {
      const isVideo = item.type === 'video' || item.path.endsWith('.mp4');
      mediaContainer.innerHTML = '';
      if (isVideo) {
        const video = document.createElement('video');
        video.className = 'viewer-media__element';
        video.controls = true;
        video.autoplay = true;
        const source = document.createElement('source');
        source.src = item.path;
        source.type = 'video/mp4';
        video.appendChild(source);
        mediaContainer.appendChild(video);
      } else {
        const img = document.createElement('img');
        img.className = 'viewer-media__element';
        img.src = item.path;
        img.alt = item.caption || '';
        mediaContainer.appendChild(img);
      }
    }

    // Update caption
    if (captionEl) {
      captionEl.textContent = item.caption || '';
      captionEl.style.display = item.caption ? 'block' : 'none';
    }

    // Update counter
    if (counterEl) {
      counterEl.textContent = `${this.currentIndex + 1} / ${this.mediaItems.length}`;
    }

    // Update navigation button states
    if (prevBtn) {
      prevBtn.disabled = this.currentIndex === 0;
      prevBtn.style.opacity = this.currentIndex === 0 ? '0.3' : '1';
    }
    if (nextBtn) {
      nextBtn.disabled = this.currentIndex === this.mediaItems.length - 1;
      nextBtn.style.opacity = this.currentIndex === this.mediaItems.length - 1 ? '0.3' : '1';
    }
  }

  lockScroll() {
    this.originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Prevent layout shift by adding padding for scrollbar width
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
  }

  unlockScroll() {
    document.body.style.overflow = this.originalOverflow;
    document.body.style.paddingRight = '';
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }

        .viewer-overlay {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(0, 0, 0, 0.95);
          z-index: var(--z-fullscreen);
          opacity: 0;
          transition: opacity 0.3s ease;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }

        .viewer-overlay.open {
          opacity: 1;
        }

        .viewer-close {
          position: absolute;
          top: 20px;
          left: 20px;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(4px);
          border: 2px solid rgba(255, 255, 255, 0.9);
          color: white;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          font-size: 24px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background-color 0.2s ease, transform 0.2s ease;
          z-index: calc(var(--z-fullscreen) + 2);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }

        .viewer-close:hover {
          background: rgba(0, 0, 0, 0.85);
          transform: scale(1.1);
        }

        .viewer-close:active {
          background: rgba(0, 0, 0, 0.85);
          transform: scale(var(--press-scale-icon, 0.9));
        }

        .viewer-counter {
          position: absolute;
          top: 20px;
          left: 50%;
          transform: translateX(-50%);
          color: white;
          font-size: 18px;
          font-weight: bold;
          background: rgba(0, 0, 0, 0.5);
          padding: 8px 16px;
          border-radius: 20px;
          z-index: calc(var(--z-fullscreen) + 2);
        }

        .viewer-content {
          width: 100%;
          max-width: 1200px;
          max-height: 85vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 20px;
        }

        .viewer-media {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          max-height: calc(85vh - 100px);
        }

        .viewer-media__element {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
          border-radius: 8px;
        }

        .viewer-caption {
          color: white;
          font-size: 18px;
          text-align: center;
          max-width: 800px;
          line-height: 1.6;
          padding: 12px 20px;
          background: rgba(0, 0, 0, 0.5);
          border-radius: 8px;
        }

        .viewer-nav {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(4px);
          border: 2px solid rgba(255, 255, 255, 0.9);
          color: white;
          width: 50px;
          height: 50px;
          border-radius: 50%;
          font-size: 24px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background-color 0.2s ease, transform 0.2s ease, opacity 0.2s ease;
          z-index: calc(var(--z-fullscreen) + 1);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }

        .viewer-nav:hover:not(:disabled) {
          background: rgba(0, 0, 0, 0.85);
          transform: translateY(-50%) scale(1.1);
        }

        .viewer-nav:active:not(:disabled) {
          background: rgba(0, 0, 0, 0.85);
          transform: translateY(-50%) scale(var(--press-scale-icon, 0.9));
        }

        .viewer-nav:disabled {
          cursor: not-allowed;
        }

        .viewer-nav--prev {
          right: 50px;
        }

        .viewer-nav--next {
          left: 20px;
        }

        @media (max-width: 768px) {
          .viewer-overlay {
            padding: 10px;
          }

          .viewer-close {
            width: 35px;
            height: 35px;
            font-size: 20px;
            top: 10px;
            left: 10px;
          }

          .viewer-counter {
            font-size: 14px;
            padding: 6px 12px;
            top: 10px;
          }

          .viewer-nav {
            width: 40px;
            height: 40px;
            font-size: 20px;
          }

          .viewer-nav--prev {
            right: 40px;
          }

          .viewer-nav--next {
            left: 10px;
          }

          .viewer-caption {
            font-size: 14px;
            padding: 10px 15px;
          }

          .viewer-content {
            max-height: 90vh;
          }

          .viewer-media {
            max-height: calc(90vh - 80px);
          }
        }
      </style>

      <div class="viewer-overlay">
        <button class="viewer-close" aria-label="סגור">✕</button>
        <div class="viewer-counter">1 / 1</div>

        <div class="viewer-content">
          <div class="viewer-media"></div>
          <div class="viewer-caption"></div>
        </div>

        <button class="viewer-nav viewer-nav--prev" aria-label="הקודם">‹</button>
        <button class="viewer-nav viewer-nav--next" aria-label="הבא">›</button>
      </div>
    `;
  }
}

customElements.define('fullscreen-media-viewer', FullscreenMediaViewer);
