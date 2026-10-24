/**
 * The page-level dialogs of the dashboard's API-token panel
 * (docs/feature-plans/recipe-api.md, slice 2):
 *
 *   askToRevokeToken(modal, token, onApprove) — a revoke question on a <confirmation-modal>
 *   cancelRevokeQuestion()                    — drop an unanswered question (page unmount)
 *   showTokenSecretOnce(modal, { secret, token }) — the new secret on a <custom-modal>,
 *                                               removed from the page when it closes
 */

// Bidi isolation for user text inside a sentence (FSI … PDI).
const isolate = (text) => `⁨${text}⁩`;

// custom-modal fades out for 300ms after `modal-closed`; the secret is removed after it.
export const SECRET_CLEAR_DELAY_MS = 300;

let currentQuestion = null;

/**
 * Ask whether to revoke `token`; call `onApprove()` only if this question is approved.
 *
 * Each question gets fresh listeners. Dismissing the modal (✕, backdrop, Escape) fires
 * neither answer, so the previous question is dropped here — otherwise approving a
 * later question would also revoke an earlier token.
 * @param {HTMLElement} modal - A <confirmation-modal>.
 * @param {{ name: string }} token
 * @param {() => void} onApprove
 */
export function askToRevokeToken(modal, token, onApprove) {
  cancelRevokeQuestion();
  const question = new AbortController();
  currentQuestion = question;
  const opts = { signal: question.signal };
  const answered = () => {
    question.abort();
    if (currentQuestion === question) currentQuestion = null;
  };
  modal.addEventListener(
    'confirm-approved',
    () => {
      answered();
      onApprove();
    },
    opts,
  );
  modal.addEventListener('confirm-rejected', answered, opts);
  modal.confirm(
    `לבטל את הטוקן ${isolate(`"${token.name}"`)}? כלים שמשתמשים בו יפסיקו לעבוד מיד. הפעולה אינה הפיכה.`,
    'ביטול טוקן',
    'בטל טוקן',
    'חזרה',
  );
}

/** Drop the unanswered revoke question, if any. */
export function cancelRevokeQuestion() {
  currentQuestion?.abort();
  currentQuestion = null;
}

/**
 * Show a new token's secret once. Closing before it was copied first warns inside the
 * modal; a second close goes through. The secret is removed from the page on close.
 * @param {HTMLElement} modal - A <custom-modal>.
 * @param {{ secret: string, token: { name: string } }} params
 */
export function showTokenSecretOnce(modal, { secret, token }) {
  let copied = false;
  let warned = false;

  const body = document.createElement('div');
  body.className = 'api-token-secret';
  body.dir = 'rtl';

  const title = document.createElement('h2');
  title.textContent = `הטוקן ${isolate(`"${token.name}"`)} נוצר`;
  const warning = document.createElement('p');
  warning.textContent =
    'הטוקן יוצג פעם אחת בלבד — העתיקו אותו עכשיו ושמרו אותו במקום בטוח. ' +
    'מי שמחזיק בו יכול לקרוא ולהוסיף מתכונים בשם המשתמש.';
  const field = document.createElement('input');
  field.type = 'text';
  field.readOnly = true;
  field.dir = 'ltr';
  field.value = secret;
  field.setAttribute('aria-label', 'הטוקן');
  field.addEventListener('focus', () => field.select());
  // Copying by hand counts too.
  field.addEventListener('copy', () => {
    copied = true;
  });

  const notCopied = document.createElement('p');
  notCopied.className = 'api-token-secret__not-copied';
  notCopied.setAttribute('role', 'alert');
  notCopied.hidden = true;
  notCopied.textContent =
    'עוד לא העתקתם את הטוקן — אחרי הסגירה אי אפשר לראות אותו שוב. סגרו שוב כדי לסגור בכל זאת.';

  const actions = document.createElement('div');
  actions.className = 'api-token-secret__actions';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'api-token-secret__copy';
  copy.textContent = 'העתק';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(secret);
      copied = true;
      copy.textContent = 'הועתק ✓';
    } catch {
      field.focus();
      copy.textContent = 'סמנו והעתיקו ידנית';
    }
  });
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'api-token-secret__done';
  done.textContent = 'סיימתי';
  // Same guard as ✕ / backdrop / Escape.
  done.addEventListener('click', () => modal.close({ byUser: true }));
  actions.append(copy, done);

  body.append(title, warning, field, notCopied, actions);
  modal.replaceChildren(body);
  modal.setCloseGuard(() => {
    if (copied || warned) return true;
    warned = true;
    notCopied.hidden = false;
    return false;
  });
  modal.addEventListener(
    'modal-closed',
    () => {
      modal.clearCloseGuard();
      // After the fade-out (custom-modal's 300ms), unless it was reopened meanwhile.
      setTimeout(() => {
        if (!modal.isOpen) modal.replaceChildren();
      }, SECRET_CLEAR_DELAY_MS);
    },
    { once: true },
  );
  modal.open();
}
