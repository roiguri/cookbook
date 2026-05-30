import { jest } from '@jest/globals';
import 'src/lib/recipes/recipe_form_component/parts/recipe-comments-list.js';

function mount() {
  const el = document.createElement('recipe-comments-list');
  document.body.appendChild(el);
  return el;
}

describe('recipe-comments-list — unified contract (inherited)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('getValue/setValue round-trip', () => {
    const el = mount();
    el.setValue(['nice tip', 'another']);
    expect(el.getValue()).toEqual(['nice tip', 'another']);
  });

  test('setValue marks pristine', () => {
    const el = mount();
    el.setValue(['a']);
    expect(el.isDirty()).toBe(false);
  });

  test('clear() empties the list and is pristine', () => {
    const el = mount();
    el.setValue(['a', 'b']);
    el.clear();
    expect(el.getValue()).toEqual([]);
    expect(el.isDirty()).toBe(false);
  });

  test('validate() returns valid (comments are optional)', () => {
    const el = mount();
    expect(el.validate()).toEqual({ isValid: true, errors: {} });
  });

  test('setDisabled disables inputs and buttons', () => {
    const el = mount();
    el.setDisabled(true);
    el.shadowRoot.querySelectorAll('input, button').forEach((node) => {
      expect(node.disabled).toBe(true);
    });
  });

  test('structural change dispatches value-changed', () => {
    const el = mount();
    el.setValue(['a']);
    const handler = jest.fn();
    el.addEventListener('value-changed', handler);
    el.dispatchChangeEvent('item-added');
    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[0][0].detail.value).toEqual(['a']);
  });
});
