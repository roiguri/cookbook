import { icons } from '../../../js/icons.js';
import { RECIPE_STATUS, RECIPE_STATUS_LABELS } from '../../../js/utils/recipes/recipe-status.js';

// Not a recipe status: "shared with me" (recipe sharing) shows who shared it.
const SHARED = 'shared';

const ICONS = {
  [RECIPE_STATUS.TO_TRY]: icons.bookmark,
  [RECIPE_STATUS.PRIVATE]: icons.lock,
  [RECIPE_STATUS.PENDING]: icons.clock,
  [RECIPE_STATUS.REJECTED]: icons.times,
  [RECIPE_STATUS.PUBLISHED]: icons.check,
  [SHARED]: icons.users,
};

const STYLES = `
  :host { display: inline-flex; max-width: 100%; min-width: 0; }
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
    max-width: 100%;
    box-sizing: border-box;
  }
  .badge svg { width: 11px; height: 11px; flex-shrink: 0; }
  /* A long name truncates; the badge never wraps or grows the card. */
  .badge span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .badge--to-try { border: 1px dashed var(--ink-3); }
  .badge--private { border-color: var(--hairline-strong); }
  .badge--pending { background: var(--neutral); border-color: var(--hairline-strong); }
  .badge--rejected { background: var(--secondary-dark); color: var(--button-color); }
  .badge--published { background: var(--primary-dark); color: var(--button-color); }
  .badge--shared {
    color: var(--primary-dark);
    border-color: color-mix(in oklab, var(--primary) 35%, transparent);
  }
`;

/**
 * `<status-badge status="to-try|private|pending|rejected|published">`
 * `<status-badge status="shared" name="‹first name›">`
 *
 * The one status pill used wherever a recipe's status is shown (recipe cards,
 * the recipe page). The status itself comes from `getRecipeStatus()` in
 * src/js/utils/recipes/recipe-status.js. `shared` marks a recipe family shared
 * with the reader ("מ־‹name›"); it isn't a status of the recipe. An unknown or
 * empty status renders nothing.
 */
class StatusBadge extends HTMLElement {
  static get observedAttributes() {
    return ['status', 'name'];
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
    const name = (this.getAttribute('name') || '').trim();
    const label =
      status === SHARED ? (name ? `מ־${name}` : 'שותף איתך') : RECIPE_STATUS_LABELS[status];
    this.hidden = !label;
    this.shadowRoot.innerHTML = '';
    if (!label) return;
    const style = document.createElement('style');
    style.textContent = STYLES;
    const badge = document.createElement('span');
    badge.className = `badge badge--${status}`;
    badge.innerHTML = ICONS[status] || '';
    const text = document.createElement('span');
    text.textContent = label; // the name is user data
    badge.append(text);
    if (status === SHARED && name) badge.title = label;
    this.shadowRoot.append(style, badge);
  }
}

if (!customElements.get('status-badge')) {
  customElements.define('status-badge', StatusBadge);
}
