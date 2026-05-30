import { jest } from '@jest/globals';
import 'src/lib/recipes/recipe_form_component/parts/recipe-metadata-fields.js';

function mount() {
  const el = document.createElement('recipe-metadata-fields');
  document.body.appendChild(el);
  return el;
}

const VALID = {
  name: 'עוגה',
  category: 'desserts',
  description: 'טעים',
  prepTime: 30,
  waitTime: 60,
  servings: 8,
  servingsUnit: 'מנות',
  difficulty: 'קלה',
  mainIngredient: 'קמח',
  tags: ['שבת', 'פסח'],
};

describe('recipe-metadata-fields — unified contract', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('setValue populates fields and getValue round-trips', () => {
    const el = mount();
    el.setValue(VALID);
    const value = el.getValue();
    expect(value.name).toBe('עוגה');
    expect(value.category).toBe('desserts');
    expect(value.prepTime).toBe(30);
    expect(value.servings).toBe(8);
    expect(value.tags).toEqual(['שבת', 'פסח']);
  });

  test('setValue marks the field pristine', () => {
    const el = mount();
    el.setValue(VALID);
    expect(el.isDirty()).toBe(false);
  });

  test('typing in a field makes it dirty', () => {
    const el = mount();
    el.setValue(VALID);
    const nameInput = el.shadowRoot.getElementById('name');
    nameInput.value = 'שם אחר';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(el.isDirty()).toBe(true);
  });

  test('clear() resets all fields and is pristine', () => {
    const el = mount();
    el.setValue(VALID);
    el.clear();
    expect(el.getValue().name).toBe('');
    expect(el.getValue().category).toBe('');
    expect(el.isDirty()).toBe(false);
  });

  test('legacy getFormData/clearFields aliases are removed', () => {
    const el = mount();
    expect(el.getFormData).toBeUndefined();
    expect(el.clearFields).toBeUndefined();
  });

  test('validate() flags missing required fields', () => {
    const el = mount();
    const { isValid, errors } = el.validate();
    expect(isValid).toBe(false);
    expect(errors.name).toBeDefined();
    expect(errors.category).toBeDefined();
    expect(errors.difficulty).toBeDefined();
    expect(errors.servings).toBeDefined();
  });

  test('validate() requires a positive prep time (empty or 0 is invalid)', () => {
    const el = mount();
    el.setValue(VALID);
    // empty prep time
    el.shadowRoot.getElementById('prep-time').value = '';
    expect(el.validate().errors.prepTime).toBeDefined();
    // zero prep time
    el.shadowRoot.getElementById('prep-time').value = '0';
    expect(el.validate().errors.prepTime).toBeDefined();
    // positive prep time
    el.shadowRoot.getElementById('prep-time').value = '15';
    expect(el.validate().errors.prepTime).toBeUndefined();
  });

  test('validate() treats wait time as optional (empty/0 is valid)', () => {
    const el = mount();
    el.setValue(VALID);
    el.shadowRoot.getElementById('wait-time').value = '';
    expect(el.validate().isValid).toBe(true);
    el.shadowRoot.getElementById('wait-time').value = '0';
    expect(el.validate().isValid).toBe(true);
  });

  test('validate() does not leak non-metadata errors (e.g. ingredientsRequired)', () => {
    const el = mount();
    const { errors } = el.validate();
    expect(errors.ingredientsRequired).toBeUndefined();
    expect(errors.ingredients).toBeUndefined();
  });

  test('validate() passes for valid metadata', () => {
    const el = mount();
    el.setValue(VALID);
    expect(el.validate().isValid).toBe(true);
  });

  test('setValidationState toggles the invalid class per field', () => {
    const el = mount();
    el.setValidationState({ name: 'bad' });
    expect(
      el.shadowRoot.getElementById('name').classList.contains('recipe-form__input--invalid'),
    ).toBe(true);
    el.setValidationState({});
    expect(
      el.shadowRoot.getElementById('name').classList.contains('recipe-form__input--invalid'),
    ).toBe(false);
  });

  test('setDisabled toggles disabled on all controls', () => {
    const el = mount();
    el.setDisabled(true);
    el.shadowRoot.querySelectorAll('input, select, textarea').forEach((node) => {
      expect(node.disabled).toBe(true);
    });
  });
});
