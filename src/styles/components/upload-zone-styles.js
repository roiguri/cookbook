export const uploadZoneStyles = `
  .upload-zone {
    border: 2px dashed var(--hairline-strong, rgba(31,29,24,0.2));
    border-radius: var(--r-lg, 16px);
    padding: 40px;
    text-align: center;
    cursor: pointer;
    transition: border-color var(--dur-1, 160ms), background var(--dur-1, 160ms);
    background: var(--surface-0, #fafaf8);
    margin-bottom: 10px;
    color: var(--ink-3, rgba(31,29,24,0.55));
    font-size: 14px;
  }

  .upload-zone:hover,
  .upload-zone:active {
    border-color: var(--primary, #6a994e);
    background: var(--surface-2, #f0ede6);
  }

  .upload-zone.drag-over {
    border-color: var(--primary, #6a994e);
    background: #eef4e8;
    transform: scale(1.01);
  }

  .upload-zone.uploading {
    opacity: 0.55;
    pointer-events: none;
  }

  .upload-zone[data-disabled="true"] {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .status-message {
    margin-top: 6px;
    font-size: 12px;
    color: var(--ink-3, rgba(31,29,24,0.55));
  }

  .file-input { display: none; }
`;
