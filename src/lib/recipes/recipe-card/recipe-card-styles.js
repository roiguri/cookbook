/**
 * Recipe Card Component Styles
 * Exported as JavaScript string for reliable Shadow DOM loading
 */

export const recipeCardStyles = `
/* Recipe Card Component Styles */

:host {
    display: block;
    width: var(--card-width, 100%);
    min-width: 0;
    box-sizing: border-box;
}

.recipe-card {
    position: relative;
    background: var(--surface-1, #ffffff);
    border-radius: var(--r-lg, 20px);
    box-shadow: var(--shadow-1, 0 1px 2px rgba(31,29,24,0.04), 0 2px 6px rgba(31,29,24,0.04));
    width: 100%;
    display: flex;
    flex-direction: column;
    cursor: default;
    overflow: hidden;
    transition: transform var(--dur-2, 280ms) var(--ease, ease), box-shadow var(--dur-2, 280ms) var(--ease, ease);
}

.recipe-card:hover {
    transform: translateY(-3px);
    box-shadow: var(--shadow-2, 0 2px 4px rgba(31,29,24,0.05), 0 10px 30px -8px rgba(31,29,24,0.1));
}

/* ---- Photo ---- */
.photo {
    position: relative;
    aspect-ratio: 4 / 3;
    overflow: hidden;
    background: var(--surface-2, #f6eed6);
    flex-shrink: 0;
}

/* Warm tint */
.photo::before {
    content: '';
    position: absolute;
    inset: 0;
    background: rgba(242, 232, 207, 0.12);
    z-index: 1;
    pointer-events: none;
}

/* Bottom fade into card */
.photo::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 40%;
    background: linear-gradient(to bottom, transparent, rgba(255, 255, 255, 0.55));
    z-index: 2;
    pointer-events: none;
}

.recipe-image {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transition: opacity var(--dur-2, 280ms) var(--ease, ease);
}

.recipe-image.loaded {
    opacity: 1;
}

/* ---- No-image placeholder ---- */
.no-image-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in oklab, var(--surface-2, #f6eed6) 70%, var(--neutral, #f2e8cf));
}

.no-image-icon {
    width: 40px;
    height: 40px;
    color: var(--ink-4, #a6a49a);
}

/* ---- Content ---- */
.recipe-content {
    padding: 14px 16px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    direction: rtl;
    text-align: right;
}

/* Category label */
.badge.category {
    display: block;
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--primary-dark, #386641);
    background: none;
    padding: 0;
    border-radius: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* Category color accents */
.badge.category.appetizers       { color: #c2410c; }
.badge.category.main-courses     { color: var(--secondary, #bc4749); }
.badge.category.side-dishes      { color: #a16207; }
.badge.category.soups-stews      { color: #1d4ed8; }
.badge.category.salads           { color: #15803d; }
.badge.category.desserts         { color: #a21caf; }
.badge.category.breakfast-brunch { color: #0e7490; }
.badge.category.breads-pastries  { color: #a34e2e; }
.badge.category.snacks           { color: #6d28d9; }
.badge.category.beverages        { color: #0369a1; }

/* Title */
.recipe-title {
    margin: 0;
    font-family: var(--font-display, serif);
    font-style: italic;
    font-weight: 400;
    font-size: clamp(1rem, 0.9rem + 0.5vw, 1.2rem);
    line-height: 1.25;
    color: var(--ink, #1f1d18);
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    min-height: 2.5em;
}

/* Stretched Link Pattern */
.recipe-link {
    text-decoration: none;
    color: inherit;
    cursor: pointer;
    outline: none;
}

.recipe-link::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1;
}

.recipe-link:focus-visible::after {
    outline: 3px solid var(--primary, #6a994e);
    outline-offset: -3px;
    border-radius: var(--r-lg, 20px);
}

/* Meta row */
.recipe-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: auto;
    padding-top: 8px;
    border-top: 1px solid rgba(31, 29, 24, 0.10);
    direction: rtl;
}

.badge.time,
.badge.difficulty {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    font-weight: 400;
    color: var(--ink-3, #6b6a63);
    background: none;
    padding: 0;
    border-radius: 0;
    white-space: nowrap;
}

.badge.time::before {
    content: '⏱ ';
}

.badge.difficulty::before {
    content: '· ';
}

.badge.difficulty .icon {
    text-transform: capitalize;
}

/* ---- Favorite button ---- */
/* Recipe status (to try / private / …) — top corner opposite the action buttons */
.photo status-badge {
    position: absolute;
    top: 10px;
    left: 10px;
    z-index: 3;
}

.favorite-btn {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 32px;
    height: 32px;
    padding: 6px;
    background: rgba(255, 255, 255, 0.88);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: none;
    border-radius: 50%;
    box-shadow: var(--shadow-1, 0 1px 2px rgba(31,29,24,0.04), 0 2px 6px rgba(31,29,24,0.04));
    cursor: pointer;
    z-index: 10;
    transition:
        transform var(--dur-1, 160ms) var(--ease, ease),
        box-shadow var(--dur-1, 160ms) var(--ease, ease),
        background var(--dur-1, 160ms) var(--ease, ease);
}

.favorite-btn:hover {
    transform: scale(1.12);
    box-shadow: var(--shadow-2, 0 2px 4px rgba(31,29,24,0.05), 0 10px 30px -8px rgba(31,29,24,0.1));
    background: rgba(255, 255, 255, 0.98);
}

.favorite-btn:active {
    transform: scale(0.9);
    box-shadow: var(--shadow-1, 0 1px 2px rgba(31,29,24,0.04), 0 2px 6px rgba(31,29,24,0.04));
}

.favorite-btn svg {
    width: 100%;
    height: 100%;
    stroke: var(--ink-3, #6b6a63);
    fill: transparent;
    transition:
        fill var(--dur-1, 160ms) var(--ease, ease),
        stroke var(--dur-1, 160ms) var(--ease, ease);
}

.favorite-btn.active svg {
    fill: #ff4b4b;
    stroke: #ff4b4b;
}

.favorite-btn:hover svg {
    stroke: var(--ink, #1f1d18);
}

.favorite-btn.active:hover svg {
    stroke: #ff4b4b;
}

/* ---- Add to meal button ---- */
.add-to-meal-btn {
    position: absolute;
    top: 48px;
    right: 12px;
    width: 28px;
    height: 28px;
    padding: 4px;
    background: rgba(255, 255, 255, 0.88);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: none;
    border-radius: 50%;
    box-shadow: var(--shadow-1, 0 1px 2px rgba(31,29,24,0.04), 0 2px 6px rgba(31,29,24,0.04));
    cursor: pointer;
    z-index: 10;
    overflow: hidden;
    transition:
        transform var(--dur-1, 160ms) var(--ease, ease),
        box-shadow var(--dur-1, 160ms) var(--ease, ease),
        background var(--dur-1, 160ms) var(--ease, ease);
}

.add-to-meal-btn:hover {
    transform: scale(1.12);
    box-shadow: var(--shadow-2, 0 2px 4px rgba(31,29,24,0.05), 0 10px 30px -8px rgba(31,29,24,0.1));
    background: rgba(255, 255, 255, 0.98);
}

.add-to-meal-btn:active {
    transform: scale(0.9);
    box-shadow: var(--shadow-1, 0 1px 2px rgba(31,29,24,0.04), 0 2px 6px rgba(31,29,24,0.04));
}

.add-to-meal-btn svg {
    width: 100%;
    height: 100%;
    stroke: var(--ink-2, #3a3a3a);
    stroke-width: 2;
    transition: stroke var(--dur-1, 160ms) var(--ease, ease);
    position: relative;
    z-index: 2;
}

.add-to-meal-btn:hover svg {
    stroke: var(--primary-dark, #386641);
}

.ripple {
    position: absolute;
    border-radius: 50%;
    transform: scale(0);
    animation: ripple 0.6s linear;
    background-color: rgba(255, 255, 255, 0.7);
    pointer-events: none;
    z-index: 1;
}

@keyframes ripple {
    to {
        transform: scale(4);
        opacity: 0;
    }
}

/* ---- Loading state ---- */
.recipe-card.loading {
    position: relative;
    overflow: hidden;
    pointer-events: none;
}

.recipe-card.loading .photo {
    aspect-ratio: 4 / 3;
    background: var(--surface-2, #f6eed6);
}

/* Skeleton lines */
.skel {
    border-radius: 4px;
    background: var(--surface-2, #f6eed6);
}

/* matches .badge.category: 10px font × ~1.2 line-height */
.skel-cat {
    height: 12px;
    width: 50%;
}

/* matches .recipe-title: 2-line min-height (2 × line-height 1.25) */
.skel-title {
    height: 2.5em;
    width: 90%;
}

/* mirrors the border-top + padding-top of .recipe-meta */
.skel-divider {
    margin-top: auto;
    height: 0;
    padding-top: 8px;
    border-top: 1px solid rgba(31, 29, 24, 0.10);
}

/* matches badge.time/difficulty: 10px font × ~1.2 line-height */
.skel-meta {
    height: 12px;
    width: 70%;
    margin-top: -6px; /* cancel flex gap so spacing matches rendered */
}

/* Shimmer sweeps across entire card */
.recipe-card.loading::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent 25%, rgba(255,255,255,0.55) 50%, transparent 75%);
    background-size: 200% 100%;
    animation: loading 1.5s infinite;
}

@keyframes loading {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
}

/* ---- Error state ---- */
.error-state {
    padding: 1rem;
    text-align: center;
    color: var(--secondary-dark, #9a3a3c);
    background: color-mix(in oklab, var(--secondary, #bc4749) 8%, white);
    border: 1px solid color-mix(in oklab, var(--secondary, #bc4749) 20%, white);
    border-radius: var(--r-lg, 20px);
    aspect-ratio: 4 / 3;
    display: flex;
    align-items: center;
    justify-content: center;
}
`;
