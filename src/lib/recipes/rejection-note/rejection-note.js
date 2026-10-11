import '../../modals/confirmation_modal/confirmation_modal.js';

const STYLES = `
  .reject-note .confirmation-modal-content { text-align: right; }
  .reject-note p { color: var(--ink-2); }
  .reject-note .modal-buttons { justify-content: flex-start; }
  .reject-note .approve-button { background: var(--secondary); }
  .reject-note .approve-button:hover:not(:disabled) { background: var(--secondary-dark); }
  .rj__field { display: flex; flex-direction: column; gap: 6px; margin: 0 0 20px; text-align: right; }
  .rj__field label {
    font-family: var(--font-ui-he); font-size: 13px; font-weight: 600; color: var(--ink-2);
  }
  .rj__field textarea {
    font-family: var(--font-ui-he); font-size: 14px; line-height: 1.6; color: var(--ink);
    background: var(--surface-1); border: 1px solid var(--hairline-strong); border-radius: var(--r-sm);
    padding: 12px 14px; min-height: 104px; resize: vertical; box-sizing: border-box; width: 100%;
  }
  .rj__field textarea:focus { outline: none; border-color: var(--primary); box-shadow: var(--ring); }
  .rj__field small { font-family: var(--font-ui-he); font-size: 12px; color: var(--ink-3); }
`;

function getModal() {
  let modal = document.getElementById('reject-note-modal');
  if (!modal) {
    modal = document.createElement('confirmation-modal');
    modal.id = 'reject-note-modal';
    document.body.appendChild(modal);
  }
  return modal;
}

/**
 * Ask the manager what the author should fix before resubmitting. Uses the
 * shared confirmation modal; the note is required.
 * @param {string} recipeName
 * @returns {Promise<string|null>} The note, or null if cancelled.
 */
export async function askRejectionNote(recipeName) {
  const modal = getModal();
  const body = document.createElement('div');
  body.innerHTML = `
    <style>${STYLES}</style>
    <div class="rj__field">
      <label for="rj-note">מה צריך לתקן?</label>
      <textarea id="rj-note" rows="4" dir="rtl"></textarea>
      <small>חובה · כדי שיהיה ברור מה לתקן לפני שליחה חוזרת</small>
    </div>
  `;
  const textarea = body.querySelector('textarea');
  textarea.addEventListener('input', () => modal.setApproveDisabled(!textarea.value.trim()));

  const confirmed = modal.confirm(
    'ההערה תופיע בעמוד המתכון. המתכון נשאר פרטי ולא נמחק.',
    `לדחות את ״${recipeName || 'המתכון'}״?`,
    'דחייה ושליחת הערה',
    'ביטול',
    { body, className: 'reject-note' },
  );
  modal.setApproveDisabled(true);
  requestAnimationFrame(() => textarea.focus());
  const ok = await confirmed;
  modal.setApproveDisabled(false);
  return ok ? textarea.value.trim() : null;
}

/**
 * Confirm discarding a plain user's proposal (they have no library to keep it in).
 * @param {string} recipeName
 * @returns {Promise<boolean>}
 */
export async function confirmDiscard(recipeName) {
  const modal = getModal();
  return modal.confirm(
    'המתכון נשלח ממשתמש בלי ספרייה פרטית, ולכן הוא יימחק יחד עם התמונות שלו.',
    `לדחות ולמחוק את ״${recipeName || 'המתכון'}״?`,
    'דחייה ומחיקה',
    'ביטול',
  );
}
