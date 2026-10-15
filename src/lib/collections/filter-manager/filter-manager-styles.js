/**
 * Filter Manager Component Styles
 * CSS-in-JS styles for Shadow DOM compatibility
 */

export const styles = `
  :host {
    display: block;
    width: auto;
  }

  .filter-manager {
    display: flex;
    align-items: center;
    position: relative;
    min-height: 36px;
  }

  .filter-button {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background-color: var(--surface-1, #fff);
    color: var(--ink-1, #1a1a1a);
    border: 1px solid var(--hairline-strong, rgba(31, 29, 24, 0.2));
    padding: 10px 16px;
    border-radius: var(--r-pill, 999px);
    cursor: pointer;
    transition:
      background-color var(--dur-1, 160ms) var(--ease, ease),
      transform var(--dur-1, 160ms) var(--ease, ease);
    font-size: 13px;
    font-family: var(--font-ui, system-ui, sans-serif);
    font-weight: 500;
    white-space: nowrap;
    height: 38px;
  }

  .filter-button:hover {
    background-color: var(--surface-2, #f2e8cf);
  }

  .filter-button:active:not(:disabled) {
    background-color: var(--surface-2, #f2e8cf);
    transform: scale(var(--press-scale, 0.97));
  }

  .filter-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .filter-button:disabled:hover {
    background-color: var(--surface-1, #fff);
  }

  .filter-button .icon {
    font-size: 1em;
    color: inherit;
  }

  .filter-badge {
    display: none;
    background-color: var(--primary-dark, #386641);
    color: #fff;
    border-radius: var(--r-pill, 999px);
    padding: 2px 7px;
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.04em;
    line-height: 1.4;
    align-items: center;
    justify-content: center;
  }

  .filter-badge.visible {
    display: inline-flex;
  }

  .error {
    color: var(--secondary-dark, #b03537);
    background-color: color-mix(in oklab, var(--secondary, #bc4749) 10%, var(--surface-0, #faf6ec));
    border: 1px solid color-mix(in oklab, var(--secondary, #bc4749) 20%, transparent);
    border-radius: var(--r-sm, 8px);
    padding: 8px 12px;
    font-size: var(--step--1, 0.875rem);
  }

  /* RTL support */
  :host([dir="rtl"]) .filter-manager {
    direction: rtl;
  }


  /* Animation for badge appearance */
  .filter-badge {
    transition: opacity var(--dur-1, 160ms) var(--ease, ease);
  }

  .filter-badge:not(.visible) {
    opacity: 0;
  }

  .filter-badge.visible {
    opacity: 1;
  }
`;
