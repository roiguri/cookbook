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
});
