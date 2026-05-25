import { icons } from '../../../js/icons.js';
import { getImageUrl } from '../../../js/utils/recipes/recipe-image-utils.js';
import { RecipeImageService } from '../../../js/services/recipes/recipe-image-service.js';

class ImageCarousel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.currentIndex = 0;
    this.autoplayInterval = 5000; // Default autoplay interval in milliseconds
  }

  connectedCallback() {
    this.render();
    this.initCarousel();
  }

  disconnectedCallback() {
    clearInterval(this.autoplayTimer);
  }

  static get observedAttributes() {
    return ['image-ratio', 'auto-rotate', 'images', 'border-radius'];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'images' && newValue) {
      this.images = JSON.parse(newValue);
    }
    if (name === 'image-ratio' && newValue) {
      this.imageRatio = newValue;
    }
    if (name === 'auto-rotate' && newValue) {
      this.autoRotate = newValue !== 'false'; // Auto-rotate by default
    }
    if (name === 'border-radius' && newValue) {
      this.borderRadius = newValue;
      this.updateCarousel();
    }
    this.updateCarousel();
  }

  initCarousel() {
    this.carouselContainer = this.shadowRoot.querySelector('.image-carousel__container');
    this.carouselList = this.shadowRoot.querySelector('.image-carousel__list');
    this.dotsContainer = this.shadowRoot.querySelector('.image-carousel__dots');
    this.prevButton = this.shadowRoot.querySelector('.image-carousel__button--prev');
    this.nextButton = this.shadowRoot.querySelector('.image-carousel__button--next');

    this.prevButton.addEventListener('click', () => this.prevSlide());
    this.nextButton.addEventListener('click', () => this.nextSlide());

    this.updateCarousel();
    if (this.autoRotate) {
      this.startAutoplay();
    }
  }

  async updateCarousel() {
    if (!this.carouselList || !this.images) return;

    this.carouselList.innerHTML = '';
    this.dotsContainer.innerHTML = '';

    // Process all images (could be RecipeImage objects, URLs or Firebase paths)
    await Promise.all(
      this.images.map(async (image, index) => {
        const listItem = document.createElement('li');
        listItem.classList.add('image-carousel__item');
        listItem.classList.add('loading');
        const img = document.createElement('img');

        const handleLoad = () => listItem.classList.remove('loading');
        img.addEventListener('load', handleLoad);
        img.addEventListener('error', () => {
          listItem.classList.remove('loading');
          this.showItemPlaceholder(listItem);
        });

        let src = null;
        // Check if the image is a RecipeImage object or a Firebase path string
        if (typeof image === 'object' && image !== null && (image.full || image.preview)) {
          try {
            src = await RecipeImageService.getOptimizedUrl(image, '1080x1080');
          } catch (error) {
            console.error('Error loading optimized image:', error);
          }
        } else if (typeof image === 'string' && image.startsWith('img/recipes/')) {
          try {
            src = await getImageUrl(image);
          } catch (error) {
            console.error('Error loading Firebase image path:', error);
          }
        } else if (typeof image === 'string') {
          src = image;
        }

        if (src) {
          img.src = src;
          img.alt = `Image ${index + 1}`;
          img.classList.add('image-carousel__image');
          listItem.appendChild(img);
        } else {
          listItem.classList.remove('loading');
          this.showItemPlaceholder(listItem);
        }

        this.carouselList.appendChild(listItem);

        const dot = document.createElement('div');
        dot.classList.add('image-carousel__dot');
        dot.addEventListener('click', () => this.goToSlide(index));
        this.dotsContainer.appendChild(dot);
      }),
    );

    // Apply border-radius if specified
    if (this.borderRadius) {
      this.carouselContainer.style.borderRadius = this.borderRadius;
      this.carouselContainer.style.overflow = 'hidden';
    }

    this.goToSlide(this.currentIndex);
  }

  showItemPlaceholder(listItem) {
    listItem.innerHTML = `
      <div class="image-carousel__placeholder">
        <span class="no-image-icon">${icons.imagePlaceholder}</span>
      </div>
    `;
  }

  goToSlide(index) {
    this.currentIndex = index;
    const translateX = -index * 100 + '%';
    this.carouselList.style.transform = `translateX(${translateX})`;

    // Update active dot
    const dots = this.dotsContainer.querySelectorAll('.image-carousel__dot');
    dots.forEach((dot, i) => {
      dot.classList.toggle('image-carousel__dot--active', i === index);
    });
  }

  nextSlide() {
    this.goToSlide((this.currentIndex + 1) % this.images.length);
  }

  prevSlide() {
    this.goToSlide((this.currentIndex - 1 + this.images.length) % this.images.length);
  }

  startAutoplay() {
    clearInterval(this.autoplayTimer);
    this.autoplayTimer = setInterval(() => {
      this.nextSlide();
    }, this.autoplayInterval);
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        .image-carousel__container {
          border-radius: 20px;
          position: relative;
          width: 100%;
          padding-top: 100%;
          overflow: hidden;
          height: 0;
        }

        .image-carousel__wrapper {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
        }

        .image-carousel__list {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          display: flex;
          transition: transform 0.5s ease-in-out;
          list-style: none;
          padding: 0;
          margin: 0;
        }

        [dir="rtl"] .image-carousel__list {
          flex-direction: row-reverse;
        }

        .image-carousel__item {
          flex: 0 0 100%;
          height: 100%;
          display: flex;
          justify-content: center;
          align-items: center;
          overflow: hidden;
          position: relative;
          -webkit-mask-image: radial-gradient(circle at center, black 50%, transparent 75%);
          mask-image: radial-gradient(circle at center, black 50%, transparent 75%);
          background-color: var(--surface-2, #f6eed6);
        }

        .image-carousel__item.loading::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: linear-gradient(
            90deg,
            var(--surface-2, #f6eed6) 25%,
            #e5dfcb 50%,
            var(--surface-2, #f6eed6) 75%
          );
          background-size: 200% 100%;
          animation: shimmer 1.5s infinite linear;
        }

        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }

        .image-carousel__item.loading .image-carousel__image {
          opacity: 0;
        }

        .image-carousel__image {
          width: 100%;
          height: 100%;
          object-fit: contain;
          border-radius: 20px;
          opacity: 1;
          transition: opacity 0.3s ease;
        }

        .image-carousel__placeholder {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
          background: color-mix(in oklab, var(--surface-2, #f6eed6) 70%, var(--neutral, #f2e8cf));
        }

        .no-image-icon {
          width: 60px;
          height: 60px;
          color: var(--ink-4, #a6a49a);
        }

        .image-carousel__dots {
          position: absolute;
          bottom: 12px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          gap: 6px;
        }

        .image-carousel__dot {
          width: 8px;
          height: 8px;
          border-radius: var(--r-pill, 999px);
          background: rgba(255,255,255,0.55);
          border: 1px solid rgba(255,255,255,0.8);
          cursor: pointer;
          transition: background var(--dur-1, 160ms), transform var(--dur-1, 160ms);
          filter: drop-shadow(0 1px 2px rgba(0,0,0,0.25));
        }

        .image-carousel__dot--active {
          background: var(--primary, #6a994e);
          border-color: var(--primary, #6a994e);
          transform: scale(1.25);
          filter: drop-shadow(0 1px 3px rgba(106,153,78,0.5));
        }

        .image-carousel__button {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          background: var(--surface-1, #fff);
          color: var(--ink, #1f1d18);
          width: 36px;
          height: 36px;
          border-radius: 50%;
          cursor: pointer;
          opacity: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--hairline, rgba(31,29,24,0.08));
          box-shadow: var(--shadow-1, 0 1px 4px rgba(31,29,24,0.08));
          transition:
            box-shadow var(--dur-1, 160ms) var(--ease, ease),
            background var(--dur-1, 160ms) var(--ease, ease),
            opacity var(--dur-2, 280ms) var(--ease, ease),
            transform var(--dur-1, 160ms) var(--ease, ease);
          z-index: 10;
        }

        .image-carousel__button:hover {
          background: var(--surface-2, #f0ede6);
          box-shadow: var(--shadow-2, 0 4px 12px rgba(31,29,24,0.12));
          transform: translateY(-50%) scale(1.08);
        }

        .image-carousel__button:active {
          transform: translateY(-50%) scale(0.95);
        }

        .image-carousel__button--prev { left: 10px; }
        .image-carousel__button--next { right: 10px; }

        .image-carousel__container:hover .image-carousel__button {
          opacity: 1;
        }

        @media (max-width: 768px) {
          .image-carousel__button {
            opacity: 1;
          }
        }
      </style>
      <div class="image-carousel__container" dir="ltr">
        <div class="image-carousel__wrapper">
          <ul class="image-carousel__list"></ul>
          <div class="image-carousel__dots"></div>
          <button class="image-carousel__button image-carousel__button--prev">
            ${icons.chevronLeft}
          </button>
          <button class="image-carousel__button image-carousel__button--next">
            ${icons.chevronRight}
          </button>
        </div>
      </div>
    `;
  }
}

customElements.define('image-carousel', ImageCarousel);
