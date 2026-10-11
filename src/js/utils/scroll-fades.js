/**
 * Fade the edges of a horizontally scrolling row that has more content beyond
 * them (styles: src/styles/components/scroll-fades.css). Works for LTR and RTL
 * rows (an RTL row's scrollLeft runs from 0 down to negative values).
 *
 * @param {HTMLElement} row - The scrolling element.
 * @returns {{ update: () => void, detach: () => void }} `update` re-measures
 *   (call after the content changes); `detach` removes the listeners.
 */
export function attachScrollFades(row) {
  row.classList.add('scroll-fades');
  const update = () => {
    const max = row.scrollWidth - row.clientWidth;
    const rtl = getComputedStyle(row).direction === 'rtl';
    const fromStart = Math.abs(row.scrollLeft);
    const left = rtl ? max - fromStart : fromStart; // hidden content on the left
    const right = rtl ? fromStart : max - fromStart; // hidden content on the right
    row.classList.toggle('more-left', left > 2);
    row.classList.toggle('more-right', right > 2);
  };
  row.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
  return {
    update,
    detach() {
      row.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    },
  };
}
