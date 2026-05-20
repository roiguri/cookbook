import { jest } from '@jest/globals';

let scaleIngredients,
  formatIngredientAmount,
  extractIngredientNames,
  validateIngredient,
  createEmptyIngredient,
  parseAmount,
  formatAmount,
  isValidAmount,
  COMMON_FRACTIONS,
  HEBREW_UNITS;

describe('recipe-ingredients-utils', () => {
  beforeEach(async () => {
    jest.resetModules();
    const utils = await import('src/js/utils/recipes/recipe-ingredients-utils.js');
    scaleIngredients = utils.scaleIngredients;
    formatIngredientAmount = utils.formatIngredientAmount;
    extractIngredientNames = utils.extractIngredientNames;
    validateIngredient = utils.validateIngredient;
    createEmptyIngredient = utils.createEmptyIngredient;
    parseAmount = utils.parseAmount;
    formatAmount = utils.formatAmount;
    isValidAmount = utils.isValidAmount;
    COMMON_FRACTIONS = utils.COMMON_FRACTIONS;
    HEBREW_UNITS = utils.HEBREW_UNITS;
  });

  describe('parseAmount — valid numeric forms', () => {
    it('parses integers and decimals', () => {
      expect(parseAmount('1')).toBe(1);
      expect(parseAmount('2.5')).toBe(2.5);
      expect(parseAmount('0.375')).toBe(0.375);
      expect(parseAmount(3)).toBe(3);
    });
    it('parses ASCII common fractions', () => {
      expect(parseAmount('1/2')).toBe(0.5);
      expect(parseAmount('3/4')).toBe(0.75);
      expect(parseAmount('1/8')).toBe(0.125);
      expect(parseAmount('2/4')).toBe(0.5); // resolves to ½
      expect(parseAmount('1/3')).toBeCloseTo(1 / 3, 10);
      expect(parseAmount('2/3')).toBeCloseTo(2 / 3, 10);
    });
    it('parses unicode fractions and mixed numbers', () => {
      expect(parseAmount('½')).toBe(0.5);
      expect(parseAmount('¾')).toBe(0.75);
      expect(parseAmount('⅓')).toBeCloseTo(1 / 3, 10);
      expect(parseAmount('1½')).toBe(1.5);
      expect(parseAmount('2¾')).toBe(2.75);
      expect(parseAmount('1 1/2')).toBe(1.5);
      expect(parseAmount('2 3/4')).toBe(2.75);
    });
  });

  describe('parseAmount — rejected (→ null)', () => {
    it.each([
      ['', 'empty'],
      ['   ', 'whitespace'],
      ['לפי הטעם', 'hebrew free text'],
      ['to taste', 'english free text'],
      ['2-3', 'range'],
      ['1/2-1', 'fraction range'],
      ['2abc', 'trailing junk'],
      ['1/0', 'divide by zero'],
      ['abc', 'letters'],
      ['3/8', 'non-common ASCII fraction'],
      ['⅜', 'non-common unicode fraction'],
      [null, 'null'],
      [undefined, 'undefined'],
    ])('rejects %j (%s)', (input) => {
      expect(parseAmount(input)).toBeNull();
    });
  });

  describe('formatAmount', () => {
    it('renders common fractions as ASCII', () => {
      expect(formatAmount(0.5)).toBe('1/2');
      expect(formatAmount(0.25)).toBe('1/4');
      expect(formatAmount(0.75)).toBe('3/4');
      expect(formatAmount(1 / 3)).toBe('1/3');
      expect(formatAmount(2 / 3)).toBe('2/3');
      expect(formatAmount(0.125)).toBe('1/8');
    });
    it('prefixes the whole part with a space (ASCII mixed number)', () => {
      expect(formatAmount(1.5)).toBe('1 1/2');
      expect(formatAmount(2.75)).toBe('2 3/4');
      expect(formatAmount(2.5)).toBe('2 1/2');
    });
    it('renders integers without a fraction', () => {
      expect(formatAmount(2)).toBe('2');
      expect(formatAmount(0)).toBe('0');
      expect(formatAmount(1)).toBe('1');
    });
    it('snaps near-integers (scaled repeating decimals) to the integer', () => {
      expect(formatAmount(0.9999999999999999)).toBe('1');
      expect(formatAmount((1 / 3) * 3)).toBe('1');
      expect(formatAmount(1.9999999999999998)).toBe('2');
      expect(formatAmount(2.0000000001)).toBe('2');
    });
    it('falls back to a 3-dp trimmed decimal when no common fraction is near', () => {
      expect(formatAmount(0.375)).toBe('0.375');
      expect(formatAmount(2.55)).toBe('2.55');
      expect(formatAmount(0.5667)).toBe('0.567');
    });
    it('prefers the decimal over an inexact fraction (accuracy)', () => {
      // Only essentially-exact values become a fraction...
      expect(formatAmount(0.26)).toBe('0.26'); // not 1/4
      expect(formatAmount(0.24)).toBe('0.24'); // not 1/4
      expect(formatAmount(0.13)).toBe('0.13'); // not 1/8
      expect(formatAmount(0.3)).toBe('0.3'); // not 1/3
      expect(formatAmount(0.65)).toBe('0.65'); // not 2/3
      // ...but the repeating 1/3 and 2/3 get a looser tolerance.
      expect(formatAmount(0.33)).toBe('1/3');
      expect(formatAmount(0.34)).toBe('1/3');
      expect(formatAmount(0.66)).toBe('2/3');
      expect(formatAmount(0.667)).toBe('2/3');
      expect(formatAmount(2.33)).toBe('2 1/3');
    });
    it('returns empty string for nullish / non-numeric', () => {
      expect(formatAmount(null)).toBe('');
      expect(formatAmount(undefined)).toBe('');
      expect(formatAmount('')).toBe('');
      expect(formatAmount('abc')).toBe('');
    });
    it('accepts numeric strings', () => {
      expect(formatAmount('0.5')).toBe('1/2');
      expect(formatAmount('2')).toBe('2');
    });
  });

  describe('isValidAmount', () => {
    it('is true for positive numeric amounts', () => {
      expect(isValidAmount('1/2')).toBe(true);
      expect(isValidAmount('2.5')).toBe(true);
      expect(isValidAmount('1½')).toBe(true);
      expect(isValidAmount('3')).toBe(true);
    });
    it('is false for zero, ranges, free text, empty, non-common fractions', () => {
      expect(isValidAmount('0')).toBe(false);
      expect(isValidAmount('2-3')).toBe(false);
      expect(isValidAmount('3/8')).toBe(false);
      expect(isValidAmount('לפי הטעם')).toBe(false);
      expect(isValidAmount('')).toBe(false);
      expect(isValidAmount('-1')).toBe(false);
    });
  });

  describe('amount constants', () => {
    it('COMMON_FRACTIONS has the 6 expected glyphs', () => {
      expect(Object.keys(COMMON_FRACTIONS).sort()).toEqual(['⅛', '¼', '⅓', '½', '⅔', '¾'].sort());
      expect(COMMON_FRACTIONS['½']).toBe(0.5);
    });
    it('HEBREW_UNITS is a non-empty array of strings incl. core units', () => {
      expect(Array.isArray(HEBREW_UNITS)).toBe(true);
      expect(HEBREW_UNITS.length).toBeGreaterThan(0);
      expect(HEBREW_UNITS.every((u) => typeof u === 'string' && u.length > 0)).toBe(true);
      ['כוס', 'כף', 'גרם', 'יחידה'].forEach((u) => expect(HEBREW_UNITS).toContain(u));
    });
  });

  describe('scaleIngredients', () => {
    it('scales amounts to numbers (legacy string input tolerated)', () => {
      const ingredients = [
        { amount: '2', unit: 'cup', item: 'flour' },
        { amount: '1.5', unit: 'tbsp', item: 'sugar' },
      ];
      const scaled = scaleIngredients(ingredients, 2, 4);
      expect(scaled[0].amount).toBe(4);
      expect(scaled[1].amount).toBe(3);
    });
    it('scales numeric and fractional source amounts', () => {
      const ingredients = [
        { amount: 0.5, unit: 'cup', item: 'a' },
        { amount: '1/2', unit: 'cup', item: 'b' },
      ];
      const scaled = scaleIngredients(ingredients, 2, 6); // ×3
      expect(scaled[0].amount).toBe(1.5);
      expect(scaled[1].amount).toBe(1.5);
    });
    it('returns original if originalServings is 0 or invalid', () => {
      const ingredients = [{ amount: 2, unit: 'cup', item: 'flour' }];
      expect(scaleIngredients(ingredients, 0, 4)).toBe(ingredients);
      expect(scaleIngredients(ingredients, null, 4)).toBe(ingredients);
    });
    it('leaves non-numeric amounts untouched', () => {
      const ingredients = [{ amount: 'to taste', unit: '', item: 'salt' }];
      const scaled = scaleIngredients(ingredients, 2, 4);
      expect(scaled[0].amount).toBe('to taste');
    });

    describe('sectioned shape (Array<{title, items[]}>)', () => {
      it('scales each section item', () => {
        const sections = [
          {
            title: 'Dry Ingredients',
            items: [
              { amount: '2', unit: 'cups', item: 'flour' },
              { amount: '1', unit: 'tbsp', item: 'sugar' },
            ],
          },
        ];
        const scaled = scaleIngredients(sections, 2, 4);
        expect(scaled[0].items[0].amount).toBe(4);
        expect(scaled[0].items[1].amount).toBe(2);
        expect(scaled[0].title).toBe('Dry Ingredients');
      });
      it('preserves non-numeric amounts inside sections', () => {
        const sections = [
          { title: 'Seasonings', items: [{ amount: 'to taste', unit: '', item: 'salt' }] },
        ];
        const scaled = scaleIngredients(sections, 2, 4);
        expect(scaled[0].items[0].amount).toBe('to taste');
      });
      it('returns original on invalid params', () => {
        const sections = [{ title: 'Test', items: [] }];
        expect(scaleIngredients(sections, 0, 4)).toBe(sections);
        expect(scaleIngredients(sections, null, 4)).toBe(sections);
      });
    });

    describe('form-wrapper shape ({sections: [...]})', () => {
      it('scales items inside the sections wrapper', () => {
        const wrapped = {
          sections: [{ title: 'A', items: [{ amount: 0.5, unit: 'cup', item: 'a' }] }],
        };
        const scaled = scaleIngredients(wrapped, 2, 6); // ×3
        expect(scaled.sections[0].items[0].amount).toBe(1.5);
      });
    });
  });

  describe('formatIngredientAmount', () => {
    it('formats numeric and legacy-string amounts as ASCII fractions', () => {
      expect(formatIngredientAmount(2)).toBe('2');
      expect(formatIngredientAmount(2.5)).toBe('2 1/2');
      expect(formatIngredientAmount(0.5)).toBe('1/2');
      expect(formatIngredientAmount('2.00')).toBe('2');
      expect(formatIngredientAmount('1/2')).toBe('1/2');
      expect(formatIngredientAmount('2.55')).toBe('2.55');
    });
    it('returns empty string for null/unparseable', () => {
      expect(formatIngredientAmount('to taste')).toBe('');
      expect(formatIngredientAmount(null)).toBe('');
      expect(formatIngredientAmount(undefined)).toBe('');
    });
  });

  describe('extractIngredientNames', () => {
    it('extracts names from ingredient array', () => {
      const ingredients = [
        { amount: '1', unit: 'cup', item: 'flour' },
        { amount: '2', unit: 'tbsp', item: 'sugar' },
      ];
      expect(extractIngredientNames(ingredients)).toEqual(['flour', 'sugar']);
    });
    it('returns empty array for invalid input', () => {
      expect(extractIngredientNames(null)).toEqual([]);
      expect(extractIngredientNames(undefined)).toEqual([]);
    });
    it('filters out empty names', () => {
      const ingredients = [
        { amount: '1', unit: 'cup', item: '' },
        { amount: '2', unit: 'tbsp', item: 'sugar' },
      ];
      expect(extractIngredientNames(ingredients)).toEqual(['sugar']);
    });
  });

  describe('validateIngredient', () => {
    it('returns true for numeric or legacy-string amounts', () => {
      expect(validateIngredient({ amount: 1, unit: 'cup', item: 'flour' })).toBe(true);
      expect(validateIngredient({ amount: 0.5, unit: 'cup', item: 'flour' })).toBe(true);
      expect(validateIngredient({ amount: '1/2', unit: 'cup', item: 'flour' })).toBe(true);
    });
    it('returns false for missing/empty/zero/non-numeric amount or fields', () => {
      expect(validateIngredient({ amount: '', unit: 'cup', item: 'flour' })).toBe(false);
      expect(validateIngredient({ amount: 0, unit: 'cup', item: 'flour' })).toBe(false);
      expect(validateIngredient({ amount: 'to taste', unit: 'cup', item: 'x' })).toBe(false);
      expect(validateIngredient({ amount: 1, unit: '', item: 'flour' })).toBe(false);
      expect(validateIngredient({ amount: 1, unit: 'cup', item: '' })).toBe(false);
      expect(validateIngredient({})).toBe(false);
      expect(validateIngredient(null)).toBe(false);
    });
  });

  describe('createEmptyIngredient', () => {
    it('returns an ingredient with a null amount and empty unit/item', () => {
      expect(createEmptyIngredient()).toEqual({ amount: null, unit: '', item: '' });
    });
  });
});
