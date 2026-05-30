import { jest } from '@jest/globals';

// Holder so individual tests can control what RecipeService.get returns
// (null = propose/fresh form; an object = edit mode loading that recipe).
const recipeHolder = { current: null };

// Mock heavy / Firebase-backed dependencies so the orchestrator mounts in jsdom.
jest.unstable_mockModule('src/js/services/recipes/recipe-service.js', () => ({
  RecipeService: { get: jest.fn(async () => recipeHolder.current), list: jest.fn(async () => []) },
}));
jest.unstable_mockModule('src/js/services/recipes/recipe-image-service.js', () => ({
  RecipeImageService: { getOptimizedUrl: jest.fn(async () => 'data:preview') },
}));
jest.unstable_mockModule('src/js/services/recipes/media-instruction-service.js', () => ({
  MediaInstructionService: { getUrl: jest.fn(async () => 'https://cdn/x'), delete: jest.fn() },
}));
jest.unstable_mockModule('src/js/services/auth/auth-service.js', () => ({
  default: {
    addAuthObserver: jest.fn(),
    removeAuthObserver: jest.fn(),
    getCurrentUser: jest.fn(() => ({ uid: 'tester' })),
  },
}));
// The import modal drags in firebase/functions, cropperjs and the game wrapper —
// stub it out; the orchestrator only needs the element to exist.
jest.unstable_mockModule('src/lib/recipes/recipe_import_modal/recipe_import_modal.js', () => ({}));

beforeAll(async () => {
  await import('src/lib/recipes/recipe_form_component/recipe_form_component.js');
});

async function mount(attrs = '') {
  recipeHolder.current = null;
  document.body.innerHTML = `<recipe-form-component ${attrs}></recipe-form-component>`;
  const el = document.querySelector('recipe-form-component');
  // Let connectedCallback + queueMicrotask(captureBaseline) settle.
  await Promise.resolve();
  await Promise.resolve();
  return el;
}

async function waitFor(cond, tries = 80) {
  for (let i = 0; i < tries; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('waitFor: condition not met in time');
}

const EDIT_RECIPE = {
  name: 'מתכון קיים',
  category: 'appetizers',
  description: 'תיאור קצר',
  prepTime: 20,
  waitTime: 10,
  servings: 4,
  servingsUnit: 'מנות',
  difficulty: 'קלה',
  mainIngredient: 'עוף',
  tags: ['שבת'],
  ingredients: [{ amount: 2, unit: 'כוסות', item: 'קמח' }],
  instructions: ['שלב ראשון'],
  comments: ['הערה משפחתית'],
  attribution: 'סבתא רותי',
  relatedRecipes: [],
  images: [],
  mediaInstructions: [],
};

async function mountEdit(recipe = EDIT_RECIPE) {
  recipeHolder.current = recipe;
  // disable-form-protection: no router nav-guard needed in the test env.
  document.body.innerHTML =
    '<recipe-form-component recipe-id="r1" disable-form-protection></recipe-form-component>';
  const el = document.querySelector('recipe-form-component');
  await waitFor(() => el._baselineReady === true);
  return el;
}

describe('recipe-form-component — orchestrator fan-out', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('a fresh form is not dirty', async () => {
    const el = await mount();
    expect(el.isFormDirty()).toBe(false);
    expect(el.isDirty).toBe(false);
  });

  test('editing metadata makes the form dirty and emits form-dirty-changed', async () => {
    const el = await mount();
    const dirtyHandler = jest.fn();
    el.addEventListener('form-dirty-changed', dirtyHandler);

    const nameInput = el._fields.metadata.shadowRoot.getElementById('name');
    nameInput.value = 'מתכון חדש';
    el.recomputeDirty();

    expect(el.isFormDirty()).toBe(true);
    expect(dirtyHandler).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { isDirty: true } }),
    );
  });

  test('adding ingredients marks the form dirty (was a silent bug)', async () => {
    const el = await mount();
    el._fields.ingredients.setValue([{ amount: 2, unit: 'cups', item: 'flour' }]);
    expect(el.isFormDirty()).toBe(true);
  });

  test('editing attribution (orchestrator-owned input) marks the form dirty', async () => {
    const el = await mount();
    el._attributionInput.value = 'סבתא';
    expect(el.isFormDirty()).toBe(true);
  });

  test('clearForm resets the form to a clean state', async () => {
    const el = await mount();
    el._fields.metadata.shadowRoot.getElementById('name').value = 'x';
    el._fields.ingredients.setValue([{ amount: 1, unit: 'kg', item: 'beef' }]);
    el.recomputeDirty();
    expect(el.isFormDirty()).toBe(true);

    el.clearForm();
    expect(el.isFormDirty()).toBe(false);
    expect(el.isDirty).toBe(false);
  });

  test('setDisabled fans out to every field (incl. related-field — was missing)', async () => {
    const el = await mount();
    el.setDisabled(true);

    const relatedInput = el._fields.related.shadowRoot.getElementById('related-search-input');
    expect(relatedInput.disabled).toBe(true);

    el._fields.metadata.shadowRoot.querySelectorAll('input, select, textarea').forEach((node) => {
      expect(node.disabled).toBe(true);
    });
    expect(el._attributionInput.disabled).toBe(true);
  });

  test('validateForm flags an empty form and shows the error banner', async () => {
    const el = await mount();
    const valid = el.validateForm();
    expect(valid).toBe(false);
    const banner = el.shadowRoot.querySelector('.recipe-form__error-message');
    expect(banner.style.display).toBe('block');
  });

  test('markSaved re-baselines and emits a clean dirty event', async () => {
    const el = await mount();
    el._fields.metadata.shadowRoot.getElementById('name').value = 'x';
    el.recomputeDirty();
    expect(el.isFormDirty()).toBe(true);

    const handler = jest.fn();
    el.addEventListener('form-dirty-changed', handler);
    el.markSaved();

    expect(el.isFormDirty()).toBe(false);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ detail: { isDirty: false } }));
  });
});

describe('recipe-form-component — edit mode', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    recipeHolder.current = null;
  });

  test('populates every field from the loaded recipe and starts clean', async () => {
    const el = await mountEdit();
    const f = el._fields;
    expect(f.metadata.getValue().name).toBe('מתכון קיים');
    expect(f.metadata.getValue().category).toBe('appetizers');
    expect(f.metadata.getValue().mainIngredient).toBe('עוף');
    expect(f.ingredients.getValue()).toEqual([{ amount: 2, unit: 'כוסות', item: 'קמח' }]);
    expect(f.instructions.getValue()).toEqual([{ text: 'שלב ראשון' }]);
    expect(f.comments.getValue()).toEqual(['הערה משפחתית']);
    expect(el._attributionInput.value).toBe('סבתא רותי');
    // Freshly loaded form is clean.
    expect(el.isFormDirty()).toBe(false);
    expect(el.isDirty).toBe(false);
  });

  // Each field: edit → form dirty (+ form-dirty-changed true); re-baseline (as a
  // reset/save would) → clean (+ form-dirty-changed false). This locks the
  // save-button gating bug where captureBaseline didn't emit the clean transition.
  const FIELD_EDITS = [
    ['name', (el) => el._fields.metadata.shadowRoot.getElementById('name')],
    ['mainIngredient', (el) => el._fields.metadata.shadowRoot.getElementById('main-ingredient')],
    ['servings', (el) => el._fields.metadata.shadowRoot.getElementById('servings-form')],
    ['attribution', (el) => el._attributionInput],
  ];

  for (const [label, getInput] of FIELD_EDITS) {
    test(`editing ${label} marks dirty, re-baseline emits a clean event`, async () => {
      const el = await mountEdit();
      const events = [];
      el.addEventListener('form-dirty-changed', (e) => events.push(e.detail.isDirty));

      const input = getInput(el);
      input.value = `${input.value} שינוי`;
      el.recomputeDirty();

      expect(el.isFormDirty()).toBe(true);
      expect(events).toContain(true);

      // Simulate the reset/save re-baseline.
      el.captureBaseline();
      expect(el.isFormDirty()).toBe(false);
      expect(el.isDirty).toBe(false);
      expect(events[events.length - 1]).toBe(false);
    });
  }

  test('editing an ingredient list field marks the form dirty', async () => {
    const el = await mountEdit();
    el._fields.ingredients.setValue([
      { amount: 2, unit: 'כוסות', item: 'קמח' },
      { amount: 1, unit: 'כף', item: 'סוכר' },
    ]);
    // setValue re-baselines the field itself; the orchestrator compares its own
    // snapshot, so an external setValue changes collected data → dirty.
    expect(el.isFormDirty()).toBe(true);
  });

  test('removing a comment then re-baselining returns to clean', async () => {
    const el = await mountEdit();
    el._fields.comments.setValue([]); // remove the comment
    expect(el.isFormDirty()).toBe(true);
    el.captureBaseline();
    expect(el.isFormDirty()).toBe(false);
  });
});
