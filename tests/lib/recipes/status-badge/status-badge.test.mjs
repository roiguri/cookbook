beforeAll(async () => {
  await import('src/lib/recipes/status-badge/status-badge.js');
});

const badge = (attrs) => {
  const el = document.createElement('status-badge');
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  document.body.appendChild(el);
  return el;
};

describe('<status-badge>', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows a recipe status label', () => {
    const el = badge({ status: 'to-try' });
    expect(el.hidden).toBe(false);
    expect(el.shadowRoot.querySelector('.badge--to-try').textContent).toBe('לנסות');
  });

  it('shows who shared a recipe, as text', () => {
    const el = badge({ status: 'shared', name: '<b>דנה</b>' });
    const label = el.shadowRoot.querySelector('.badge--shared');
    expect(label.textContent).toBe('מ־<b>דנה</b>');
    expect(label.querySelector('b')).toBeNull();
    expect(label.title).toBe('מ־<b>דנה</b>');
  });

  it('falls back when the sharer has no name, and renders nothing for unknown statuses', () => {
    expect(badge({ status: 'shared' }).shadowRoot.textContent).toContain('שותף איתך');
    expect(badge({ status: 'nope' }).hidden).toBe(true);
  });
});
