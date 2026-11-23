/**
 * A recipe as plain text — what "send the recipe as text" puts in the message
 * and what My meal copies as its shopping list.
 *
 * Headings use WhatsApp markup (`*bold*`, `_italic_`), the family's main channel;
 * other apps show the marks as they are.
 */
import { formatCookingTime } from './recipe-data-utils.js';
import { formatIngredientAmount, scaleIngredients } from './recipe-ingredients-utils.js';

/**
 * One ingredient as a line: amount, unit and name, skipping the empty ones
 * ("2 כוסות קמח", "מלח לפי הטעם").
 * @param {{amount?: number|string|null, unit?: string, item?: string}} ingredient
 * @returns {string}
 */
export function ingredientLine(ingredient) {
  return [formatIngredientAmount(ingredient.amount), ingredient.unit, ingredient.item]
    .map((part) => (part ?? '').toString().trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * The whole recipe as one message: title, description, servings, times and
 * difficulty, ingredients by section, numbered steps by stage, notes, source,
 * and the link when there is one.
 * @param {Object} recipe - Recipe data as stored (`ingredientSections` or
 *   `ingredients`; `stages` or `instructions`).
 * @param {Object} [options]
 * @param {number} [options.servings] - Servings to scale the amounts to (the
 *   reader's choice on the page); the recipe's own when omitted.
 * @param {string} [options.url] - The recipe's link (published recipes only).
 * @returns {string}
 */
export function recipeShareText(recipe, { servings, url } = {}) {
  const blocks = [];

  const shownServings = servings || recipe.servings;
  const meta = [
    shownServings ? `${shownServings} מנות` : '',
    recipe.prepTime ? `זמן הכנה: ${formatCookingTime(recipe.prepTime)}` : '',
    recipe.waitTime ? `זמן המתנה: ${formatCookingTime(recipe.waitTime)}` : '',
    recipe.difficulty?.trim() ? `רמת קושי: ${recipe.difficulty.trim()}` : '',
  ].filter(Boolean);
  blocks.push(
    [`*${recipe.name}*`, recipe.description?.trim(), meta.join(' · ')].filter(Boolean).join('\n'),
  );

  const sections = recipe.ingredientSections?.length
    ? recipe.ingredientSections
    : [{ items: recipe.ingredients || [] }];
  const scaled = scaleIngredients(sections, recipe.servings, shownServings);
  const ingredientLines = ['*מצרכים*'];
  scaled.forEach((section, index) => {
    const title = section.title?.trim();
    if (title) {
      if (index > 0) ingredientLines.push('');
      ingredientLines.push(`_${title}_`);
    }
    (section.items || []).forEach((item) => {
      const line = ingredientLine(item);
      if (line) ingredientLines.push(`• ${line}`);
    });
  });
  blocks.push(ingredientLines.join('\n'));

  const stages = recipe.stages?.length
    ? recipe.stages
    : [{ instructions: recipe.instructions || [] }];
  const stepLines = ['*הוראות הכנה*'];
  stages.forEach((stage, index) => {
    const title = stage.title?.trim();
    if (title) {
      if (index > 0) stepLines.push('');
      stepLines.push(`_${title}_`);
    }
    (stage.instructions || []).forEach((step, i) => stepLines.push(`${i + 1}. ${step}`));
  });
  blocks.push(stepLines.join('\n'));

  const notes = (recipe.comments || [])
    .map((note) => (note ?? '').toString().trim())
    .filter(Boolean);
  if (notes.length) blocks.push(['*הערות*', ...notes.map((note) => `• ${note}`)].join('\n'));

  const footer = [
    recipe.attribution?.trim() ? `מקור: ${recipe.attribution.trim()}` : '',
    url || '',
  ].filter(Boolean);
  if (footer.length) blocks.push(footer.join('\n'));

  return blocks.join('\n\n');
}
