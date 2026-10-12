import 'src/lib/recipes/recipe_form_component/parts/recipe-ingredients-list.js';

/**
 * Phase 5: the ingredients form collects a canonical NUMBER and renders the
 * stored amount back in readable form (edit round-trip), and blocks
 * non-numeric input. (Inline hint + unit datalist are deferred — the form
 * layout is intentionally unchanged.)
 */
const makeEl = () => document.createElement('recipe-ingredients-list');

function rowFrom(el, ingredient) {
  const div = document.createElement('div');
  div.innerHTML = el.createListItemHTML(ingredient, true);
  return div.querySelector('.recipe-form__ingredient-entry');
}

describe('RecipeIngredientsList — numeric amount (Phase 5)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('is a registered custom element with a shadow root', () => {
    const el = makeEl();
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.shadowRoot).not.toBeNull();
  });

  describe('edit round-trip: createListItemHTML shows readable ASCII', () => {
    it('renders a stored number as an ASCII fraction', () => {
      const el = makeEl();
      expect(el.createListItemHTML({ amount: 0.5, unit: 'כוס', item: 'קמח' }, false)).toContain(
        'value="1/2"',
      );
      expect(el.createListItemHTML({ amount: 1.5, unit: '', item: '' }, false)).toContain(
        'value="1 1/2"',
      );
    });
    it('renders a legacy string amount readably and blanks null', () => {
      const el = makeEl();
      expect(el.createListItemHTML({ amount: '1/3', unit: '', item: '' }, false)).toContain(
        'value="1/3"',
      );
      expect(el.createListItemHTML({ amount: null, unit: '', item: '' }, false)).toContain(
        'value=""',
      );
    });
    it('keeps the form layout unchanged (no hint / no datalist)', () => {
      const html = makeEl().createListItemHTML({ amount: 2, unit: '', item: '' }, false);
      expect(html).not.toContain('recipe-form__amount-hint');
      expect(html).not.toContain('recipe-form__input-wrapper--quantity');
      expect(html).not.toContain('<datalist');
    });
  });

  describe('getItemData → canonical number | null', () => {
    it('parses the quantity input to a number', () => {
      const el = makeEl();
      const row = rowFrom(el, { amount: null, unit: '', item: '' });
      row.querySelector('.recipe-form__input--quantity').value = '1 1/2';
      row.querySelector('.recipe-form__input--unit').value = 'כוס';
      row.querySelector('.recipe-form__input--item').value = 'קמח';
      expect(el.getItemData(row)).toEqual({ amount: 1.5, unit: 'כוס', item: 'קמח' });
    });
    it('returns null amount for empty / non-numeric input', () => {
      const el = makeEl();
      const row = rowFrom(el, { amount: null, unit: '', item: '' });
      const q = row.querySelector('.recipe-form__input--quantity');
      q.value = '';
      expect(el.getItemData(row).amount).toBeNull();
      q.value = '2-3';
      expect(el.getItemData(row).amount).toBeNull();
    });
  });

  describe('getInitialItems / isItemPopulated', () => {
    it('initial item has a null amount', () => {
      expect(makeEl().getInitialItems()).toEqual([{ amount: null, unit: '', item: '' }]);
    });
    it('isItemPopulated reflects any filled field', () => {
      const el = makeEl();
      expect(el.isItemPopulated({ amount: null, unit: '', item: '' })).toBeFalsy();
      expect(el.isItemPopulated({ amount: 0.5, unit: '', item: '' })).toBeTruthy();
      expect(el.isItemPopulated({ amount: null, unit: '', item: 'קמח' })).toBeTruthy();
    });
  });

  describe('validateItemFields (blocking, post-parse)', () => {
    it('passes a positive numeric amount with unit + item', () => {
      expect(makeEl().validateItemFields({ amount: 0.5, unit: 'כוס', item: 'קמח' })).toEqual({});
    });
    it('accepts a missing amount and a missing unit', () => {
      const el = makeEl();
      expect(el.validateItemFields({ amount: null, unit: '', item: 'מלח לפי הטעם' })).toEqual({});
      expect(el.validateItemFields({ amount: 3, unit: '', item: 'ביצים' })).toEqual({});
    });
    it('flags non-positive / non-numeric amount', () => {
      const el = makeEl();
      expect(el.validateItemFields({ amount: 0, unit: 'כוס', item: 'קמח' }).amount).toBe(true);
      expect(el.validateItemFields({ amount: '1/2', unit: 'כוס', item: 'קמח' }).amount).toBe(true);
    });
    it('flags empty item', () => {
      expect(makeEl().validateItemFields({ amount: 1, unit: 'כוס', item: '' }).item).toBe(true);
    });
  });

  describe('buildItemErrorMessage — banner text per failed field', () => {
    it('amount only → amount-specific message', () => {
      expect(makeEl().buildItemErrorMessage(['amount'])).toMatch(/כמות שהוזנה/);
    });
    it('item only → item-specific message', () => {
      expect(makeEl().buildItemErrorMessage(['item'])).toBe('חובה למלא שם פריט לכל מרכיב.');
    });
    it('amount + item → both messages', () => {
      const message = makeEl().buildItemErrorMessage(['amount', 'item']);
      expect(message).toMatch(/שם פריט/);
      expect(message).toMatch(/כמות שהוזנה/);
    });
  });
});
