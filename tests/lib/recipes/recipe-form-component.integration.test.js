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

  test('validateForm flags an empty form and shows the problems banner', async () => {
    const el = await mount();
    const valid = el.validateForm();
    expect(valid).toBe(false);
    const banner = el.shadowRoot.querySelector('.recipe-form__problems');
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toContain('חובה למלא');
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

describe('recipe-form-component — blank amount/unit warning', () => {
  // jsdom does not implement scrollIntoView.
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn();
  });

  const modal = () => document.querySelector('confirmation-modal');
  const click = (id) => modal().shadowRoot.getElementById(id).click();
  const warned = (el) =>
    Array.from(
      el._fields.ingredients.shadowRoot.querySelectorAll('.recipe-form__input--warning'),
    ).map((input) => input.name);

  test('no blank rows: continues without asking', async () => {
    const el = await mount();
    el._fields.ingredients.setValue([{ amount: 2, unit: 'כוסות', item: 'קמח' }]);
    await expect(el.confirmBlankIngredientFields()).resolves.toBe(true);
    expect(modal()).toBeNull();
  });

  test('"review" stops the submit and highlights the blank fields', async () => {
    const el = await mount();
    el._fields.ingredients.setValue([
      { amount: 2, unit: 'כוסות', item: 'קמח' },
      { amount: 3, unit: '', item: 'ביצים' },
      { amount: null, unit: '', item: 'מלח לפי הטעם' },
    ]);
    const pending = el.confirmBlankIngredientFields();
    await waitFor(() => modal());
    expect(modal().shadowRoot.getElementById('modal-message').textContent).toContain(
      'ביצים (יחידה), מלח לפי הטעם (כמות ויחידה)',
    );
    click('modal-reject-button');
    await expect(pending).resolves.toBe(false);
    expect(warned(el)).toEqual(['unit', 'quantity', 'unit']);
  });

  test('rows already asked about are not asked about again', async () => {
    const el = await mount();
    el._fields.ingredients.setValue([{ amount: 3, unit: '', item: 'ביצים' }]);
    const first = el.confirmBlankIngredientFields();
    await waitFor(() => modal());
    click('modal-reject-button');
    await first;
    await expect(el.confirmBlankIngredientFields()).resolves.toBe(true);
    // Going ahead clears the review highlights.
    expect(warned(el)).toEqual([]);
  });

  test('"continue anyway" goes on with the submit', async () => {
    const el = await mount();
    el._fields.ingredients.setValue([{ amount: null, unit: '', item: 'שמן לטיגון' }]);
    const pending = el.confirmBlankIngredientFields();
    await waitFor(() => modal());
    click('modal-approve-button');
    await expect(pending).resolves.toBe(true);
    expect(warned(el)).toEqual([]);
  });

  test('blanks already saved in an edited recipe are not asked about', async () => {
    const el = await mountEdit({
      ...EDIT_RECIPE,
      ingredients: [{ amount: null, unit: '', item: 'מלח לפי הטעם' }],
    });
    await expect(el.confirmBlankIngredientFields()).resolves.toBe(true);
    expect(modal()).toBeNull();
  });
});

describe('recipe-form-component — problems banner', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn();
    global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    global.cancelAnimationFrame = (id) => clearTimeout(id);
  });

  const banner = (el) => el.shadowRoot.querySelector('.recipe-form__problems');
  const links = (el) =>
    Array.from(banner(el).querySelectorAll('.recipe-form__problem-link')).map((b) => b.textContent);
  const md = (el, id) => el._fields.metadata.shadowRoot.getElementById(id);
  const fillMetadata = (el) => {
    md(el, 'name').value = 'עוגה';
    md(el, 'dish-type').value = 'desserts';
    md(el, 'prep-time').value = '20';
    md(el, 'servings-form').value = '4';
    md(el, 'difficulty').value = 'קלה';
  };
  const setSteps = (el) => el._fields.instructions.setValue(['מערבבים ואופים.']);
  const tick = () => new Promise((r) => setTimeout(r, 5));

  test('an empty form lists the required fields and both lists', async () => {
    const el = await mount();
    el.validateForm();
    const line = banner(el).querySelector('.recipe-form__problems-line').textContent;
    expect(line).toContain('חובה למלא:');
    expect(links(el)).toEqual(
      expect.arrayContaining(['שם המנה', 'קטגוריה', 'זמן הכנה', 'כמות מנות', 'דרגת קושי']),
    );
    // More than 5 → collapsed with "ו-N נוספים"
    const more = banner(el).querySelector('.recipe-form__problem-more');
    expect(more.textContent).toMatch(/^ו-\d+ נוספים$/);
    more.click();
    expect(links(el)).toEqual(expect.arrayContaining(['מצרכים', 'הוראות הכנה']));
    expect(banner(el).querySelector('.recipe-form__problem-more')).toBeNull();
  });

  test('wrong amounts are grouped under one explanation, named by their item', async () => {
    const el = await mount();
    fillMetadata(el);
    setSteps(el);
    el._fields.ingredients.setValue([
      { amount: null, unit: '', item: 'קמח' },
      { amount: null, unit: '', item: 'סוכר' },
    ]);
    const rows = el._fields.ingredients.shadowRoot.querySelectorAll(
      '.recipe-form__input--quantity',
    );
    rows[0].value = '2-3';
    rows[1].value = 'חצי';
    expect(el.validateForm()).toBe(false);
    const items = banner(el).querySelectorAll('li');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toBe(
      'כמות ב־קמח · סוכר: צריכה להיות מספר, כמו 2 או 1/2 – או להישאר ריקה.',
    );
  });

  test('a wrong prep time is explained, an empty one is only listed', async () => {
    const el = await mount();
    fillMetadata(el);
    setSteps(el);
    el._fields.ingredients.setValue([{ amount: 2, unit: 'כוסות', item: 'קמח' }]);
    md(el, 'prep-time').value = '0';
    md(el, 'difficulty').value = '';
    el.validateForm();
    expect(banner(el).textContent).toContain('חובה למלא: דרגת קושי');
    expect(banner(el).textContent).toContain('זמן הכנה: צריך להיות מספר דקות גדול מ-0.');
  });

  test('blank amounts / units show as a non-blocking amber line', async () => {
    const el = await mount();
    el._fields.ingredients.setValue([{ amount: 3, unit: '', item: 'ביצים' }]);
    el.validateForm();
    const warn = banner(el).querySelector('.recipe-form__problems-warn');
    expect(warn.textContent).toBe('לבדיקה (לא חובה): ביצים (יחידה)');
    // Already shown, so the save-time question will not ask about it again.
    expect(el._acknowledgedBlankRows.has('ביצים::unit')).toBe(true);
  });

  test('fixing a field drops it from the banner and the side-button count', async () => {
    const el = await mount();
    fillMetadata(el);
    setSteps(el);
    el._fields.ingredients.setValue([{ amount: 2, unit: 'כוסות', item: 'קמח' }]);
    md(el, 'dish-type').value = '';
    md(el, 'difficulty').value = '';
    el.validateForm();
    const count = () => el.shadowRoot.querySelector('.recipe-form__jump-count').textContent;
    expect(count()).toBe('2');

    md(el, 'dish-type').value = 'desserts';
    md(el, 'dish-type').dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await tick();
    expect(links(el)).toEqual(['דרגת קושי']);
    expect(count()).toBe('1');

    md(el, 'difficulty').value = 'קלה';
    md(el, 'difficulty').dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await tick();
    expect(banner(el).hidden).toBe(true);
    expect(el.shadowRoot.querySelector('.recipe-form__jump-anchor').hidden).toBe(true);
  });

  test('the side button moves through the problems in order', async () => {
    const el = await mount();
    fillMetadata(el);
    setSteps(el);
    el._fields.ingredients.setValue([{ amount: 2, unit: 'כוסות', item: 'קמח' }]);
    md(el, 'name').value = '';
    md(el, 'difficulty').value = '';
    el.validateForm();
    const focused = [];
    md(el, 'name').focus = () => focused.push('name');
    md(el, 'difficulty').focus = () => focused.push('difficulty');
    const jump = el.shadowRoot.querySelector('.recipe-form__jump');
    jump.click();
    jump.click();
    jump.click();
    expect(focused).toEqual(['name', 'difficulty', 'name']);
  });
});

describe('recipe-form-component — problems banner edge cases', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn();
  });

  test('six missing fields are all listed (no "ו-1 נוספים")', async () => {
    const el = await mount();
    el._fields.ingredients.setValue([{ amount: 2, unit: 'כוסות', item: 'קמח' }]);
    el.validateForm();
    const banner = el.shadowRoot.querySelector('.recipe-form__problems');
    // name, category, prep time, servings, difficulty, instructions = 6
    expect(banner.querySelectorAll('.recipe-form__problem-link')).toHaveLength(6);
    expect(banner.querySelector('.recipe-form__problem-more')).toBeNull();
  });

  test('a row with an error is not repeated in the amber line', async () => {
    const el = await mount();
    el._fields.ingredients.setValue([
      { amount: null, unit: '', item: 'קמח' },
      { amount: 3, unit: '', item: 'ביצים' },
    ]);
    el._fields.ingredients.shadowRoot.querySelector('.recipe-form__input--quantity').value = '2-3';
    el.validateForm();
    const warn = el.shadowRoot.querySelector('.recipe-form__problems-warn');
    expect(warn.textContent).toBe('לבדיקה (לא חובה): ביצים (יחידה)');
  });
});

describe('recipe-form-component — saved blanks', () => {
  test('blanks already in the saved recipe are not listed in the amber line', async () => {
    const el = await mountEdit({
      ...EDIT_RECIPE,
      name: '',
      ingredients: [
        { amount: null, unit: '', item: 'מלח לפי הטעם' },
        { amount: 2, unit: 'כוסות', item: 'קמח' },
      ],
    });
    el._fields.ingredients.setValue([
      { amount: null, unit: '', item: 'מלח לפי הטעם' },
      { amount: 2, unit: 'כוסות', item: 'קמח' },
      { amount: 3, unit: '', item: 'ביצים' },
    ]);
    el.validateForm();
    const warn = el.shadowRoot.querySelector('.recipe-form__problems-warn');
    expect(warn.textContent).toBe('לבדיקה (לא חובה): ביצים (יחידה)');
  });
});
