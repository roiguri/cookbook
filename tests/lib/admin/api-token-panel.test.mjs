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
    // The page answers with fresh data: the panel leaves the error state.
    panel.setData({ user: { id: 'u1', role: 'approved' }, tokens: [token('t1')], maxTokens: 3 });
    expect($('button.retry')).toBeNull();
    expect($$('li')).toHaveLength(1);
  });

  it('follows a role change made in the dashboard', () => {
    mount();
    $('button.add').click();
    panel.setRole('user');
    expect($('form')).toBeNull();
    expect(text()).toContain('זמין רק למשתמשים מאושרים');
  });
});
