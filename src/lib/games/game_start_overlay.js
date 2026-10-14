import styles from './game_start_overlay.css?inline';

// Shared "how to play" card shown before a round starts. Same look as the
// Knife Skills / Pizzatron start screens, factored out so new games don't
// each copy the markup and CSS.
//
// Games include START_OVERLAY_STYLES in their own <style> block (they render
// their styles inline so they work inside shadow roots too), then call
// showStartOverlay() with the element the card should cover.
export const START_OVERLAY_STYLES = styles;

/**
 * @param {HTMLElement} host - positioned element the overlay covers (inset: 0)
 * @param {{emoji: string, title: string, instructions: string, buttonLabel?: string, onStart: () => void}} options
 * @returns {() => void} remove — takes the overlay down without starting
 */
export function showStartOverlay(host, { emoji, title, instructions, buttonLabel, onStart }) {
  const overlay = document.createElement('div');
  overlay.className = 'game-start-overlay';
  overlay.innerHTML = `
    <div class="game-start-card">
      <div class="game-start-emoji" aria-hidden="true"></div>
      <h3 class="game-start-title"></h3>
      <p class="game-start-instructions"></p>
      <button class="game-start-btn" type="button"></button>
    </div>
  `;
  overlay.querySelector('.game-start-emoji').textContent = emoji;
  overlay.querySelector('.game-start-title').textContent = title;
  overlay.querySelector('.game-start-instructions').textContent = instructions;
  const btn = overlay.querySelector('.game-start-btn');
  btn.textContent = buttonLabel || 'התחל';

  const remove = () => overlay.remove();
  btn.addEventListener('click', () => {
    remove();
    onStart();
  });

  host.appendChild(overlay);
  return remove;
}
