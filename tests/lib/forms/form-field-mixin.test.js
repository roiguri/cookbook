import { jest } from '@jest/globals';
import { FormFieldMixin, deepEqual, deepClone } from 'src/lib/forms/form-field-base.js';

// Minimal concrete field backed by a plain internal value, for testing the mixin in isolation.
class TestField extends FormFieldMixin(HTMLElement) {
  constructor() {
    super();
    this._value = null;
  }
  getValue() {
    return this._value;
  }
  setValue(value) {
    this._value = value;
    this.markPristine();
  }
  _getEmptyValue() {
    return null;
  }
}
customElements.define('test-field', TestField);

function makeField() {
  const el = new TestField();
  document.body.appendChild(el);
  return el;
}

describe('deepEqual', () => {
  test('treats null/undefined/empty-string/empty-array as equivalent', () => {
    expect(deepEqual(null, undefined)).toBe(true);
    expect(deepEqual(null, '')).toBe(true);
    expect(deepEqual(undefined, [])).toBe(true);
    expect(deepEqual('', [])).toBe(true);
  });

  test('distinguishes empty from non-empty', () => {
    expect(deepEqual(null, 'x')).toBe(false);
    expect(deepEqual([], [1])).toBe(false);
  });

  test('compares nested objects and arrays by structure', () => {
    expect(deepEqual({ a: 1, b: [{ c: 2 }] }, { a: 1, b: [{ c: 2 }] })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual([{ x: 1 }], [{ x: 1 }, { y: 2 }])).toBe(false);
  });

  test('treats missing key as undefined (empty-equivalent)', () => {
    expect(deepEqual({ a: 1, b: null }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
  });
});

describe('deepClone', () => {
  test('produces an independent copy', () => {
    const src = { a: 1, b: { c: [1, 2] } };
    const clone = deepClone(src);
    expect(clone).toEqual(src);
    clone.b.c.push(3);
    expect(src.b.c).toEqual([1, 2]);
  });

  test('drops File/Blob values', () => {
    const file = new File(['data'], 'a.png', { type: 'image/png' });
    const clone = deepClone({ id: '1', file, name: 'a.png' });
    expect(clone).toEqual({ id: '1', name: 'a.png' });
  });

  test('passes through null/undefined', () => {
    expect(deepClone(null)).toBeNull();
    expect(deepClone(undefined)).toBeUndefined();
  });
});

describe('FormFieldMixin', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('isDirty() is false before any baseline', () => {
    const el = new TestField();
    expect(el.isDirty()).toBe(false);
  });

  test('isDirty() is false right after setValue (baseline captured)', () => {
    const el = makeField();
    el.setValue({ a: 1 });
    expect(el.isDirty()).toBe(false);
  });

  test('isDirty() becomes true after a mutation, false again after markPristine', () => {
    const el = makeField();
    el.setValue({ a: 1 });
    el._value = { a: 2 };
    expect(el.isDirty()).toBe(true);
    el.markPristine();
    expect(el.isDirty()).toBe(false);
  });

  test('clear() resets to empty value and is pristine', () => {
    const el = makeField();
    el.setValue({ a: 1 });
    el.clear();
    expect(el.getValue()).toBeNull();
    expect(el.isDirty()).toBe(false);
  });

  test('_emitValueChanged dispatches value-changed with the current value', () => {
    const el = makeField();
    el._value = { a: 5 };
    const handler = jest.fn();
    el.addEventListener('value-changed', handler);
    el._emitValueChanged({ action: 'edit' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({ value: { a: 5 }, action: 'edit' });
  });

  test('value-changed bubbles and is composed', () => {
    const el = makeField();
    const detail = el.dispatchEvent;
    let evt;
    el.addEventListener('value-changed', (e) => (evt = e));
    el._emitValueChanged();
    expect(evt.bubbles).toBe(true);
    expect(evt.composed).toBe(true);
    expect(detail).toBeDefined();
  });

  test('_emitDirtyChanged only fires when dirty state flips', () => {
    const el = makeField();
    el.setValue({ a: 1 }); // pristine, _lastEmittedDirty=false
    const handler = jest.fn();
    el.addEventListener('dirty-changed', handler);

    el._emitDirtyChanged(); // still clean → no event
    expect(handler).not.toHaveBeenCalled();

    el._value = { a: 2 };
    el._emitDirtyChanged(); // clean → dirty
    el._emitDirtyChanged(); // dirty → dirty (dedup, no event)
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({ isDirty: true });

    el.markPristine();
    el._emitDirtyChanged(); // dirty → clean
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[1][0].detail).toEqual({ isDirty: false });
  });

  test('default validate() returns valid', () => {
    const el = makeField();
    expect(el.validate()).toEqual({ isValid: true, errors: {} });
  });

  test('abstract getValue/setValue throw when not overridden', () => {
    class Bare extends FormFieldMixin(HTMLElement) {}
    customElements.define('bare-field', Bare);
    const el = new Bare();
    expect(() => el.getValue()).toThrow(/getValue/);
    expect(() => el.setValue(1)).toThrow(/setValue/);
  });
});
