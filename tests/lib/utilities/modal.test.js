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

  describe('scroll lock', () => {
    const rootOverflow = () => document.documentElement.style.overflow;
    const makeModal = () => {
      const el = document.createElement('custom-modal');
      document.body.appendChild(el);
      return el;
    };

    test('locks the document root (the SPA scroller) while open', async () => {
      const el = makeModal();
      el.open();
      expect(rootOverflow()).toBe('hidden');
      await el.close();
      expect(rootOverflow()).toBe('');
    });

    test('stacked modals keep the page locked until the last one closes', async () => {
      const outer = makeModal();
      const inner = makeModal();
      outer.open();
      inner.open();
      await inner.close();
      expect(rootOverflow()).toBe('hidden');
      await outer.close();
      expect(rootOverflow()).toBe('');
    });

    test('closing twice does not release a lock held by another modal', async () => {
      const a = makeModal();
      const b = makeModal();
      a.open();
      b.open();
      await b.close();
      b.unlockScroll();
      expect(rootOverflow()).toBe('hidden');
      await a.close();
      expect(rootOverflow()).toBe('');
    });

    test('removing an open modal from the DOM releases its lock', () => {
      const el = makeModal();
      el.open();
      el.remove();
      expect(el.isOpen).toBe(false);
      expect(rootOverflow()).toBe('');
    });
  });
});
