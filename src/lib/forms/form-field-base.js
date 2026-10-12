/**
 * FormFieldMixin - Unified form-field contract
 * ---------------------------------------------
 * A class mixin that gives any custom element a single, consistent surface that
 * the recipe form orchestrator can fan out over. Used instead of a base class
 * because the form sub-components live on several inheritance chains
 * (DynamicListComponent → SectionedListComponent → lists, plus components that
 * extend HTMLElement directly). A mixin composes onto any rung without rewriting
 * constructors or super() call sites.
 *
 * The contract every form field exposes:
 *   - getValue()                  → the field's value (shape is field-specific)
 *   - setValue(value)             → populate the field; resets the pristine baseline
 *   - clear()                     → reset to the empty value (pristine)
 *   - isDirty()                   → has the value changed since the last markPristine()?
 *   - markPristine()              → snapshot the current value as the clean baseline
 *   - validate()                  → { isValid, errors }
 *   - setValidationState(errors)  → reflect errors in the UI
 *   - getProblems()               → FormProblem[] describing what the last validation found
 *   - showProblems(problems)      → outline exactly these problems (this field's own)
 *   - setDisabled(disabled)       → enable/disable the field's controls
 *
 * Standardized events (dispatched on the host, bubbles + composed):
 *   - value-changed   → on every value mutation; detail: { value, ...extra }
 *   - dirty-changed   → only when isDirty() flips; detail: { isDirty }
 *
 * Concrete components override getValue / setValue / _getEmptyValue and the
 * validation/disable methods, and call _emitValueChanged() / _emitDirtyChanged()
 * at every mutation point.
 *
 * @param {typeof HTMLElement} Base - the superclass to extend
 * @returns {typeof HTMLElement} a class extending Base with the contract
 */
export function FormFieldMixin(Base) {
  return class FormField extends Base {
    constructor(...args) {
      super(...args);
      /** @type {*} snapshot of the value at the last markPristine(); undefined = no baseline yet */
      this._pristineValue = undefined;
      /** @type {boolean} last dirty state emitted via dirty-changed (dedup); starts clean */
      this._lastEmittedDirty = false;
    }

    /**
     * Returns the field's current value. Must be overridden.
     * @returns {*}
     */
    getValue() {
      throw new Error(`${this.constructor.name}: getValue() must be implemented`);
    }

    /**
     * Populates the field and resets the pristine baseline. Must be overridden.
     * @param {*} _value
     */
    setValue(_value) {
      throw new Error(`${this.constructor.name}: setValue() must be implemented`);
    }

    /**
     * The natural empty value for this field (null / [] / {}). Override as needed.
     * @returns {*}
     */
    _getEmptyValue() {
      return null;
    }

    /**
     * Resets the field to its empty value and marks it pristine.
     */
    clear() {
      this.setValue(this._getEmptyValue());
      this.markPristine();
      this._emitValueChanged({ action: 'clear' });
      this._emitDirtyChanged();
    }

    /**
     * @returns {boolean} true when the current value differs from the pristine baseline.
     * Returns false before any baseline has been captured.
     */
    isDirty() {
      if (this._pristineValue === undefined) return false;
      return !deepEqual(this._pristineValue, this.getValue());
    }

    /**
     * Snapshots the current value as the clean baseline.
     * Does not touch the dirty-changed dedup flag: callers that need listeners to
     * see the dirty→clean transition (e.g. after a save) follow this with
     * _emitDirtyChanged(), which then fires because the last emitted state was dirty.
     */
    markPristine() {
      this._pristineValue = deepClone(this.getValue());
    }

    /**
     * Dispatches `value-changed` on the host.
     * @param {Object} [extra] - extra fields merged into detail alongside `value`
     */
    _emitValueChanged(extra = {}) {
      this.dispatchEvent(
        new CustomEvent('value-changed', {
          bubbles: true,
          composed: true,
          detail: { value: this.getValue(), ...extra },
        }),
      );
    }

    /**
     * Dispatches `dirty-changed` only when the dirty state actually changes
     * since the last emission, avoiding redundant events.
     */
    _emitDirtyChanged() {
      const dirty = this.isDirty();
      if (dirty === this._lastEmittedDirty) return;
      this._lastEmittedDirty = dirty;
      this.dispatchEvent(
        new CustomEvent('dirty-changed', {
          bubbles: true,
          composed: true,
          detail: { isDirty: dirty },
        }),
      );
    }

    /**
     * Validates the field. Default: always valid (safe for optional fields).
     * @returns {{ isValid: boolean, errors: Object }}
     */
    validate() {
      return { isValid: true, errors: {} };
    }

    /**
     * Reflects validation errors in the UI. Default: no-op. Override as needed.
     * @param {Object} _errors
     */
    setValidationState(_errors) {
      // Override in components that surface per-field errors.
    }

    /**
     * What the last validate() + setValidationState() found, for the form's
     * problems banner. Default: none. Build entries with {@link fieldProblem}.
     * @returns {FormProblem[]}
     */
    getProblems() {
      return [];
    }

    /**
     * Outlines exactly `problems` (ones this field returned from getProblems)
     * and clears every other outline — used as the user fixes things.
     * @param {FormProblem[]} problems
     */
    showProblems(problems) {
      this.shadowRoot
        ?.querySelectorAll('.recipe-form__input--invalid')
        .forEach((el) => el.classList.remove('recipe-form__input--invalid'));
      problems.forEach((problem) => problem.highlight());
    }

    /**
     * Enables/disables the field's controls. Default: no-op. Override as needed.
     * @param {boolean} _disabled
     */
    setDisabled(_disabled) {
      // Override in components with interactive controls.
    }
  };
}

/**
 * Deep structural equality with form-friendly emptiness handling: null, undefined,
 * empty string, and empty array are all treated as "no data" and considered equal.
 * Mirrors the comparison previously used by FormProtectionManager so dirty-tracking
 * behavior is preserved across the refactor.
 *
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
/**
 * A problem a field reports to the form (see getProblems). The form only reads
 * the data fields and calls focus() / stillApplies(); the field owns the rest.
 * @typedef {Object} FormProblem
 * @property {'missing'|'wrong'|'rule'} kind
 * @property {string} label - shown as the link text
 * @property {string} [group] - wrong values sharing a group share one explanation
 * @property {string} [groupLead] - text before the group's links (e.g. "כמות ב־")
 * @property {string} [explanation] - why a wrong value is wrong
 * @property {() => void} focus - bring the problem into view and focus it
 * @property {() => boolean} stillApplies - re-check against the field's own rules
 * @property {() => void} highlight - outline it (called by the field's showProblems)
 */

/**
 * Builds a {@link FormProblem} for elements inside a field.
 * @param {Element[]} elements - outlined by highlight(); the first is focused
 * @param {Object} props - kind, label and optional group / groupLead / explanation
 * @param {() => boolean} stillApplies
 * @returns {FormProblem}
 */
export function fieldProblem(elements, props, stillApplies) {
  const els = elements.filter(Boolean);
  return {
    ...props,
    stillApplies,
    focus: () => {
      const el = els[0];
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.focus({ preventScroll: true });
    },
    highlight: () => els.forEach((el) => el.classList.add('recipe-form__input--invalid')),
  };
}

export function deepEqual(a, b) {
  if (a === b) return true;

  const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);
  const aEmpty = isEmpty(a);
  const bEmpty = isEmpty(b);
  if (aEmpty && bEmpty) return true;
  if (aEmpty || bEmpty) return false;

  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of allKeys) {
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
}

/**
 * Structured clone used to snapshot the pristine baseline. File/Blob values are
 * dropped (they are not part of dirty comparison — only the surrounding metadata
 * is), so image fields holding raw File references can still be snapshotted.
 *
 * @param {*} value
 * @returns {*}
 */
export function deepClone(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(
    JSON.stringify(value, (_key, val) => {
      if (typeof File !== 'undefined' && val instanceof File) return undefined;
      if (typeof Blob !== 'undefined' && val instanceof Blob) return undefined;
      return val;
    }),
  );
}
