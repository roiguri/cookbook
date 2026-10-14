import { Modal } from '../../utilities/modal/modal.js';
import { icons } from '../../../js/icons.js';
import { RecipeShareService } from '../../../js/services/recipes/recipe-share-service.js';
import { shareOrCopy } from '../../../js/utils/share.js';
import { showToast } from '../../notifications/toast-notification/toast-notification.js';

// The family list gets a name search from this many people (it never filters
// "with access").
const SEARCH_FROM = 8;

const CHECK =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const CHEVRON =
  '<svg class="fp-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const SEARCH =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="5"/><path d="M11 11l3 3"/></svg>';

const UNNAMED = 'ללא שם';

const dateOf = (t) => {
  const d = t?.toDate?.() ?? (t ? new Date(t) : null);
  return d && !isNaN(d) ? `${d.getDate()}.${d.getMonth() + 1}` : '';
};

/**
 * "Shared with" note after sharing: one or two names, then "‹name› ועוד N".
 * @param {string[]} names
 * @returns {string}
 */
export function sharedWithText(names) {
  const [first, second] = names.map((name) => name || UNNAMED);
  if (names.length === 1) return `שותף עם ${first}`;
  if (names.length === 2) return `שותף עם ${first} ו${second}`;
  return `שותף עם ${first} ועוד ${names.length - 1}`;
}

/**
 * `<share-family-modal>` — the author shares a private recipe with family
 * (docs/archive/feature-plans/recipe-sharing.md, R3; canvas "Sharing · R3 · Share with
 * family (author)").
 *
 * "עם גישה" (collapsed by default) lists who has access, each removable; "בני
 * משפחה" lists everyone else to tick, with a name search on long lists. After
 * sharing, the modal stays open with a one-line note and "שליחת קישור", so the
 * author can tell them (there are no notifications yet).
 *
 * @example
 *   const modal = document.createElement('share-family-modal');
 *   document.body.appendChild(modal);
 *   modal.openFor({ recipeId, recipeName, authorId, authorName, url });
 *
 * @fires recipe-shares-changed - After sharing or removing someone ({ recipeId }).
 */
class ShareFamilyModal extends Modal {
  template() {
    return `
      <div dir="rtl" class="modal" role="dialog" aria-modal="true" aria-labelledby="fp-title">
        <div class="modal-content">
          <button class="close-button" aria-label="סגור">&times;</button>
          <div class="family-picker">
            <h2 id="fp-title">שיתוף עם בני משפחה</h2>
            <p class="fp-intro" id="fp-intro"></p>
            <div class="fp-done" id="fp-done" role="status" hidden>
              <p id="fp-done-text"></p>
              <button type="button" class="fp-send" id="fp-send">${icons.link}<span>שליחת קישור</span></button>
            </div>
            <p class="fp-message" id="fp-message" hidden></p>
            <div class="fp-scroll">
              <div class="fp-access" id="fp-access" hidden>
                <button type="button" class="fp-access-toggle" id="fp-access-toggle" aria-expanded="false" aria-controls="fp-access-list">
                  <span class="fp-stack" id="fp-stack"></span>
                  <span class="fp-access-label">עם גישה <span class="fp-count" id="fp-access-count"></span></span>
                  ${CHEVRON}
                </button>
                <ul class="fp-list" id="fp-access-list" hidden></ul>
              </div>
              <div class="fp-section" id="fp-family" hidden>
                <h3 class="fp-section__head">בני משפחה <span class="fp-count" id="fp-family-count"></span></h3>
                <div class="fp-search" id="fp-search" hidden>
                  <label for="fp-q" class="fp-visually-hidden">חיפוש בני משפחה</label>
                  <input id="fp-q" type="search" placeholder="חיפוש לפי שם" autocomplete="off" />
                  ${SEARCH}
                </div>
                <ul class="fp-list" id="fp-family-list"></ul>
                <p class="fp-empty" id="fp-no-match" hidden>אין בני משפחה בשם הזה.</p>
              </div>
            </div>
            <div class="modal-buttons">
              <button type="button" class="modal-button reject-button" id="fp-cancel">ביטול</button>
              <button type="button" class="modal-button approve-button" id="fp-share" disabled>שיתוף</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  styles() {
    return `
      ${super.styles()}
      .modal-content {
        display: flex;
        flex-direction: column;
        max-height: min(86vh, 760px);
        overflow: hidden;
      }
      .family-picker {
        direction: rtl;
        font-family: var(--font-ui-he, sans-serif);
        padding: 28px 28px 24px;
        display: flex;
        flex-direction: column;
        gap: 18px;
        text-align: right;
        box-sizing: border-box;
        flex: 1 1 auto;
        min-height: 0;
      }
      [hidden] { display: none !important; }
      h2 {
        font-family: var(--font-display-he, serif);
        font-style: italic;
        font-weight: 400;
        font-size: 1.25rem;
        color: var(--ink, #1f1d18);
        margin: 0 44px 0 0;
        letter-spacing: -0.02em;
      }
      .fp-intro, .fp-message {
        margin: -10px 0 0;
        font-size: 13.5px;
        color: var(--ink-3, #6b6a63);
        line-height: 1.6;
      }
      .fp-message { margin: 0; }
      .fp-scroll {
        display: flex;
        flex-direction: column;
        gap: 18px;
        overflow-y: auto;
        flex: 1 1 auto;
        min-height: 0;
        margin: 0 -6px;
        padding: 0 6px 2px;
      }
      .fp-section, .fp-access { display: flex; flex-direction: column; gap: 6px; }
      .fp-section__head {
        font-family: var(--font-ui, sans-serif);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.12em;
        color: var(--ink-3, #6b6a63);
        margin: 0 0 2px;
      }
      .fp-count { font-family: var(--font-mono, monospace); font-weight: 400; letter-spacing: 0; }
      .fp-count:not(:empty)::before { content: '· '; }
      .fp-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        border: 1px solid var(--hairline, rgba(31, 29, 24, 0.12));
        border-radius: var(--r-md, 12px);
        overflow: hidden;
      }
      .fp-row {
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 56px;
        padding: 8px 14px;
        box-sizing: border-box;
        border-bottom: 1px solid var(--hairline, rgba(31, 29, 24, 0.12));
        background: var(--surface-1, #fff);
      }
      .fp-list > li:last-child .fp-row, .fp-list > li.fp-row:last-child { border-bottom: 0; }
      label.fp-row { cursor: pointer; }
      /* The list is rounded and clips its rows; the first and last rows round the
         same way, so a row's focus ring and selected fill follow the corners. */
      .fp-list > li:first-child,
      .fp-list > li:first-child > .fp-row {
        border-top-left-radius: calc(var(--r-md, 12px) - 1px);
        border-top-right-radius: calc(var(--r-md, 12px) - 1px);
      }
      .fp-list > li:last-child,
      .fp-list > li:last-child > .fp-row {
        border-bottom-left-radius: calc(var(--r-md, 12px) - 1px);
        border-bottom-right-radius: calc(var(--r-md, 12px) - 1px);
      }
      label.fp-row:hover { background: var(--surface-0, #faf6ec); }
      label.fp-row:active { background: var(--surface-2, #f6eed6); }
      label.fp-row:focus-within { box-shadow: inset 0 0 0 2px var(--primary, #6a994e); }
      .fp-row.is-on { background: color-mix(in oklab, var(--primary) 7%, white); }
      .fp-row input { position: absolute; opacity: 0; width: 1px; height: 1px; }
      .fp-check {
        width: 22px;
        height: 22px;
        flex-shrink: 0;
        border-radius: 6px;
        border: 1.5px solid var(--hairline-strong, rgba(31, 29, 24, 0.25));
        background: var(--surface-1, #fff);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        box-sizing: border-box;
      }
      .fp-check svg { display: none; }
      .fp-row.is-on .fp-check { background: var(--primary-dark, #386641); border-color: var(--primary-dark, #386641); }
      .fp-row.is-on .fp-check svg { display: block; }
      .fp-avatar {
        width: 34px;
        height: 34px;
        flex-shrink: 0;
        border-radius: 50%;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, var(--primary-bright, #a7c957), var(--primary-dark, #386641));
        color: #fff;
        font-family: var(--font-ui, sans-serif);
        font-weight: 600;
        font-size: 13px;
      }
      .fp-avatar { position: relative; }
      .fp-avatar img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        opacity: 0;
        transition: opacity var(--dur-1, 160ms) var(--ease, ease);
      }
      .fp-avatar img.is-loaded { opacity: 1; }
      /* Placeholder rows while the family list loads: the same size as real rows. */
      .fp-skel .fp-avatar { background: var(--surface-2, #f6eed6); }
      .fp-skel-bar {
        height: 12px;
        width: 45%;
        border-radius: var(--r-pill, 999px);
        background: linear-gradient(90deg, var(--surface-2, #f6eed6) 25%, var(--surface-0, #faf6ec) 50%, var(--surface-2, #f6eed6) 75%);
        background-size: 200% 100%;
        animation: fp-shimmer 1.2s ease-in-out infinite;
      }
      .fp-skel:nth-child(2) .fp-skel-bar { width: 35%; }
      .fp-skel:nth-child(3) .fp-skel-bar { width: 52%; }
      @keyframes fp-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
      @media (prefers-reduced-motion: reduce) { .fp-skel-bar { animation: none; } }
      .fp-who { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
      .fp-name {
        font-size: 14.5px;
        font-weight: 500;
        color: var(--ink, #1f1d18);
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .fp-meta { font-size: 12px; color: var(--ink-3, #6b6a63); }
      .fp-meta .num { font-family: var(--font-mono, monospace); }
      .fp-remove {
        font-family: var(--font-ui-he, sans-serif);
        font-size: 13px;
        font-weight: 500;
        color: var(--secondary-dark, #9a3a3c);
        background: transparent;
        border: 1px solid var(--hairline-strong, rgba(31, 29, 24, 0.2));
        border-radius: var(--r-sm, 8px);
        padding: 7px 12px;
        cursor: pointer;
        min-height: 36px;
        flex-shrink: 0;
        transition: background var(--dur-1, 160ms), transform var(--dur-1, 160ms);
      }
      .fp-remove:hover { background: color-mix(in oklab, var(--secondary) 6%, white); }
      .fp-remove:active:not(:disabled) {
        background: color-mix(in oklab, var(--secondary) 12%, white);
        transform: scale(var(--press-scale, 0.97));
      }
      .fp-remove:disabled { opacity: 0.5; cursor: wait; }
      .fp-access-toggle {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 50px;
        padding: 8px 14px;
        box-sizing: border-box;
        border: 1px solid var(--hairline, rgba(31, 29, 24, 0.12));
        border-radius: var(--r-md, 12px);
        background: var(--surface-0, #faf6ec);
        cursor: pointer;
        font-family: var(--font-ui-he, sans-serif);
        text-align: right;
        color: inherit;
        transition: background var(--dur-1, 160ms), transform var(--dur-1, 160ms);
      }
      .fp-access-toggle:hover { background: var(--surface-2, #f6eed6); }
      .fp-access-toggle:active {
        background: var(--surface-2, #f6eed6);
        transform: scale(var(--press-scale-card, 0.985));
      }
      .fp-stack { display: flex; flex-shrink: 0; }
      .fp-stack .fp-avatar {
        width: 28px;
        height: 28px;
        font-size: 11.5px;
        border: 2px solid var(--surface-0, #faf6ec);
      }
      .fp-stack .fp-avatar + .fp-avatar { margin-right: -10px; }
      .fp-access-label { flex: 1; font-size: 14px; font-weight: 500; color: var(--ink, #1f1d18); }
      .fp-access-label .fp-count { color: var(--ink-3, #6b6a63); }
      .fp-chevron {
        width: 18px;
        height: 18px;
        color: var(--ink-3, #6b6a63);
        flex-shrink: 0;
        transition: transform var(--dur-1, 160ms);
      }
      .fp-access-toggle[aria-expanded='true'] .fp-chevron { transform: rotate(180deg); }
      .fp-search { position: relative; }
      .fp-search input {
        width: 100%;
        box-sizing: border-box;
        font-family: var(--font-ui-he, sans-serif);
        font-size: 14px;
        color: var(--ink, #1f1d18);
        background: var(--surface-0, #faf6ec);
        border: 1px solid var(--hairline-strong, rgba(31, 29, 24, 0.2));
        border-radius: var(--r-sm, 8px);
        padding: 11px 38px 11px 12px;
        min-height: 44px;
        outline: none;
      }
      .fp-search input:focus {
        border-color: var(--primary, #6a994e);
        box-shadow: rgba(106, 153, 78, 0.12) 0 0 0 3px;
      }
      .fp-search svg {
        position: absolute;
        top: 50%;
        right: 12px;
        transform: translateY(-50%);
        width: 16px;
        height: 16px;
        color: var(--ink-3, #6b6a63);
      }
      .fp-visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
      .fp-empty { margin: 4px 0 0; font-size: 13px; color: var(--ink-3, #6b6a63); }
      .fp-done {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 8px 8px 14px;
        border-radius: var(--r-md, 12px);
        background: color-mix(in oklab, var(--primary) 8%, white);
        border: 1px solid color-mix(in oklab, var(--primary) 20%, transparent);
        flex-shrink: 0;
      }
      .fp-done p {
        margin: 0;
        flex: 1;
        min-width: 0;
        font-size: 13px;
        font-weight: 500;
        color: var(--primary-dark, #386641);
        line-height: 1.4;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .fp-send {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-family: var(--font-ui-he, sans-serif);
        font-size: 13px;
        font-weight: 600;
        color: #fff;
        background: var(--primary, #6a994e);
        border: 0;
        border-radius: var(--r-sm, 8px);
        padding: 0 12px;
        min-height: 36px;
        cursor: pointer;
        transition: background var(--dur-1, 160ms), transform var(--dur-1, 160ms);
      }
      .fp-send:hover, .fp-send:active { background: var(--primary-dark, #386641); }
      .fp-send:active { transform: scale(var(--press-scale, 0.97)); }
      .fp-send svg { width: 15px; height: 15px; }
      .modal-buttons { display: flex; gap: 10px; justify-content: flex-end; flex-shrink: 0; padding-top: 4px; }
      .modal-button {
        font-family: var(--font-ui-he, sans-serif);
        font-size: 13.5px;
        font-weight: 500;
        padding: 11px 24px;
        border-radius: var(--r-sm, 8px);
        cursor: pointer;
        min-width: 100px;
        border: none;
        transition: background var(--dur-1, 160ms) var(--ease, ease),
                    transform var(--dur-1, 160ms) var(--ease, ease);
      }
      .modal-button:active:not(:disabled) { transform: scale(var(--press-scale, 0.97)); }
      .approve-button { background: var(--primary, #6a994e); color: #fff; }
      .approve-button:hover:not(:disabled),
      .approve-button:active:not(:disabled) { background: var(--primary-dark, #386641); }
      .approve-button:disabled { opacity: 0.5; cursor: not-allowed; }
      .reject-button {
        background: transparent;
        color: var(--ink-2, #3a3a3a);
        border: 1px solid var(--hairline-strong, rgba(31, 29, 24, 0.2));
      }
      .reject-button:hover, .reject-button:active { background: var(--surface-2, #f2e8cf); }
      @media (max-width: 768px) {
        .modal-content { max-height: 92vh; }
        .family-picker { padding: 24px 18px 18px; }
        .modal-buttons .modal-button { flex: 1; min-height: 48px; }
      }
    `;
  }

  connectedCallback() {
    super.connectedCallback();
    const $ = (id) => this.shadowRoot.getElementById(id);
    this._selected = new Set();
    this._family = [];
    this._shares = [];
    this._familyCache = null; // { authorId, members } — kept for the session
    this._pending = null; // { key, promise } — a load in flight

    $('fp-cancel').addEventListener('click', () => this.close({ byUser: true }));
    $('fp-share').addEventListener('click', () => this._share());
    $('fp-send').addEventListener('click', () => this._sendLink());
    $('fp-q').addEventListener('input', () => this._renderFamily());
    $('fp-access-toggle').addEventListener('click', () => {
      const toggle = $('fp-access-toggle');
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      $('fp-access-list').hidden = !open;
      this.setFocusableElements();
    });
  }

  /**
   * Start loading who can be picked and who has access, before the picker
   * opens (the page calls it as the share menu opens), so it opens filled.
   * @param {{recipeId: string, authorId: string}} params
   */
  prefetch({ recipeId, authorId }) {
    return this._fetch(recipeId, authorId).catch(() => null);
  }

  _fetch(recipeId, authorId) {
    const key = `${recipeId}:${authorId}`;
    if (this._pending?.key === key) return this._pending.promise;
    const cached = this._familyCache?.authorId === authorId ? this._familyCache.members : null;
    const promise = Promise.all([
      cached || RecipeShareService.listFamily(),
      RecipeShareService.listForRecipe(recipeId, authorId),
    ]).then(([family, shares]) => {
      this._familyCache = { authorId, members: family };
      return { family, shares };
    });
    this._pending = { key, promise };
    promise.catch(() => {
      if (this._pending?.promise === promise) this._pending = null;
    });
    return promise;
  }

  /**
   * Open the picker for a recipe.
   * @param {Object} params
   * @param {string} params.recipeId
   * @param {string} params.recipeName
   * @param {string} params.authorId - The signed-in author.
   * @param {string} params.authorName - Shown to recipients.
   * @param {string} params.url - The recipe's link, for "שליחת קישור".
   */
  async openFor({ recipeId, recipeName, authorId, authorName, url }) {
    const $ = (id) => this.shadowRoot.getElementById(id);
    this._recipe = { recipeId, recipeName, authorId, authorName, url };
    this._selected.clear();
    this._justShared = [];
    $('fp-intro').textContent =
      `רק מי שתבחרו יוכלו לראות את ״${recipeName || ''}״. המתכון נשאר פרטי, והם תמיד יראו את הגרסה העדכנית.`;
    $('fp-done').hidden = true;
    $('fp-intro').hidden = false;
    $('fp-q').value = '';
    $('fp-access-toggle').setAttribute('aria-expanded', 'false');
    $('fp-access-list').hidden = true;
    this._showMessage('');
    this._updateShareButton();
    this._renderSkeleton();
    this.open();
    await this._load();
  }

  async _load() {
    const { recipeId, authorId } = this._recipe;
    try {
      const { family, shares } = await this._fetch(recipeId, authorId);
      if (this._recipe?.recipeId !== recipeId) return;
      this._pending = null; // next open reloads who has access
      this._family = family;
      this._shares = shares;
      this._showMessage(family.length ? '' : 'אין עדיין בני משפחה נוספים באתר לשתף איתם.');
      this._render();
    } catch (error) {
      console.error('Error loading the family list:', error);
      this.shadowRoot.getElementById('fp-family').hidden = true;
      this._showMessage('לא הצלחנו לטעון את בני המשפחה. נסו שוב.');
    }
  }

  /** Placeholder rows, the size of real ones, while the lists load. */
  _renderSkeleton() {
    const $ = (id) => this.shadowRoot.getElementById(id);
    $('fp-access').hidden = true;
    $('fp-family').hidden = false;
    $('fp-search').hidden = true;
    $('fp-no-match').hidden = true;
    $('fp-family-count').textContent = '';
    $('fp-family-list').replaceChildren(
      ...[0, 1, 2].map(() => {
        const row = document.createElement('li');
        row.className = 'fp-row fp-skel';
        row.setAttribute('aria-hidden', 'true');
        const avatar = document.createElement('span');
        avatar.className = 'fp-avatar';
        const bar = document.createElement('span');
        bar.className = 'fp-skel-bar';
        row.append(avatar, bar);
        return row;
      }),
    );
  }

  _showMessage(text) {
    const message = this.shadowRoot.getElementById('fp-message');
    message.textContent = text;
    message.hidden = !text;
  }

  _person(uid) {
    return this._family.find((member) => member.uid === uid) || { uid, name: null };
  }

  _avatar({ name, avatarUrl }) {
    const avatar = document.createElement('span');
    avatar.className = 'fp-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    // The initial shows at once; a photo fades in over it once loaded.
    avatar.textContent = (name || '?').trim().charAt(0);
    if (avatarUrl) {
      const img = document.createElement('img');
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('load', () => img.classList.add('is-loaded'));
      img.addEventListener('error', () => img.remove());
      img.src = avatarUrl;
      avatar.append(img);
    }
    return avatar;
  }

  _render() {
    this._renderAccess();
    this._renderFamily();
    this.setFocusableElements();
  }

  _renderAccess() {
    const $ = (id) => this.shadowRoot.getElementById(id);
    const people = this._shares.map((share) => ({
      ...this._person(share.recipientUid),
      sharedAt: share.sharedAt,
    }));
    $('fp-access').hidden = people.length === 0;
    $('fp-access-count').textContent = String(people.length);
    $('fp-stack').replaceChildren(...people.slice(0, 3).map((person) => this._avatar(person)));
    $('fp-access-list').replaceChildren(
      ...people.map((person) => {
        const row = document.createElement('li');
        row.className = 'fp-row';
        const who = document.createElement('span');
        who.className = 'fp-who';
        const name = document.createElement('span');
        name.className = 'fp-name';
        name.textContent = person.name || UNNAMED;
        const meta = document.createElement('span');
        meta.className = 'fp-meta';
        meta.innerHTML = 'שותף ב־<span class="num"></span>';
        meta.querySelector('.num').textContent = dateOf(person.sharedAt);
        who.append(name, meta);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'fp-remove';
        remove.textContent = 'הסרה';
        remove.setAttribute('aria-label', `הסרת הגישה של ${person.name || UNNAMED}`);
        remove.addEventListener('click', () => this._remove(person.uid, remove));
        row.append(this._avatar(person), who, remove);
        return row;
      }),
    );
  }

  _renderFamily() {
    const $ = (id) => this.shadowRoot.getElementById(id);
    const withAccess = new Set(this._shares.map((share) => share.recipientUid));
    const others = this._family.filter((member) => !withAccess.has(member.uid));
    const query = $('fp-q').value.trim().toLowerCase();
    const shown = query
      ? others.filter((member) => (member.name || '').toLowerCase().includes(query))
      : others;

    $('fp-family').hidden = others.length === 0;
    if (this._family.length) {
      this._showMessage(others.length ? '' : 'כל בני המשפחה כבר יכולים לראות את המתכון.');
    }
    $('fp-family-count').textContent = String(others.length);
    $('fp-search').hidden = others.length < SEARCH_FROM;
    $('fp-no-match').hidden = shown.length > 0 || !query;
    $('fp-family-list').replaceChildren(
      ...shown.map((member) => {
        const item = document.createElement('li');
        const label = document.createElement('label');
        label.className = 'fp-row';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = this._selected.has(member.uid);
        label.classList.toggle('is-on', input.checked);
        input.addEventListener('change', () => {
          if (input.checked) this._selected.add(member.uid);
          else this._selected.delete(member.uid);
          label.classList.toggle('is-on', input.checked);
          this._updateShareButton();
        });
        const check = document.createElement('span');
        check.className = 'fp-check';
        check.innerHTML = CHECK;
        const who = document.createElement('span');
        who.className = 'fp-who';
        const name = document.createElement('span');
        name.className = 'fp-name';
        name.textContent = member.name || UNNAMED;
        who.append(name);
        label.append(input, check, this._avatar(member), who);
        item.append(label);
        return item;
      }),
    );
  }

  _updateShareButton() {
    const button = this.shadowRoot.getElementById('fp-share');
    const count = this._selected.size;
    button.disabled = count === 0 || this._busy;
    button.textContent = count ? `שיתוף עם ${count}` : 'שיתוף';
  }

  async _share() {
    if (!this._selected.size || this._busy) return;
    const { recipeId, authorId, authorName } = this._recipe;
    const recipientUids = [...this._selected];
    this._busy = true;
    this._updateShareButton();
    try {
      await RecipeShareService.share(recipeId, { authorId, authorName, recipientUids });
      this._selected.clear();
      const names = recipientUids.map((uid) => this._person(uid).name);
      const done = this.shadowRoot.getElementById('fp-done');
      this.shadowRoot.getElementById('fp-done-text').textContent = sharedWithText(names);
      // The note takes the intro's place, so the modal doesn't grow and jump.
      this.shadowRoot.getElementById('fp-intro').hidden = true;
      done.hidden = false;
      this.shadowRoot.getElementById('fp-cancel').textContent = 'סגירה';
      this._shares = await RecipeShareService.listForRecipe(recipeId, authorId);
      this._render();
      this._changed();
    } catch (error) {
      console.error('Error sharing the recipe:', error);
      showToast('לא הצלחנו לשתף את המתכון. נסו שוב.', 'error');
    } finally {
      this._busy = false;
      this._updateShareButton();
    }
  }

  async _remove(uid, button) {
    const { recipeId, authorId } = this._recipe;
    button.disabled = true;
    try {
      await RecipeShareService.remove(recipeId, uid);
      this._shares = await RecipeShareService.listForRecipe(recipeId, authorId);
      this._render();
      this._changed();
    } catch (error) {
      console.error('Error removing access:', error);
      button.disabled = false;
      showToast('לא הצלחנו להסיר את הגישה. נסו שוב.', 'error');
    }
  }

  async _sendLink() {
    const { recipeName, url } = this._recipe;
    try {
      const result = await shareOrCopy({ title: recipeName, text: recipeName, url }, url);
      if (result === 'copied') showToast('הקישור הועתק', 'success');
    } catch (error) {
      console.error('Error sharing the link:', error);
      showToast('לא הצלחנו להעתיק. נסו שוב.', 'error');
    }
  }

  _changed() {
    this.dispatchEvent(
      new CustomEvent('recipe-shares-changed', {
        bubbles: true,
        composed: true,
        detail: { recipeId: this._recipe.recipeId },
      }),
    );
  }

  async close(options) {
    await super.close(options);
    if (!this.isOpen) {
      this.shadowRoot.getElementById('fp-cancel').textContent = 'ביטול';
    }
  }
}

if (!customElements.get('share-family-modal')) {
  customElements.define('share-family-modal', ShareFamilyModal);
}
