/**
 * Form problems banner
 * --------------------
 * Builds the banner shown after a failed save from the problems each field
 * reports (see `getProblems()` on the field components):
 *
 *   חובה למלא:  empty required fields, as links
 *   צריך לתקן:  wrong values, grouped by kind so each explanation appears once;
 *               plus rules that are not a single field ("at least 2 groups")
 *   לבדיקה:     non-blocking — ingredient rows with a blank amount or unit
 *
 * Long lists show the first {@link VISIBLE_LINKS} links and a "ו-N נוספים"
 * button (N ≥ 2). Everything is built with DOM APIs because labels include user text
 * (ingredient names).
 */

export const VISIBLE_LINKS = 5;

/** @typedef {import('../../../forms/form-field-base.js').FormProblem} FormProblem */

/**
 * @typedef {Object} BlankFieldWarning
 * @property {string} item
 * @property {string[]} fields - 'amount' | 'unit'
 * @property {() => void} focus
 */

const blankFieldsLabel = (fields) =>
  fields.length === 2 ? 'כמות ויחידה' : fields[0] === 'amount' ? 'כמות' : 'יחידה';

/**
 * Number of things the user still has to fix (the side button's badge).
 * @param {FormProblem[]} problems
 * @returns {number}
 */
export function countProblems(problems) {
  const missing = new Set(problems.filter((p) => p.kind === 'missing').map((p) => p.label));
  return missing.size + problems.filter((p) => p.kind !== 'missing').length;
}

/**
 * Renders the banner into `container`.
 * @param {HTMLElement} container
 * @param {{ problems: FormProblem[], warnings: BlankFieldWarning[] }} model
 * @param {{ expanded: Set<string>, onToggle: (key: string) => void }} handlers
 */
export function renderProblems(container, { problems, warnings }, { expanded, onToggle }) {
  container.replaceChildren();

  const linkList = (key, entries, renderExtra) => {
    const frag = document.createDocumentFragment();
    // Collapse only when it hides at least two ("ו-1 נוספים" reads oddly).
    const collapse = !expanded.has(key) && entries.length > VISIBLE_LINKS + 1;
    const visible = collapse ? entries.slice(0, VISIBLE_LINKS) : entries;
    visible.forEach((entry, i) => {
      if (i > 0) frag.append(' · ');
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'recipe-form__problem-link';
      link.textContent = entry.label;
      link.addEventListener('click', () => entry.focus());
      frag.append(link);
      if (renderExtra) frag.append(renderExtra(entry));
    });
    const hidden = entries.length - visible.length;
    if (hidden > 0) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'recipe-form__problem-more';
      more.textContent = `ו-${hidden} נוספים`;
      more.addEventListener('click', () => onToggle(key));
      frag.append(' ', more);
    }
    return frag;
  };

  const heading = (text) => {
    const strong = document.createElement('strong');
    strong.textContent = `${text}: `;
    return strong;
  };

  // חובה למלא — one link per field (a repeated label, e.g. two rows, collapses)
  const missing = [];
  const seen = new Set();
  problems
    .filter((p) => p.kind === 'missing')
    .forEach((p) => {
      if (seen.has(p.label)) return;
      seen.add(p.label);
      missing.push(p);
    });
  if (missing.length) {
    const line = document.createElement('p');
    line.className = 'recipe-form__problems-line';
    line.append(heading('חובה למלא'), linkList('missing', missing));
    container.append(line);
  }

  // צריך לתקן — wrong values grouped by kind, then rules
  const groups = new Map();
  problems
    .filter((p) => p.kind === 'wrong')
    .forEach((p) => {
      const key = p.group || p.label;
      if (!groups.has(key))
        groups.set(key, { lead: p.groupLead || '', explanation: p.explanation, items: [] });
      groups.get(key).items.push(p);
    });
  const rules = problems.filter((p) => p.kind === 'rule');
  if (groups.size || rules.length) {
    const block = document.createElement('div');
    block.className = 'recipe-form__problems-line';
    const list = document.createElement('ul');
    groups.forEach(({ lead, explanation, items }, key) => {
      const li = document.createElement('li');
      if (lead) li.append(lead);
      li.append(linkList(`wrong:${key}`, items), `: ${explanation}`);
      list.append(li);
    });
    rules.forEach((rule) => {
      const li = document.createElement('li');
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'recipe-form__problem-link';
      link.textContent = rule.label;
      link.addEventListener('click', () => rule.focus());
      li.append(link);
      list.append(li);
    });
    block.append(heading('צריך לתקן'), list);
    container.append(block);
  }

  // לבדיקה — non-blocking
  if (warnings.length) {
    const line = document.createElement('p');
    line.className = 'recipe-form__problems-warn';
    const entries = warnings.map((w) => ({ label: w.item, focus: w.focus, fields: w.fields }));
    line.append(
      heading('לבדיקה (לא חובה)'),
      linkList('warn', entries, (entry) => ` (${blankFieldsLabel(entry.fields)})`),
    );
    container.append(line);
  }
}
