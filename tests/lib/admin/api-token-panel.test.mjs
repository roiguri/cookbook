import { jest } from '@jest/globals';

const service = { create: jest.fn(), revoke: jest.fn() };
jest.unstable_mockModule('src/js/services/admin/api-token-service.js', () => ({
  ApiTokenService: service,
  API_TOKEN_SCOPES: { READ: 'read', READ_WRITE: 'read+write' },
}));

beforeAll(async () => {
  await import('src/lib/admin/api-tokens/api-token-panel.js');
});

const token = (id, extra = {}) => ({
  tokenId: id,
  uid: 'u1',
  name: `Token ${id}`,
  scope: 'read+write',
  prefix: 'ckb_abcd',
  createdBy: 'm1',
  createdAt: Date.UTC(2026, 9, 24),
  lastUsedAt: null,
  ...extra,
});

let panel;
const $ = (sel) => panel.shadowRoot.querySelector(sel);
const $$ = (sel) => [...panel.shadowRoot.querySelectorAll(sel)];
const text = () => panel.shadowRoot.textContent;
const flush = () => new Promise((r) => setTimeout(r, 0));
// The label a button shows: action buttons hold an idle and a busy label.
const shown = (button) =>
  button.querySelector(button.getAttribute('aria-busy') === 'true' ? '.busy' : '.idle')
    ?.textContent ?? button.textContent;
const status = () => panel.shadowRoot.querySelector('[role="status"]').textContent;

function mount({ role = 'approved', tokens = [], maxTokens = 3 } = {}) {
  panel = document.createElement('api-token-panel');
  document.body.append(panel);
  panel.setData({
    user: { id: 'u1', role },
    tokens,
    maxTokens,
    labelOf: (uid) => (uid === 'm1' ? 'רועי' : uid),
  });
}

function fillAndSubmit(name, scope = 'read') {
  $('button.add').click();
  $('input').value = name;
  $('select').value = scope;
  $('form').dispatchEvent(new Event('submit', { cancelable: true }));
}

afterEach(() => {
  panel?.remove();
  service.create.mockReset();
  service.revoke.mockReset();
});

describe('<api-token-panel>', () => {
  it('lists tokens with scope, creator and usage, and no secret', () => {
    mount({ tokens: [token('t1', { lastUsedAt: Date.UTC(2026, 9, 24, 10) }), token('t2')] });
    expect($$('li')).toHaveLength(2);
    expect(text()).toContain('Token t1');
    expect(text()).toContain('קריאה וכתיבה');
    expect(text()).toContain('ע״י רועי');
    expect(text()).toContain('שימוש אחרון');
    expect(text()).toContain('לא נעשה שימוש');
    expect(text()).toContain('ckb_abcd…');
  });

  it('renders token names as text, not HTML', () => {
    mount({ tokens: [token('t1', { name: '<img src=x onerror=alert(1)>' })] });
    expect($('img')).toBeNull();
    expect(text()).toContain('<img src=x');
  });

  it('offers no tokens to a plain user', () => {
    mount({ role: 'user' });
    expect(text()).toContain('זמין רק למשתמשים מאושרים');
    expect($('button')).toBeNull();
  });

  it("marks a demoted user's tokens inactive but still revocable", () => {
    mount({ role: 'user', tokens: [token('t1')] });
    expect(text()).toContain('לא פעיל (תפקיד)');
    expect($('button.add')).toBeNull();
    expect($('button.danger')).not.toBeNull();
  });

  it('hides "new token" at the cap', () => {
    mount({ tokens: [token('a'), token('b'), token('c')], maxTokens: 3 });
    expect($('button.add')).toBeNull();
    expect(text()).toContain('עד 3 טוקנים');
  });

  it('creates a token, adds it to the list and hands the secret to the page once', async () => {
    mount();
    service.create.mockResolvedValue({ ...token('new', { name: 'Jarvis' }), token: 'ckb_SECRET' });
    const created = jest.fn();
    panel.addEventListener('api-token-created', (e) => created(e.detail));

    fillAndSubmit('  Jarvis ', 'read');
    await flush();

    expect(service.create).toHaveBeenCalledWith({ uid: 'u1', name: 'Jarvis', scope: 'read' });
    expect(created).toHaveBeenCalledTimes(1);
    expect(created.mock.calls[0][0].secret).toBe('ckb_SECRET');
    expect(created.mock.calls[0][0].token).not.toHaveProperty('token');
    expect(text()).toContain('Jarvis');
    expect(text()).not.toContain('ckb_SECRET');
    expect($('form')).toBeNull();
  });

  it('ignores an empty name', async () => {
    mount();
    fillAndSubmit('   ');
    await flush();
    expect(service.create).not.toHaveBeenCalled();
  });

  it('shows a Hebrew error when the cap is hit on the server', async () => {
    mount();
    service.create.mockRejectedValue({ code: 'functions/resource-exhausted' });
    fillAndSubmit('Jarvis');
    await flush();
    expect($('.error').textContent).toContain('מספר הטוקנים המרבי');
    expect($('form')).not.toBeNull();
  });

  it('asks the page to confirm a revoke, then removes the token', async () => {
    mount({ tokens: [token('t1'), token('t2')] });
    const asked = jest.fn();
    panel.addEventListener('api-token-revoke', (e) => asked(e.detail.token.tokenId));
    $('li[data-token-id="t1"] button.danger').click();
    expect(asked).toHaveBeenCalledWith('t1');
    expect(service.revoke).not.toHaveBeenCalled();

    service.revoke.mockResolvedValue();
    await panel.revoke('t1');
    expect(service.revoke).toHaveBeenCalledWith('t1');
    expect($('li[data-token-id="t1"]')).toBeNull();
    expect($('li[data-token-id="t2"]')).not.toBeNull();
  });

  it('keeps the token and shows an error when a revoke fails', async () => {
    mount({ tokens: [token('t1')] });
    service.revoke.mockRejectedValue({ code: 'functions/internal' });
    await panel.revoke('t1');
    expect($('li[data-token-id="t1"]')).not.toBeNull();
    expect($('.error')).not.toBeNull();
  });

  it('keeps what was typed when the server refuses', async () => {
    mount();
    service.create.mockRejectedValue({ code: 'functions/resource-exhausted' });
    fillAndSubmit('Jarvis', 'read');
    await flush();
    expect($('input').value).toBe('Jarvis');
    expect($('select').value).toBe('read');
  });

  it('says when the tokens could not be loaded, and asks the page to retry', () => {
    panel = document.createElement('api-token-panel');
    document.body.append(panel);
    panel.setData({ user: { id: 'u1', role: 'approved' }, loadError: true });
    expect(text()).toContain('לא ניתן לטעון את הטוקנים');
    expect($('button.add')).toBeNull();
    const retry = jest.fn();
    panel.addEventListener('api-token-retry', retry);
    $('button.retry').click();
    expect(retry).toHaveBeenCalled();
    expect($('button.retry').disabled).toBe(true);
    expect($('button.retry').getAttribute('aria-busy')).toBe('true');
    // The page answers with fresh data: the panel leaves the error state.
    panel.setData({ user: { id: 'u1', role: 'approved' }, tokens: [token('t1')], maxTokens: 3 });
    expect($('button.retry')).toBeNull();
    expect($$('li')).toHaveLength(1);
  });

  it('puts cancel before create in the form', () => {
    mount();
    $('button.add').click();
    const labels = $$('form button').map(shown);
    expect(labels).toEqual(['ביטול', 'צור']);
  });

  it('shows a busy create button and locks the panel while creating', async () => {
    mount({ tokens: [token('t1')] });
    let finish;
    service.create.mockReturnValue(new Promise((r) => (finish = r)));
    fillAndSubmit('Jarvis');
    const create = $('button[data-action="create"]');
    expect(shown(create)).toBe('יוצר…');
    expect(status()).toBe('יוצר טוקן…');
    expect(create.getAttribute('aria-busy')).toBe('true');
    expect(create.querySelector('.spinner')).not.toBeNull();
    expect($$('button, input, select').every((el) => el.disabled)).toBe(true);
    // A second submit while busy does nothing.
    $('form').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(service.create).toHaveBeenCalledTimes(1);

    finish({ ...token('new', { name: 'Jarvis' }), token: 'ckb_S' });
    await flush();
    expect($('[aria-busy="true"]')).toBeNull();
    expect($$('button').some((b) => b.disabled)).toBe(false);
    expect(status()).toBe('');
  });

  it('shows "revoking" on that row only while a revoke runs', async () => {
    mount({ tokens: [token('t1'), token('t2')] });
    let finish;
    service.revoke.mockReturnValue(new Promise((r) => (finish = r)));
    const done = panel.revoke('t1');
    const busy = $('li[data-token-id="t1"] button.danger');
    expect(shown(busy)).toBe('מבטל…');
    expect(busy.getAttribute('aria-busy')).toBe('true');
    const other = $('li[data-token-id="t2"] button.danger');
    expect(shown(other)).toBe('בטל');
    expect(other.disabled).toBe(true);

    finish();
    await done;
    expect($('li[data-token-id="t1"]')).toBeNull();
    expect($('li[data-token-id="t2"] button.danger').disabled).toBe(false);
  });

  it('shows "loading" on retry until the page answers', () => {
    panel = document.createElement('api-token-panel');
    document.body.append(panel);
    panel.setData({ user: { id: 'u1', role: 'approved' }, loadError: true });
    $('button.retry').click();
    expect(shown($('button.retry'))).toBe('טוען…');
    // The page answers with another failure: back to an active retry button.
    panel.setData({ user: { id: 'u1', role: 'approved' }, loadError: true });
    expect(shown($('button.retry'))).toBe('נסו שוב');
    expect($('button.retry').disabled).toBe(false);
    expect($('button.retry').getAttribute('aria-busy')).toBeNull();
  });

  it('reserves the longer label in every action button, so its width never changes', () => {
    mount({ tokens: [token('t1')] });
    $('button.add').click();
    for (const [selector, idle, busy] of [
      ['button[data-action="create"]', 'צור', 'יוצר…'],
      ['button[data-action="revoke"]', 'בטל', 'מבטל…'],
    ]) {
      const button = $(selector);
      const cell = button.querySelector('.labels');
      // Both labels are always in the button, stacked in one grid cell.
      expect(cell.querySelector('.idle').textContent).toBe(idle);
      expect(cell.querySelector('.busy').textContent).toBe(busy);
      expect(cell.querySelector('.busy .spinner')).not.toBeNull();
    }
  });

  it('a failed create clears the busy state, keeps the draft and focuses the name', async () => {
    mount();
    service.create.mockRejectedValue({ code: 'functions/internal' });
    fillAndSubmit('Jarvis', 'read');
    await flush();
    expect($('[aria-busy="true"]')).toBeNull();
    expect($$('button, input, select').some((el) => el.disabled)).toBe(false);
    expect($('.error').textContent).toContain('נכשלה');
    expect($('input').value).toBe('Jarvis');
    expect(panel.shadowRoot.activeElement).toBe($('input'));
  });

  it('a failed revoke clears the busy state, shows the error and keeps the token', async () => {
    mount({ tokens: [token('t1')] });
    service.revoke.mockRejectedValue({ code: 'functions/internal' });
    await panel.revoke('t1');
    expect($('[aria-busy="true"]')).toBeNull();
    expect($('li[data-token-id="t1"] button.danger').disabled).toBe(false);
    expect($('.error')).not.toBeNull();
    expect(status()).toBe('');
  });

  it('moves focus to "new token" after a revoke', async () => {
    mount({ tokens: [token('t1')] });
    service.revoke.mockResolvedValue();
    await panel.revoke('t1');
    expect(panel.shadowRoot.activeElement).toBe($('button.add'));
  });

  it('stays busy when the page sends fresh data or a role mid-action', async () => {
    mount({ tokens: [token('t1')] });
    let finish;
    service.revoke.mockReturnValue(new Promise((r) => (finish = r)));
    const done = panel.revoke('t1');
    panel.setData({ user: { id: 'u1', role: 'approved' }, tokens: [token('t1')], maxTokens: 3 });
    expect(shown($('li[data-token-id="t1"] button.danger'))).toBe('מבטל…');
    panel.setRole('manager');
    expect(shown($('li[data-token-id="t1"] button.danger'))).toBe('מבטל…');
    finish();
    await done;
    expect($('[aria-busy="true"]')).toBeNull();
  });

  it('a demotion during a create leaves nothing stuck', async () => {
    mount();
    let finish;
    service.create.mockReturnValue(new Promise((r) => (finish = r)));
    fillAndSubmit('Jarvis');
    panel.setRole('user'); // the form (and its busy button) disappears
    finish({ ...token('new', { name: 'Jarvis' }), token: 'ckb_S' });
    await flush();
    expect($('[aria-busy="true"]')).toBeNull();
    expect($$('button').every((b) => !b.disabled)).toBe(true);
  });

  it('overlapping actions: the first to finish does not unlock the other', async () => {
    mount({ tokens: [token('t1')] });
    let finishCreate;
    let finishRevoke;
    service.create.mockReturnValue(new Promise((r) => (finishCreate = r)));
    service.revoke.mockReturnValue(new Promise((r) => (finishRevoke = r)));
    fillAndSubmit('Jarvis');
    const revoking = panel.revoke('t1'); // e.g. a confirmation answered meanwhile
    finishCreate({ ...token('new', { name: 'Jarvis' }), token: 'ckb_S' });
    await flush();
    // The revoke is still running: still busy, still locked.
    expect(shown($('li[data-token-id="t1"] button.danger'))).toBe('מבטל…');
    expect($$('button').every((b) => b.disabled)).toBe(true);
    finishRevoke();
    await revoking;
    expect($('[aria-busy="true"]')).toBeNull();
  });

  it('follows a role change made in the dashboard', () => {
    mount();
    $('button.add').click();
    panel.setRole('user');
    expect($('form')).toBeNull();
    expect(text()).toContain('זמין רק למשתמשים מאושרים');
  });
});
