/**
 * Dropdown menu controller: a button that opens a `.recipe-menu-dropdown`-style
 * panel (it shows while it has the `open` class).
 *
 * One place owns the open/closed state, so every way of closing — the button,
 * a tap outside, Escape, a menu item calling `close()` — also clears the
 * button's `aria-expanded` (which styles its "open" look). Only one menu is
 * open at a time: opening one closes any other.
 *
 * @example
 * const menu = createDropdownMenu({ button, dropdown, root: wrapper });
 * item.addEventListener('click', () => { menu.close(); doThing(); });
 * // unmount:
 * menu.destroy();
 */

/** Menus currently open, so opening one can close the others. */
const openMenus = new Set();

/**
 * @param {Object} options
 * @param {HTMLElement} options.button - Toggles the menu.
 * @param {HTMLElement} options.dropdown - The panel; shown with the `open` class.
 * @param {HTMLElement} [options.root] - Taps inside it don't count as "outside".
 *   Defaults to the button's parent.
 * @param {() => boolean|void} [options.beforeOpen] - Runs before opening; return
 *   `false` to stay closed (e.g. the button acts directly instead).
 * @returns {{ open: () => void, close: () => void, toggle: () => void, isOpen: () => boolean, destroy: () => void }}
 */
export function createDropdownMenu({ button, dropdown, root = button.parentElement, beforeOpen }) {
  const isOpen = () => dropdown.classList.contains('open');

  const close = () => {
    dropdown.classList.remove('open');
    button.setAttribute('aria-expanded', 'false');
    openMenus.delete(controller);
  };

  const open = () => {
    if (beforeOpen?.() === false) return;
    openMenus.forEach((other) => other !== controller && other.close());
    dropdown.classList.add('open');
    button.setAttribute('aria-expanded', 'true');
    openMenus.add(controller);
  };

  const toggle = () => (isOpen() ? close() : open());

  const onButtonClick = (event) => {
    event.stopPropagation();
    toggle();
  };
  const onDocumentClick = (event) => {
    if (isOpen() && !root.contains(event.target)) close();
  };
  const onKeydown = (event) => {
    if (event.key === 'Escape' && isOpen()) {
      close();
      button.focus();
    }
  };

  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', onButtonClick);
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onKeydown);

  const destroy = () => {
    close();
    button.removeEventListener('click', onButtonClick);
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onKeydown);
  };

  const controller = { open, close, toggle, isOpen, destroy };
  return controller;
}
