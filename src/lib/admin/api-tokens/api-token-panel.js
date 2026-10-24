import { ApiTokenService, API_TOKEN_SCOPES } from '../../../js/services/admin/api-token-service.js';

const TOKEN_ROLES = ['approved', 'manager'];

const SCOPE_LABELS = {
  [API_TOKEN_SCOPES.READ]: 'קריאה',
  [API_TOKEN_SCOPES.READ_WRITE]: 'קריאה וכתיבה',
};

const ERROR_MESSAGES = {
  'functions/resource-exhausted': 'הגעתם למספר הטוקנים המרבי למשתמש.',
  'functions/failed-precondition': 'אפשר להנפיק טוקן רק למשתמשים מאושרים.',
  'functions/invalid-argument': 'הפרטים שהוזנו אינם תקינים.',
};

// What the busy button says while its action runs, and what screen readers hear.
const BUSY_LABELS = { create: 'יוצר…', revoke: 'מבטל…', retry: 'טוען…' };
const BUSY_STATUS = { create: 'יוצר טוקן…', revoke: 'מבטל טוקן…', retry: 'טוען טוקנים…' };

const day = new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' });
const dayTime = new Intl.DateTimeFormat('he-IL', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const STYLES = `
  :host { display: block; font-family: var(--font-ui-he); color: var(--ink); }
  /* One vertical rhythm: the panel's parts (title, note, list, button, form, error) are
     spaced by the column gap, never by their own margins. */
  .panel {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    border-top: 1px solid var(--hairline);
    margin-top: 12px;
    padding-top: 12px;
  }
  .panel > * { margin: 0; }
  .panel > ul, .panel > form { align-self: stretch; }
  h3 {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    color: var(--ink-3);
  }
  .note { margin: 0; font-size: 13px; color: var(--ink-3); }
  .load-error { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  ul { list-style: none; padding: 0; display: grid; gap: 8px; }
  li {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 8px 10px;
    border: 1px solid var(--hairline);
    border-radius: var(--r-sm);
    background: var(--surface-0);
  }
  .info { flex: 1; min-width: 0; display: grid; gap: 2px; }
  .name { font-size: 14px; font-weight: 600; overflow-wrap: anywhere; unicode-bidi: isolate; }
  .meta { font-size: 12px; color: var(--ink-3); }
  .prefix { font-family: var(--font-mono); direction: ltr; unicode-bidi: isolate; }
  .tag {
    font-size: 11px;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: var(--r-pill);
    border: 1px solid var(--hairline-strong);
    white-space: nowrap;
  }
  .tag--inactive { color: var(--secondary-dark); border-color: var(--secondary); }
  button {
    font-family: var(--font-ui-he);
    font-size: 13px;
    font-weight: 500;
    padding: 7px 14px;
    border-radius: var(--r-pill);
    border: 1px solid var(--hairline-strong);
    background: var(--surface-0);
    color: var(--ink);
    cursor: pointer;
    transition: transform var(--dur-1) var(--ease);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  button:active:not(:disabled) { transform: scale(var(--press-scale, 0.97)); }
  button:focus-visible, input:focus-visible, select:focus-visible { outline: none; box-shadow: var(--ring); }
  button:disabled { opacity: 0.55; cursor: default; }
  .primary { background: var(--primary); border-color: var(--primary); color: var(--button-color); }
  .danger { color: var(--secondary-dark); }
  form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  input, select {
    font-family: var(--font-ui-he);
    font-size: 13px;
    padding: 7px 10px;
    border: 1.5px solid var(--hairline-strong);
    border-radius: var(--r-sm);
    background: var(--surface-0);
    color: var(--ink);
  }
  input { flex: 1; min-width: 140px; }
  .form-actions { display: flex; gap: 8px; }
  .error { font-size: 13px; color: var(--secondary-dark); }
  /* Action buttons hold both labels in one grid cell, so the width fits the longer one
     and never changes when the busy label shows. */
  .labels { display: inline-grid; }
  .labels > span {
    grid-area: 1 / 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  .labels > .busy, button[aria-busy='true'] .labels > .idle { visibility: hidden; }
  button[aria-busy='true'] .labels > .busy { visibility: visible; }
  /* The busy button keeps full opacity so its spinner and label read clearly. */
  button[aria-busy='true']:disabled { opacity: 1; cursor: progress; }
  .spinner {
    width: 12px;
    height: 12px;
    box-sizing: border-box;
    border: 2px solid currentColor;
    border-inline-end-color: transparent;
    border-radius: 50%;
    animation: api-token-spin 0.8s linear infinite;
  }
  @keyframes api-token-spin { to { transform: rotate(360deg); } }
  /* Reduced motion: a still ring; the busy label says what is happening. */
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  [hidden] { display: none !important; }
`;

/**
 * `<api-token-panel>` — one user's recipe-API tokens, in the dashboard's
 * expanded user record (docs/feature-plans/recipe-api.md, slice 2).
 *
 * The page sets the data and owns the modals:
 *   panel.setData({ user: { id, role }, tokens, maxTokens, labelOf, loadError })
 *   panel.setRole(role)              // after the role is changed in the dashboard
 *   await panel.revoke(tokenId)      // once the page has confirmed
 *
 * @fires api-token-created - `{ secret, token }`: show the secret once, then drop it.
 * @fires api-token-revoke  - `{ token }`: the manager asked to revoke; confirm first.
 * @fires api-token-retry   - the tokens failed to load and the manager asked to retry.
 */
class ApiTokenPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._user = null;
    this._tokens = [];
    this._maxTokens = 0;
    this._labelOf = (uid) => uid;
    this._formOpen = false;
    this._draft = { name: '', scope: API_TOKEN_SCOPES.READ_WRITE };
    // The running action, if any: { action: 'create' | 'revoke' | 'retry', tokenId? }.
    // While set, every control is disabled and the acting button shows a busy label.
    this._pending = null;
    this._error = '';
    this._loadError = false;
    // Where focus goes after the next render (re-renders replace the controls).
    this._focusNext = null;

    // Style and the live status persist; render() replaces only the content, so a
    // status change is announced rather than re-created.
    const style = document.createElement('style');
    style.textContent = STYLES;
    this._status = document.createElement('p');
    this._status.className = 'sr-only';
    this._status.setAttribute('role', 'status');
    this._content = document.createElement('div');
    this.shadowRoot.append(style, this._status, this._content);
  }

  connectedCallback() {
    this.render();
  }

  /**
   * @param {{ user: { id: string, role: string }, tokens: Array<Object>,
   *   maxTokens: number, labelOf?: (uid: string) => string, loadError?: boolean }} data
   */
  setData({ user, tokens = [], maxTokens = 0, labelOf, loadError = false }) {
    this._loadError = loadError;
    if (this._pending?.action === 'retry') this._pending = null; // the page answered
    this._user = user;
    this._tokens = [...tokens].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    this._maxTokens = maxTokens;
    if (labelOf) this._labelOf = labelOf;
    this.render();
  }

  setRole(role) {
    if (!this._user) return;
    this._user = { ...this._user, role };
    if (!this._eligible()) this._formOpen = false;
    this.render();
  }

  /** Revoke a token (the page has already confirmed). */
  async revoke(tokenId) {
    const mine = { action: 'revoke', tokenId };
    this._setPending(mine);
    try {
      await ApiTokenService.revoke(tokenId);
      this._tokens = this._tokens.filter((t) => t.tokenId !== tokenId);
      this._error = '';
    } catch (error) {
      this._error = ERROR_MESSAGES[error?.code] || 'ביטול הטוקן נכשל. נסו שוב.';
    } finally {
      this._focusNext = 'after-revoke';
      this._finish(mine);
    }
  }

  _eligible() {
    return TOKEN_ROLES.includes(this._user?.role);
  }

  _setPending(pending) {
    this._pending = pending;
    this.render();
  }

  /** An action ended: clear the busy state only if it is still this action's. */
  _finish(mine) {
    if (this._pending === mine) this._pending = null;
    this.render();
  }

  /** Disable every control; the acting button shows a spinner and its busy label. */
  _applyPending() {
    const root = this.shadowRoot;
    root.querySelectorAll('button, input, select').forEach((el) => {
      el.disabled = true;
    });
    const { action, tokenId } = this._pending;
    const button = [...root.querySelectorAll(`button[data-action="${action}"]`)].find(
      (b) => action !== 'revoke' || b.dataset.tokenId === tokenId,
    );
    button?.setAttribute('aria-busy', 'true');
  }

  /**
   * A button for an action with a busy state. Both labels share one grid cell, so the
   * button is as wide as the longer one whichever is showing.
   */
  _actionButton(action, label, { className = '', type = 'button', tokenId } = {}) {
    const button = document.createElement('button');
    button.type = type;
    button.className = className;
    button.dataset.action = action;
    if (tokenId) button.dataset.tokenId = tokenId;
    const labels = document.createElement('span');
    labels.className = 'labels';
    const idle = document.createElement('span');
    idle.className = 'idle';
    idle.textContent = label;
    const busy = document.createElement('span');
    busy.className = 'busy';
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    spinner.setAttribute('aria-hidden', 'true');
    busy.append(spinner, BUSY_LABELS[action]);
    labels.append(idle, busy);
    button.append(labels);
    return button;
  }

  async _create(name, scope) {
    const mine = { action: 'create' };
    this._setPending(mine);
    try {
      const { token: secret, ...token } = await ApiTokenService.create({
        uid: this._user.id,
        name,
        scope,
      });
      this._tokens = [...this._tokens, token];
      this._formOpen = false;
      this._draft = { name: '', scope: API_TOKEN_SCOPES.READ_WRITE };
      this._error = '';
      this.dispatchEvent(
        new CustomEvent('api-token-created', { detail: { secret, token }, bubbles: false }),
      );
    } catch (error) {
      this._error = ERROR_MESSAGES[error?.code] || 'יצירת הטוקן נכשלה. נסו שוב.';
      this._focusNext = 'name';
    } finally {
      this._finish(mine);
    }
  }

  render() {
    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.dir = 'rtl';
    this._content.replaceChildren(panel);
    this._renderContent(panel);
    if (this._pending) this._applyPending();
    const status = this._pending ? BUSY_STATUS[this._pending.action] : '';
    if (this._status.textContent !== status) this._status.textContent = status;
    this._applyFocus();
  }

  /** Put focus back where the manager was, after a re-render replaced the controls. */
  _applyFocus() {
    const target = this._focusNext;
    if (!target || this._pending) return;
    this._focusNext = null;
    const root = this.shadowRoot;
    const el =
      target === 'name'
        ? root.querySelector('form input')
        : root.querySelector('button.add') || root.querySelector('button.danger');
    el?.focus();
  }

  _renderContent(panel) {
    const title = document.createElement('h3');
    title.textContent = 'גישת API';
    panel.append(title);

    if (!this._user) return;

    if (this._loadError) {
      const row = document.createElement('div');
      row.className = 'load-error';
      const retry = this._actionButton('retry', 'נסו שוב', { className: 'retry' });
      // Busy until the page answers with setData (success or another error).
      retry.addEventListener('click', () => {
        this._setPending({ action: 'retry' });
        this.dispatchEvent(new CustomEvent('api-token-retry'));
      });
      row.append(this._note('לא ניתן לטעון את הטוקנים.'), retry);
      panel.append(row);
      return;
    }

    const eligible = this._eligible();

    if (!eligible && this._tokens.length === 0) {
      panel.append(this._note('זמין רק למשתמשים מאושרים.'));
      return;
    }
    if (eligible && this._tokens.length === 0 && !this._formOpen) {
      panel.append(this._note('אין טוקנים.'));
    }

    if (this._tokens.length) {
      const list = document.createElement('ul');
      this._tokens.forEach((token) => list.append(this._row(token, eligible)));
      panel.append(list);
    }

    if (eligible) {
      if (this._formOpen) panel.append(this._form());
      else if (this._tokens.length < this._maxTokens) {
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'add';
        add.textContent = '+ טוקן חדש';
        add.addEventListener('click', () => {
          this._formOpen = true;
          this._error = '';
          this.render();
          this.shadowRoot.querySelector('input')?.focus();
        });
        panel.append(add);
      } else {
        panel.append(this._note(`לכל משתמש עד ${this._maxTokens} טוקנים.`));
      }
    }

    if (this._error) {
      const error = document.createElement('p');
      error.className = 'error';
      error.setAttribute('role', 'alert');
      error.textContent = this._error;
      panel.append(error);
    }
  }

  _note(text) {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = text;
    return p;
  }

  _row(token, eligible) {
    const li = document.createElement('li');
    li.dataset.tokenId = token.tokenId;

    const info = document.createElement('div');
    info.className = 'info';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = token.name; // user data
    const meta = document.createElement('span');
    meta.className = 'meta';
    const prefix = document.createElement('span');
    prefix.className = 'prefix';
    prefix.textContent = `${token.prefix}…`;
    const created = token.createdAt ? day.format(token.createdAt) : '—';
    const used = token.lastUsedAt
      ? `שימוש אחרון: ${dayTime.format(token.lastUsedAt)}`
      : 'לא נעשה שימוש';
    meta.append(prefix, ` · נוצר ${created} ע״י ${this._labelOf(token.createdBy)} · ${used}`);
    info.append(name, meta);

    const scope = document.createElement('span');
    scope.className = 'tag';
    scope.textContent = SCOPE_LABELS[token.scope] || token.scope;
    li.append(info, scope);

    if (!eligible) {
      const inactive = document.createElement('span');
      inactive.className = 'tag tag--inactive';
      inactive.textContent = 'לא פעיל (תפקיד)';
      li.append(inactive);
    }

    const revoke = this._actionButton('revoke', 'בטל', {
      className: 'danger',
      tokenId: token.tokenId,
    });
    revoke.addEventListener('click', () =>
      this.dispatchEvent(new CustomEvent('api-token-revoke', { detail: { token } })),
    );
    li.append(revoke);
    return li;
  }

  _form() {
    const form = document.createElement('form');
    const name = document.createElement('input');
    name.name = 'name';
    name.required = true;
    name.maxLength = 60;
    name.placeholder = 'שם הטוקן (למשל Jarvis)';
    name.setAttribute('aria-label', 'שם הטוקן');

    const scope = document.createElement('select');
    scope.name = 'scope';
    scope.setAttribute('aria-label', 'הרשאות');
    for (const [value, label] of Object.entries(SCOPE_LABELS)) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      scope.append(option);
    }
    // The draft survives re-renders (e.g. a server error), so nothing typed is lost.
    name.value = this._draft.name;
    scope.value = this._draft.scope;
    name.addEventListener('input', () => {
      this._draft.name = name.value;
    });
    scope.addEventListener('change', () => {
      this._draft.scope = scope.value;
    });

    const create = this._actionButton('create', 'צור', { className: 'primary', type: 'submit' });
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'ביטול';
    cancel.addEventListener('click', () => {
      this._formOpen = false;
      this._draft = { name: '', scope: API_TOKEN_SCOPES.READ_WRITE };
      this._error = '';
      this.render();
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this._draft = { name: name.value, scope: scope.value };
      const value = name.value.trim();
      if (!value || this._pending) return;
      this._create(value, scope.value);
    });
    // The two buttons wrap together, never one per line.
    const actions = document.createElement('div');
    actions.className = 'form-actions';
    actions.append(cancel, create);
    form.append(name, scope, actions);
    return form;
  }
}

if (!customElements.get('api-token-panel')) {
  customElements.define('api-token-panel', ApiTokenPanel);
}
