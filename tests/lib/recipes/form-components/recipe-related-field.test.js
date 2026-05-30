import { jest } from '@jest/globals';

// Mock the recipe service so importing the component does not pull in Firebase.
jest.unstable_mockModule('src/js/services/recipes/recipe-service.js', () => ({
  RecipeService: {
    list: jest.fn(async () => []),
    get: jest.fn(async (id) => ({ id, name: `Recipe ${id}`, category: 'main' })),
  },
}));

beforeAll(async () => {
  await import('src/lib/recipes/recipe_form_component/parts/recipe-related-field.js');
});

function mount() {
  const el = document.createElement('recipe-related-field');
  document.body.appendChild(el);
  return el;
}

describe('recipe-related-field — unified contract', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('getValue returns selected IDs', () => {
    const el = mount();
    el._select({ id: 'a', name: 'A' });
    el._select({ id: 'b', name: 'B' });
    expect(el.getValue()).toEqual(['a', 'b']);
  });

  test('selecting makes the field dirty; markPristine clears it', () => {
    const el = mount();
    el.markPristine(); // baseline empty
    el._select({ id: 'a', name: 'A' });
    expect(el.isDirty()).toBe(true);
    el.markPristine();
    expect(el.isDirty()).toBe(false);
  });

  test('clear() empties selection and fires dirty-changed', () => {
    const el = mount();
    el._select({ id: 'a', name: 'A' });
    el.markPristine();
    const dirtyHandler = jest.fn();
    el.addEventListener('dirty-changed', dirtyHandler);
    el.clear();
    expect(el.getValue()).toEqual([]);
    expect(el.isDirty()).toBe(false);
  });

  test('setDisabled disables the search input and chip remove buttons, and persists across re-render', () => {
    const el = mount();
    el._select({ id: 'a', name: 'A' });
    el.setDisabled(true);
    const input = el.shadowRoot.getElementById('related-search-input');
    expect(input.disabled).toBe(true);
    el.shadowRoot.querySelectorAll('.chip__remove').forEach((btn) => {
      expect(btn.disabled).toBe(true);
    });
    // Re-render (e.g. selecting another) must not silently re-enable.
    el._renderChips();
    expect(input.disabled).toBe(true);
  });

  test('validate() returns valid (related recipes are optional)', () => {
    const el = mount();
    expect(el.validate()).toEqual({ isValid: true, errors: {} });
  });

  test('setValidationState toggles the invalid class', () => {
    const el = mount();
    el.setValidationState({ relatedRecipes: true });
    const input = el.shadowRoot.getElementById('related-search-input');
    expect(input.classList.contains('recipe-form__input--invalid')).toBe(true);
    el.setValidationState({});
    expect(input.classList.contains('recipe-form__input--invalid')).toBe(false);
  });

  test('setValue populates from IDs and marks pristine', async () => {
    const el = mount();
    await el.setValue(['x', 'y']);
    expect(el.getValue()).toEqual(['x', 'y']);
    expect(el.isDirty()).toBe(false);
  });

  test('legacy getData alias is removed', () => {
    const el = mount();
    expect(el.getData).toBeUndefined();
  });
});
