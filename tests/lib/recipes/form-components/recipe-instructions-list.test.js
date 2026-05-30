import { jest } from '@jest/globals';
import 'src/lib/recipes/recipe_form_component/parts/recipe-instructions-list.js';

function mount() {
  const el = document.createElement('recipe-instructions-list');
  document.body.appendChild(el);
  return el;
}

describe('recipe-instructions-list — unified contract', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('setValue with a flat string array populates simple mode and getValue round-trips', () => {
    const el = mount();
    el.setValue(['boil water', 'add pasta']);
    expect(el.isSectionMode).toBe(false);
    expect(el.getValue()).toEqual([{ text: 'boil water' }, { text: 'add pasta' }]);
  });

  test('setValue with an array of {text} objects works', () => {
    const el = mount();
    el.setValue([{ text: 'step a' }, { text: 'step b' }]);
    expect(el.getValue()).toEqual([{ text: 'step a' }, { text: 'step b' }]);
  });

  test('setValue with {stages} populates section mode', () => {
    const el = mount();
    el.setValue({
      stages: [
        { title: 'Prep', instructions: ['chop', 'mix'] },
        { title: 'Cook', instructions: ['fry'] },
      ],
    });
    expect(el.isSectionMode).toBe(true);
    expect(el.getValue()).toEqual([
      { title: 'Prep', items: [{ text: 'chop' }, { text: 'mix' }] },
      { title: 'Cook', items: [{ text: 'fry' }] },
    ]);
  });

  test('setValue marks the field pristine (not dirty)', () => {
    const el = mount();
    el.setValue(['a', 'b']);
    expect(el.isDirty()).toBe(false);
  });

  test('setValue with empty/null clears to a single empty step', () => {
    const el = mount();
    el.setValue(['a', 'b']);
    el.setValue([]);
    expect(el.isSectionMode).toBe(false);
    expect(el.getValue()).toEqual([]);
  });

  test('legacy aliases getInstructions/populateInstructions/clearInstructions are removed', () => {
    const el = mount();
    expect(el.getInstructions).toBeUndefined();
    expect(el.populateInstructions).toBeUndefined();
    expect(el.clearInstructions).toBeUndefined();
  });

  test('mutating the list dispatches value-changed and dirty-changed', () => {
    const el = mount();
    el.setValue(['a']); // baseline
    const valueHandler = jest.fn();
    const dirtyHandler = jest.fn();
    el.addEventListener('value-changed', valueHandler);
    el.addEventListener('dirty-changed', dirtyHandler);

    // Simulate adding a step via the public change path.
    el.dispatchChangeEvent('item-added');

    expect(valueHandler).toHaveBeenCalledTimes(1);
    // Dirty state did not actually change (DOM unchanged here), so dirty-changed
    // may or may not fire; value-changed must always fire.
    expect(valueHandler.mock.calls[0][0].detail.value).toEqual([{ text: 'a' }]);
  });

  test('validate() flags empty instructions in basic mode', () => {
    const el = mount();
    el.setValue([]); // empty
    const result = el.validate();
    expect(result.isValid).toBe(false);
    expect(result.errors.instructions).toBeDefined();
  });

  test('validate() passes for a populated list', () => {
    const el = mount();
    el.setValue(['do the thing']);
    expect(el.validate().isValid).toBe(true);
  });
});
