import { jest } from '@jest/globals';
import { createDropdownMenu } from 'src/lib/utilities/dropdown-menu/dropdown-menu.js';

function setup(id, options = {}) {
  const root = document.createElement('div');
  root.innerHTML = `<button id="${id}-btn"></button><div id="${id}-dd"><button id="${id}-item"></button></div>`;
  document.body.appendChild(root);
  const button = root.querySelector(`#${id}-btn`);
  const dropdown = root.querySelector(`#${id}-dd`);
  const menu = createDropdownMenu({ button, dropdown, root, ...options });
  return { root, button, dropdown, item: root.querySelector(`#${id}-item`), menu };
}

describe('createDropdownMenu', () => {
  let menus;

  beforeEach(() => {
    document.body.innerHTML = '<p id="outside">outside</p>';
    menus = [];
  });

  afterEach(() => {
    menus.forEach((m) => m.menu.destroy());
  });

  const make = (id, options) => {
    const m = setup(id, options);
    menus.push(m);
    return m;
  };

  test('starts closed with aria attributes set', () => {
    const { button, dropdown } = make('a');
    expect(dropdown.classList.contains('open')).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
  });

  test('the button toggles open and closed, keeping aria-expanded in sync', () => {
    const { button, dropdown } = make('a');
    button.click();
    expect(dropdown.classList.contains('open')).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    button.click();
    expect(dropdown.classList.contains('open')).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  test('a tap outside closes it and clears aria-expanded', () => {
    const { button, dropdown } = make('a');
    button.click();
    document.getElementById('outside').click();
    expect(dropdown.classList.contains('open')).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  test('a tap inside the root keeps it open', () => {
    const { button, dropdown, item } = make('a');
    button.click();
    item.click();
    expect(dropdown.classList.contains('open')).toBe(true);
  });

  test('close() from a menu item clears aria-expanded', () => {
    const { button, item, menu } = make('a');
    item.addEventListener('click', () => menu.close());
    button.click();
    item.click();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  test('Escape closes it', () => {
    const { button, dropdown } = make('a');
    button.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dropdown.classList.contains('open')).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  test('opening one menu closes the other', () => {
    const a = make('a');
    const b = make('b');
    a.button.click();
    b.button.click();
    expect(a.dropdown.classList.contains('open')).toBe(false);
    expect(a.button.getAttribute('aria-expanded')).toBe('false');
    expect(b.dropdown.classList.contains('open')).toBe(true);
  });

  test('beforeOpen returning false keeps it closed', () => {
    const beforeOpen = jest.fn(() => false);
    const { button, dropdown } = make('a', { beforeOpen });
    button.click();
    expect(beforeOpen).toHaveBeenCalledTimes(1);
    expect(dropdown.classList.contains('open')).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  test('destroy() closes it and stops listening', () => {
    const { button, dropdown, menu } = make('a');
    button.click();
    menu.destroy();
    expect(dropdown.classList.contains('open')).toBe(false);
    button.click();
    expect(dropdown.classList.contains('open')).toBe(false);
  });
});
