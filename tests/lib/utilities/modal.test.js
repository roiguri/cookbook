import 'src/lib/utilities/modal/modal.js';

describe('custom-modal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('element registers and attaches a shadow root', () => {
    const el = document.createElement('custom-modal');
    document.body.appendChild(el);
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.shadowRoot).not.toBeNull();
  });

  test('without fullscreen-mobile attribute, host has no such attribute', () => {
    const el = document.createElement('custom-modal');
    document.body.appendChild(el);
    expect(el.hasAttribute('fullscreen-mobile')).toBe(false);
  });

  test('fullscreen-mobile attribute is exposed on the host', () => {
    const el = document.createElement('custom-modal');
    el.setAttribute('fullscreen-mobile', '');
    document.body.appendChild(el);
    expect(el.hasAttribute('fullscreen-mobile')).toBe(true);
  });

  test('shadow root styles contain the :host([fullscreen-mobile]) rule inside the mobile media query', () => {
    const el = document.createElement('custom-modal');
    document.body.appendChild(el);
    const css = el.shadowRoot.querySelector('style').textContent;
    expect(css).toMatch(/@media \(max-width:\s*768px\)/);
    expect(css).toMatch(/:host\(\[fullscreen-mobile\]\)\s*\.modal-content/);
    expect(css).toMatch(/100dvh/);
  });

  test('open() and close() toggle isOpen', async () => {
    const el = document.createElement('custom-modal');
    document.body.appendChild(el);
    el.open();
    expect(el.isOpen).toBe(true);
    await el.close();
    expect(el.isOpen).toBe(false);
  });
});
