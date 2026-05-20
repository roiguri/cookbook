/*
 * Recipe Ingredients Utilities
 * ---------------------------
 * This module provides helper functions for ingredient scaling, formatting, validation, and extraction.
 *
 * Exported Methods:
 *
 *   - COMMON_FRACTIONS:
 *       Glyph → ratio map; the only fractions accepted on input / produced on display.
 *   - parseAmount(str):
 *       Parse an amount string to a number, or null if it is not a valid numeric amount.
 *   - formatAmount(value):
 *       Format a number as a unicode-fraction display string.
 *   - isValidAmount(str):
 *       Whether a string is a valid, positive amount (drives blocking form validation).
 *   - HEBREW_UNITS:
 *       Curated Hebrew unit suggestions for the unit <datalist>.
 *   - scaleIngredients(ingredients, originalServings, newServings):
 *       Adjust ingredient quantities for a new serving size.
 *   - formatIngredientAmount(value):
 *       Format a number for display in ingredient lists.
 *   - extractIngredientNames(ingredientsArray):
 *       Extract a plain list of ingredient names from an array.
 *   - createEmptyIngredient():
 *       Create a blank ingredient object.
 *
 * Amounts are NUMERIC ONLY: whole numbers, decimals, and a small set of COMMON cooking
 * fractions (incl. unicode glyphs and mixed numbers). Ranges ("2-3") and free text
 * ("to taste") are NOT valid amounts (parseAmount → null). Display normalizes numbers to
 * unicode fractions (½, ⅓ …).
 */

/**
 * @typedef {Object} Ingredient
 * @property {number|null} amount - Canonical numeric quantity (e.g. 1, 0.5, 2.5); `null`
 *   when unknown. Legacy string amounts still tolerated on read during rollout (#202).
 * @property {string} unit - The unit of measurement (e.g. "cup", "tbsp", "g")
 * @property {string} item - The name of the ingredient (e.g. "flour", "sugar")
 */

/**
 * The only fractions accepted on input and produced on display.
 * @type {Record<string, number>}
 */
export const COMMON_FRACTIONS = {
  '⅛': 1 / 8,
  '¼': 1 / 4,
  '⅓': 1 / 3,
  '½': 1 / 2,
  '⅔': 2 / 3,
  '¾': 3 / 4,
};

// ASCII label per common fraction. Display uses ASCII ("1/2", "1 1/2") — more
// legible than the compact vulgar-fraction glyph and bidi-safe in RTL Hebrew.
const COMMON_ASCII = {
  '⅛': '1/8',
  '¼': '1/4',
  '⅓': '1/3',
  '½': '1/2',
  '⅔': '2/3',
  '¾': '3/4',
};

const COMMON_RATIOS = Object.values(COMMON_FRACTIONS);
const RATIO_EPSILON = 1e-6; // fraction-notation must resolve (near) exactly

// Display rounding is conservative: a value only renders as a fraction when it
// is essentially exact (EXACT_DISPLAY_TOLERANCE). The only exception is the
// repeating decimals 1/3 and 2/3 — their decimal form is ugly/inaccurate, so a
// looser tolerance is allowed there. Everything else prefers the decimal.
const EXACT_DISPLAY_TOLERANCE = 1e-6;
const REPEATING_DISPLAY_TOLERANCE = 0.01;

// [asciiLabel, ratio, tolerance][] — used by formatAmount for display.
const COMMON_ASCII_ENTRIES = Object.entries(COMMON_FRACTIONS).map(([glyph, ratio]) => [
  COMMON_ASCII[glyph],
  ratio,
  glyph === '⅓' || glyph === '⅔' ? REPEATING_DISPLAY_TOLERANCE : EXACT_DISPLAY_TOLERANCE,
]);

const matchesCommonRatio = (value) =>
  COMMON_RATIOS.some((ratio) => Math.abs(value - ratio) < RATIO_EPSILON);

/**
 * Parse a user/stored amount string into a number.
 * Returns `null` for anything that is not a valid numeric amount
 * (empty, free text, ranges, or non-common fraction notation).
 * @param {string|number|null|undefined} input
 * @returns {number|null}
 */
export function parseAmount(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).trim();
  if (s === '') return null;

  // Plain integer or decimal: "2", "2.5", "0.375"
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }

  // Unicode vulgar fraction alone: "½"
  if (Object.prototype.hasOwnProperty.call(COMMON_FRACTIONS, s)) {
    return COMMON_FRACTIONS[s];
  }

  // Mixed number + unicode fraction: "1½", "2 ¾"
  const mixedUnicode = s.match(/^(\d+)\s*([⅛¼⅓½⅔¾])$/);
  if (mixedUnicode) {
    return parseInt(mixedUnicode[1], 10) + COMMON_FRACTIONS[mixedUnicode[2]];
  }

  // ASCII fraction: "1/2" — must resolve to a common ratio ("3/8" rejected)
  const fraction = s.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    const den = parseInt(fraction[2], 10);
    if (den === 0) return null;
    const value = parseInt(fraction[1], 10) / den;
    return matchesCommonRatio(value) ? value : null;
  }

  // Mixed number + ASCII fraction: "1 1/2" — fraction part must be common
  const mixedAscii = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixedAscii) {
    const den = parseInt(mixedAscii[3], 10);
    if (den === 0) return null;
    const fracValue = parseInt(mixedAscii[2], 10) / den;
    if (!matchesCommonRatio(fracValue)) return null;
    return parseInt(mixedAscii[1], 10) + fracValue;
  }

  // Ranges ("2-3", "1/2-1") and everything else are invalid.
  return null;
}

/**
 * Format a numeric amount for display as a legible ASCII string, snapping the
 * fractional part to the nearest common fraction when close enough:
 * `0.5`→`"1/2"`, `1.5`→`"1 1/2"`, `2`→`"2"`, `0.375`→`"0.375"`.
 * ASCII (not the ½ glyph) is used so it is readable at small sizes and does
 * not bidi-reorder inside RTL Hebrew; the display layer keeps it LTR-isolated.
 * @param {number|string|null|undefined} value
 * @returns {string}
 */
export function formatAmount(value) {
  if (value === null || value === undefined || value === '') return '';
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return '';

  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);

  // Near-integer snap: catches exact integers AND scaled repeating decimals
  // like 0.9999999999999999 (= 1/3 × 3) so they render as "1", not by toFixed luck.
  if (Math.abs(abs - Math.round(abs)) < 1e-9) return `${sign}${Math.round(abs)}`;

  const whole = Math.trunc(abs);
  const frac = abs - whole;

  // Nearest common fraction (minimum absolute difference), accepted only
  // within that fraction's own tolerance — exact for terminating fractions,
  // looser for the repeating 1/3 and 2/3. Otherwise prefer the decimal.
  let best = null;
  let bestDiff = Infinity;
  let bestTol = 0;
  for (const [label, ratio, tol] of COMMON_ASCII_ENTRIES) {
    const diff = Math.abs(frac - ratio);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = label;
      bestTol = tol;
    }
  }
  if (best !== null && bestDiff < bestTol) {
    return whole > 0 ? `${sign}${whole} ${best}` : `${sign}${best}`;
  }

  // No nearby fraction → decimal rounded at the 3rd place, trailing zeros trimmed.
  let dec = abs.toFixed(3);
  if (dec.includes('.')) dec = dec.replace(/0+$/, '').replace(/\.$/, '');
  return `${sign}${dec}`;
}

/**
 * Whether a string is a valid, positive ingredient amount.
 * The form must never accept/persist a value where this is false.
 * @param {string} str
 * @returns {boolean}
 */
export function isValidAmount(str) {
  const parsed = parseAmount(str);
  return parsed !== null && parsed > 0;
}

/**
 * Curated Hebrew measurement units offered as <datalist> suggestions.
 * Suggestions only — the unit field still accepts free text.
 * @type {string[]}
 */
export const HEBREW_UNITS = [
  'כוס',
  'כוסות',
  'כף',
  'כפות',
  'כפית',
  'כפיות',
  'מ"ל',
  'ליטר',
  'ליטרים',
  'גרם',
  'ק"ג',
  'יחידה',
  'יחידות',
  'חתיכה',
  'חתיכות',
  'פרוסה',
  'פרוסות',
  'ענף',
  'ענפים',
  'שקית',
  'קופסה',
  'צרור',
];

/**
 * Adjusts ingredient quantities for different serving sizes
 * Supports both flat ingredient arrays and sectioned ingredient objects
 * @param {Ingredient[]|{sections: Array}} ingredients - Original ingredients with quantities
 * @param {number} originalServings - Original recipe serving count
 * @param {number} newServings - New desired serving count
 * @returns {Ingredient[]|{sections: Array}} Adjusted ingredients in same format as input
 */
export function scaleIngredients(ingredients, originalServings, newServings) {
  if (!originalServings || !newServings || originalServings <= 0) return ingredients;

  const factor = newServings / originalServings;

  const scaleIngredient = (ing) => {
    const n = parseAmount(ing.amount);
    if (n === null) return ing;
    return { ...ing, amount: n * factor };
  };

  // Handle sectioned ingredients format (Firebase direct array format)
  if (Array.isArray(ingredients) && ingredients.length > 0 && ingredients[0].items) {
    return ingredients.map((section) => ({
      ...section,
      items: section.items.map(scaleIngredient),
    }));
  }

  // Handle sectioned ingredients format (form component format with sections wrapper)
  if (
    ingredients &&
    typeof ingredients === 'object' &&
    !Array.isArray(ingredients) &&
    ingredients.sections
  ) {
    return {
      ...ingredients,
      sections: ingredients.sections.map((section) => ({
        ...section,
        items: section.items.map(scaleIngredient),
      })),
    };
  }

  // Handle flat ingredients array (original format)
  if (!Array.isArray(ingredients)) return ingredients;
  return ingredients.map(scaleIngredient);
}

/**
 * Formats an ingredient amount (number or legacy string) for display as a
 * common unicode fraction. Returns '' for null/unparseable.
 * @param {number|string|null} value
 * @returns {string}
 */
export function formatIngredientAmount(value) {
  const n = parseAmount(value);
  return n === null ? '' : formatAmount(n);
}

/**
 * Extracts a plain list of ingredient names
 * @param {Ingredient[]} ingredientsArray - Full ingredients array with amounts and units
 * @returns {string[]} Plain list of ingredient names
 */
export function extractIngredientNames(ingredientsArray) {
  if (!Array.isArray(ingredientsArray)) return [];
  return ingredientsArray.map((ing) => ing.item).filter(Boolean);
}

/**
 * Creates a blank ingredient object
 * @returns {Ingredient} New ingredient with empty fields
 */
export function createEmptyIngredient() {
  return { amount: null, unit: '', item: '' };
}
