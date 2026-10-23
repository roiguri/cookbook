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
  .error { font-size: 13px; color: var(--secondary-dark); }
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
    this._busy = false;
    this._error = '';
    this._loadError = false;
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
    this._setBusy(true);
    try {
      await ApiTokenService.revoke(tokenId);
      this._tokens = this._tokens.filter((t) => t.tokenId !== tokenId);
      this._error = '';
    } catch (error) {
      this._error = ERROR_MESSAGES[error?.code] || 'ביטול הטוקן נכשל. נסו שוב.';
    } finally {
      this._busy = false;
      this.render();
    }
  }

  _eligible() {
    return TOKEN_ROLES.includes(this._user?.role);
  }

  _setBusy(busy) {
    this._busy = busy;
    this.shadowRoot.querySelectorAll('button, input, select').forEach((el) => {
      el.disabled = busy;
    });
  }

  async _create(name, scope) {
    this._setBusy(true);
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
    } finally {
      this._busy = false;
      this.render();
    }
  }

  render() {
    const root = this.shadowRoot;
    root.innerHTML = '';
    const style = document.createElement('style');
    style.textContent = STYLES;
    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.dir = 'rtl';
    root.append(style, panel);

    const title = document.createElement('h3');
    title.textContent = 'גישת API';
    panel.append(title);

    if (!this._user) return;

    if (this._loadError) {
      const row = document.createElement('div');
      row.className = 'load-error';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'retry';
      retry.textContent = 'נסו שוב';
      // Disabled until the page answers with setData (success or another error).
      retry.addEventListener('click', () => {
        retry.disabled = true;
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
    if (this._busy) this._setBusy(true);
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

    const revoke = document.createElement('button');
    revoke.type = 'button';
    revoke.className = 'danger';
    revoke.textContent = 'בטל';
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

    const create = document.createElement('button');
    create.type = 'submit';
    create.className = 'primary';
    create.textContent = 'צור';
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
      if (!value || this._busy) return;
      this._create(value, scope.value);
    });
    form.append(name, scope, create, cancel);
    return form;
  }
}

if (!customElements.get('api-token-panel')) {
  customElements.define('api-token-panel', ApiTokenPanel);
}
