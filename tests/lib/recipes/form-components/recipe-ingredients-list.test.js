import 'src/lib/recipes/recipe_form_component/parts/recipe-ingredients-list.js';

function mount() {
  const el = document.createElement('recipe-ingredients-list');
  document.body.appendChild(el);
  return el;
}

describe('recipe-ingredients-list — unified contract (inherited)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('setValue (flat) then getValue returns populated rows', () => {
    const el = mount();
    el.setValue([
      { amount: 2, unit: 'cups', item: 'flour' },
      { amount: 1, unit: 'tsp', item: 'salt' },
    ]);
    expect(el.isSectionMode).toBe(false);
    expect(el.getValue()).toEqual([
      { amount: 2, unit: 'cups', item: 'flour' },
      { amount: 1, unit: 'tsp', item: 'salt' },
    ]);
  });

  test('setValue with {sections} enters section mode', () => {
    const el = mount();
    el.setValue({
      sections: [
        { title: 'Dough', items: [{ amount: 2, unit: 'cups', item: 'flour' }] },
        { title: 'Filling', items: [{ amount: 1, unit: 'cup', item: 'sugar' }] },
      ],
    });
    expect(el.isSectionMode).toBe(true);
    expect(el.getValue()).toEqual([
      { title: 'Dough', items: [{ amount: 2, unit: 'cups', item: 'flour' }] },
      { title: 'Filling', items: [{ amount: 1, unit: 'cup', item: 'sugar' }] },
    ]);
  });

  test('setValue marks pristine', () => {
    const el = mount();
    el.setValue([{ amount: 1, unit: 'kg', item: 'beef' }]);
    expect(el.isDirty()).toBe(false);
  });

  test('validate() flags an empty list', () => {
    const el = mount();
    const result = el.validate();
    expect(result.isValid).toBe(false);
    expect(result.errors.noIngredients).toBeDefined();
  });

  test('validate() passes for a fully populated row', () => {
    const el = mount();
    el.setValue([{ amount: 2, unit: 'cups', item: 'flour' }]);
    expect(el.validate().isValid).toBe(true);
  });

  test('validate() accepts a row with only an item name', () => {
    const el = mount();
    el.setValue([{ amount: null, unit: '', item: 'מלח לפי הטעם' }]);
    expect(el.validate().isValid).toBe(true);
    expect(el.getValue()).toEqual([{ amount: null, unit: '', item: 'מלח לפי הטעם' }]);
  });

  test('validate() accepts an amount without a unit', () => {
    const el = mount();
    el.setValue([{ amount: 3, unit: '', item: 'ביצים' }]);
    expect(el.validate().isValid).toBe(true);
  });

  test('validate() flags a row without an item name', () => {
    const el = mount();
    el.setValue([{ amount: 2, unit: 'כוסות', item: '' }]);
    const result = el.validate();
    expect(result.isValid).toBe(false);
    expect(result.errors['items[0].item']).toBe(true);
    expect(result.errors.invalidItem).toBe('חובה למלא שם פריט לכל מרכיב.');
  });

  test('validate() flags quantity text that is not a number', () => {
    const el = mount();
    el.setValue([{ amount: null, unit: '', item: 'שום' }]);
    el.shadowRoot.querySelector('.recipe-form__input--quantity').value = '2-3';
    const result = el.validate();
    expect(result.isValid).toBe(false);
    expect(result.errors['items[0].amount']).toBe(true);
    expect(result.errors.invalidItem).toMatch('כמות שהוזנה');
  });

  test('validate() flags unparseable quantity text in section mode', () => {
    const el = mount();
    el.setValue({
      sections: [
        { title: 'בצק', items: [{ amount: 2, unit: 'כוסות', item: 'קמח' }] },
        { title: 'מילוי', items: [{ amount: null, unit: '', item: 'סוכר' }] },
      ],
    });
    const rows = el.shadowRoot.querySelectorAll('.recipe-form__ingredient-entry');
    rows[1].querySelector('.recipe-form__input--quantity').value = 'abc';
    const result = el.validate();
    expect(result.isValid).toBe(false);
    expect(result.errors['sections[1].items[0].amount']).toBe(true);
  });

  test('validate() flags a zero amount', () => {
    const el = mount();
    el.setValue([{ amount: null, unit: '', item: 'קמח' }]);
    el.shadowRoot.querySelector('.recipe-form__input--quantity').value = '0';
    expect(el.validate().errors['items[0].amount']).toBe(true);
  });
});
