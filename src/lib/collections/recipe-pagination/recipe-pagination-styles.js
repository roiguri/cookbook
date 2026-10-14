/**
 * Recipe Pagination Component Styles
 * CSS-in-JS styles for Shadow DOM compatibility
 */

export const styles = `
  :host {
    display: block;
    width: 100%;
  }

  .recipe-pagination {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    margin-top: auto;
    width: 100%;
  }

  .pagination-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-1, #fff);
    color: var(--ink-2, #3a3a3a);
    border: 1px solid var(--hairline-strong, rgba(31, 29, 24, 0.2));
    padding: 8px 18px;
    cursor: pointer;
    border-radius: var(--r-pill, 999px);
    transition: background var(--dur-1, 160ms) var(--ease, ease),
                border-color var(--dur-1, 160ms) var(--ease, ease),
                transform var(--dur-1, 160ms) var(--ease, ease);
    font-family: var(--font-ui, system-ui, sans-serif);
    font-size: 13px;
    font-weight: 500;
    height: 36px;
  }

  .pagination-button:hover:not(:disabled) {
    background: var(--surface-2, #f2e8cf);
    border-color: var(--hairline-strong, rgba(31, 29, 24, 0.2));
  }

  .pagination-button:active:not(:disabled) {
    background: var(--surface-2, #f2e8cf);
    transform: scale(var(--press-scale, 0.97));
  }

  .pagination-button:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .page-info {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--ink-3, #7c7562);
    letter-spacing: 0.04em;
    white-space: nowrap;
    padding: 0 6px;
  }

  /* RTL support */
  :host([dir="rtl"]) .recipe-pagination {
    direction: rtl;
  }

  /* Mobile — tighter bottom spacing */
  @media (max-width: 768px) {
    .recipe-pagination {
      margin-bottom: 12px;
      padding-top: 16px;
    }

    .pagination-button {
      padding: 6px 14px;
      font-size: 12px;
      height: 32px;
    }

    .page-info {
      font-size: 11px;
    }
  }
`;
