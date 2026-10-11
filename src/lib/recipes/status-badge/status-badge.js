import { icons } from '../../../js/icons.js';
import { RECIPE_STATUS, RECIPE_STATUS_LABELS } from '../../../js/utils/recipes/recipe-status.js';

const ICONS = {
  [RECIPE_STATUS.TO_TRY]: icons.bookmark,
  [RECIPE_STATUS.PRIVATE]: icons.lock,
  [RECIPE_STATUS.PENDING]: icons.clock,
  [RECIPE_STATUS.REJECTED]: icons.times,
  [RECIPE_STATUS.PUBLISHED]: icons.check,
};

const STYLES = `
  :host { display: inline-flex; }
  :host([hidden]) { display: none; }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-ui-he);
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    padding: 6px 10px;
    border-radius: var(--r-pill);
    background: var(--surface-1);
    color: var(--ink);
    box-shadow: var(--shadow-1);
    border: 1px solid transparent;
    white-space: nowrap;
  }
  .badge svg { width: 11px; height: 11px; flex-shrink: 0; }
  .badge--to-try { border: 1px dashed var(--ink-3); }
  .badge--private { border-color: var(--hairline-strong); }
  .badge--pending { background: var(--neutral); border-color: var(--hairline-strong); }
  .badge--rejected { background: var(--secondary-dark); color: var(--button-color); }
  .badge--published { background: var(--primary-dark); color: var(--button-color); }
`;

/**
 * `<status-badge status="to-try|private|pending|rejected|published">`
 *
 * The one status pill used wherever a recipe's status is shown (recipe cards,
 * the recipe page). The status itself comes from `getRecipeStatus()` in
 * src/js/utils/recipes/recipe-status.js. An unknown or empty status renders nothing.
 */
class StatusBadge extends HTMLElement {
  static get observedAttributes() {
    return ['status'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const status = this.getAttribute('status');
    const label = RECIPE_STATUS_LABELS[status];
    this.hidden = !label;
    this.shadowRoot.innerHTML = label
      ? `<style>${STYLES}</style><span class="badge badge--${status}">${ICONS[status] || ''}<span>${label}</span></span>`
      : '';
  }
}

if (!customElements.get('status-badge')) {
  customElements.define('status-badge', StatusBadge);
}
