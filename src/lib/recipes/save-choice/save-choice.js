import { STAGE } from '../../../js/services/recipes/recipe-service.js';
import '../../modals/confirmation_modal/confirmation_modal.js';

const STYLES = `
  .save-choice .confirmation-modal-content { text-align: right; padding: 56px 28px 28px; }
  .save-choice h2 { font-size: 1.5rem; margin-bottom: 6px; }
  .save-choice .modal-buttons { margin-top: 18px; justify-content: flex-start; }
  .save-q { margin: 0 0 16px; padding: 0; border: 0; }
  .save-q legend {
    padding: 0; margin-bottom: 8px; font-family: var(--font-ui-he); font-size: 13px;
    font-weight: 600; color: var(--ink-2);
  }
  .save-q__opts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .save-opt {
    position: relative; display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px;
    border: 1px solid var(--hairline-strong); border-radius: var(--r-md);
    background: var(--surface-1); cursor: pointer; font-family: var(--font-ui-he);
    color: var(--ink); text-align: right;
  }
  .save-opt input {
    margin: 2px 0 0; width: 16px; height: 16px; accent-color: var(--primary-dark); flex-shrink: 0;
  }
  .save-opt b { display: block; font-size: 14px; font-weight: 600; }
  .save-opt small { display: block; margin-top: 2px; font-size: 12px; line-height: 1.45; color: var(--ink-3); }
  .save-opt--on {
    border-color: var(--primary-dark);
    background: color-mix(in oklab, var(--primary) 6%, white);
    box-shadow: var(--ring);
  }
  .save-summary {
    margin: 4px 0 0; padding: 12px 14px; border-radius: var(--r-md); background: var(--surface-0);
    border: 1px solid var(--hairline); font-family: var(--font-ui-he); font-size: 13px;
    line-height: 1.55; color: var(--ink-2);
  }
  .save-summary--warn { background: var(--neutral); border-color: var(--hairline-strong); }
  .save-summary b { font-weight: 600; color: var(--ink); }
`;

const PRIVATE_NOTE = 'רק אתם ומנהלי הספר רואים אותו.';
const SUBMIT_NOTE = 'וישלח לאישור מנהל. אחרי האישור הוא ייכנס לספר המשפחתי.';

/** The summary under the two questions, for each combination. */
function summary(stage, submit) {
  const where = stage === STAGE.TO_TRY ? 'יישמר ב־״לנסות״' : 'יישמר ב־״הספרייה שלי״';
  if (!submit) return { html: `${where}. ${PRIVATE_NOTE}`, warn: false };
  if (stage === STAGE.TO_TRY) {
    return {
      html:
        '<b>עוד לא ניסיתם את המתכון?</b> אפשר לשלוח בכל זאת, אבל כדאי לנסות קודם – כך מה שנכנס לספר זה המתכונים הטובים ביותר. ' +
        `${where} ${SUBMIT_NOTE}`,
      warn: true,
    };
  }
  return { html: `${where} ${SUBMIT_NOTE}`, warn: false };
}

function buildBody({ stage, submit }) {
  const body = document.createElement('div');
  body.innerHTML = `
    <style>${STYLES}</style>
    <fieldset class="save-q">
      <legend>בישלתם אותו?</legend>
      <div class="save-q__opts">
        <label class="save-opt"><input type="radio" name="save-stage" value="${STAGE.TESTED}">
          <span><b>בישלתי</b><small>לספרייה שלי</small></span></label>
        <label class="save-opt"><input type="radio" name="save-stage" value="${STAGE.TO_TRY}">
          <span><b>עוד לא</b><small>ל״לנסות״</small></span></label>
      </div>
    </fieldset>
    <fieldset class="save-q">
      <legend>מי יראה אותו?</legend>
      <div class="save-q__opts">
        <label class="save-opt"><input type="radio" name="save-visibility" value="private">
          <span><b>רק אני</b><small>פרטי</small></span></label>
        <label class="save-opt"><input type="radio" name="save-visibility" value="family">
          <span><b>כל המשפחה</b><small>שליחה לפרסום</small></span></label>
      </div>
    </fieldset>
    <p class="save-summary" aria-live="polite"></p>
  `;
  body.querySelector(`input[name="save-stage"][value="${stage}"]`).checked = true;
  body.querySelector(
    `input[name="save-visibility"][value="${submit ? 'family' : 'private'}"]`,
  ).checked = true;
  return body;
}

function readChoice(body) {
  return {
    stage: body.querySelector('input[name="save-stage"]:checked').value,
    submit: body.querySelector('input[name="save-visibility"]:checked').value === 'family',
  };
}

/**
 * Ask how to save a new recipe: cooked yet? (library / To try) and who sees it
 * (private / submit to the family book). Uses the shared confirmation modal.
 *
 * @param {Object} [options]
 * @param {string} [options.defaultStage=STAGE.TESTED] - Pre-selected stage
 *        (imports default to To try).
 * @returns {Promise<{ stage: string, submit: boolean } | null>} null if cancelled.
 */
export async function askSaveChoice({ defaultStage = STAGE.TESTED } = {}) {
  let modal = document.getElementById('save-choice-modal');
  if (!modal) {
    modal = document.createElement('confirmation-modal');
    modal.id = 'save-choice-modal';
    document.body.appendChild(modal);
  }

  const body = buildBody({ stage: defaultStage, submit: false });
  const update = () => {
    const choice = readChoice(body);
    body.querySelectorAll('.save-opt').forEach((opt) => {
      opt.classList.toggle('save-opt--on', opt.querySelector('input').checked);
    });
    const { html, warn } = summary(choice.stage, choice.submit);
    const summaryEl = body.querySelector('.save-summary');
    summaryEl.innerHTML = html;
    summaryEl.classList.toggle('save-summary--warn', warn);
    modal.setApproveText(choice.submit ? 'שמירה ושליחה' : 'שמירה');
  };
  body.addEventListener('change', update);

  const confirmed = modal.confirm('', 'איך לשמור את המתכון?', 'שמירה', 'ביטול', {
    body,
    className: 'save-choice',
  });
  update();
  return (await confirmed) ? readChoice(body) : null;
}
