# Component System

UI is composed of **custom Web Components** living under `src/lib/`. Most use Shadow DOM for style isolation. Components are imported dynamically from inside a page's `mount()` so they only enter the bundle when actually used.

## Layout of `src/lib/`

```
src/lib/
├── auth/            # auth-controller, auth-avatar, auth-content, sign-in/up forms
├── collections/     # recipe-card, recipe-list, filter-modal, pagination
├── forms/           # form-field contract (FormFieldMixin) shared by recipe form fields
├── games/           # interactive widgets used on home / category pages
├── media/           # image carousel, image upload, video player (form fields via FormFieldMixin)
├── modals/          # message-modal, confirmation-modal, custom-modal
├── notifications/   # toast / notification surface
├── recipes/         # recipe-component (detail view), ingredient list, instructions
├── search/          # header-search-bar, search-results-page
└── utilities/       # modal base class, spinner, error boundary, etc.
```

Each component sits in its own folder with `component-name.js` (custom element), optionally `component-name.css` (inlined into the shadow root via `<link>` or imported), and tests next door.

## Authoring conventions

- **Custom element class** extends `HTMLElement`. Define with `customElements.define('tag-name', ClassName)` at the bottom of the file. The module's side effect _is_ the registration — importing it is enough.
- **Shadow DOM by default**: `this.attachShadow({ mode: 'open' })` in the constructor. Styles are loaded into the shadow root, so global CSS leaks are not a concern; tokens from `src/styles/tokens.css` are still available because CSS custom properties pierce the shadow boundary.
- **Lifecycle**: do DOM work in `connectedCallback`, undo it in `disconnectedCallback`. Treat the component as you would a page module — anything that registers a listener must unregister it.
- **Attributes vs properties**: expose configuration via observed attributes (`static get observedAttributes()`) when the value is a primitive a parent can set in HTML. For richer data (objects, arrays), expose a property setter — `set data(value)` — so parents can pass pre-fetched data and bypass the component's own fetch. This avoids N+1 fetch cascades in lists; see `docs/lessons/performance.md` ("Web Components Data Passing").

## Communication: custom events

Components do **not** import each other for coordination. They dispatch `CustomEvent`s from the shadow root with `{ bubbles: true, composed: true }`, and page modules (or parent components) listen on the container. Examples in the codebase:

- `recipe-card-open` — recipe card → categories page → router navigation to `/recipe/:id`
- `recipe-favorite-changed` — favourite button → auth service (refreshes cached user data)
- `auth-state-changed` — auth controller → header nav (adds/removes role-specific tabs)
- `spa-navigation` — router → navigation script (link interception)
- `value-changed` / `dirty-changed` — form field → recipe-form orchestrator (see "Form-field contract" below)
- `form-dirty-changed` — recipe-form orchestrator → parent (e.g. edit-modal save-button gating)

Page modules subscribe in `mount()` and unsubscribe in `unmount()`. If a listener is attached to the container element rather than `window`/`document`, the container's `innerHTML = ''` in `PageManager.unloadCurrentPage()` will clean it up automatically — but explicit removal is still the right habit because it covers listeners on `window`/`document` too.

## Form-field contract

The recipe form is an **orchestrator over a set of field components**. Rather than each field exposing its own ad-hoc value/dirty/validation API, every form field mixes in a single shared contract so the orchestrator can fan one loop out over all of them.

### `FormFieldMixin` — `src/lib/forms/form-field-base.js`

A **class mixin** (`FormFieldMixin(Base)`), not a base class. The form sub-components live on several inheritance chains (`DynamicListComponent → SectionedListComponent → lists`, plus components that extend `HTMLElement` directly), so a mixin composes the contract onto any rung without rewriting constructors or `super()` call sites:

```js
import { FormFieldMixin } from '../../../forms/form-field-base.js';

class RecipeMetadataFields extends FormFieldMixin(HTMLElement) { ... }
```

The contract every field exposes:

| Method                       | Purpose                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `getValue()`                 | the field's value (shape is field-specific) — **must override**                   |
| `setValue(value)`            | populate the field; resets the pristine baseline — **must override**              |
| `clear()`                    | reset to the empty value (pristine) — provided                                    |
| `isDirty()`                  | has the value changed since the last `markPristine()`? — provided                 |
| `markPristine()`             | snapshot the current value as the clean baseline — provided                       |
| `validate()`                 | `{ isValid, errors }` — defaults to always-valid; override if the field validates |
| `setValidationState(errors)` | reflect errors in the UI — default no-op; override to surface per-field errors    |
| `setDisabled(disabled)`      | enable/disable controls — default no-op; override if interactive                  |

Two standardized events, dispatched **on the host** with `{ bubbles: true, composed: true }`:

- `value-changed` — on every value mutation; `detail: { value, ...extra }`
- `dirty-changed` — only when `isDirty()` flips; `detail: { isDirty }` (deduped via `_lastEmittedDirty`)

Dirty tracking is form-friendly: `null`, `undefined`, `''`, and `[]` are all treated as "no data" and compared equal (`deepEqual`). The pristine snapshot uses `deepClone`, which **drops `File`/`Blob` values** — only the surrounding metadata participates in dirty comparison, so image fields holding raw `File` references can still be snapshotted.

### Orchestrator — `recipe_form_component.js`

The orchestrator collects field refs once into a `_fields` map (keyed by logical name) and exposes `_fieldList` to iterate. It then:

- **aggregates values** — `buildRecipeData()` calls each field's `getValue()`;
- **fans out validation** — collects every `validate()`, then calls each `setValidationState(allErrors)`;
- **listens** for `value-changed` / `dirty-changed` bubbling up from any field (debounced), recomputes form-level dirtiness, and re-emits `form-dirty-changed` to its parent (e.g. an edit modal gating its save button).

### How to add a new form field

1. Create the component under `src/lib/<area>/` and extend `FormFieldMixin(HTMLElement)` (or `FormFieldMixin(YourBaseList)`).
2. **Override `getValue()` and `setValue(value)`.** `setValue` should populate the UI and call `markPristine()` so the new value becomes the clean baseline.
3. Override `_getEmptyValue()` if the empty state isn't `null` (e.g. `[]` for a list, `{}` for a record).
4. **Call `_emitValueChanged({ ...extra })` and `_emitDirtyChanged()` at every mutation point** (input handlers, add/remove row, etc.). This is what lets the orchestrator notice changes — the mixin does not auto-wire DOM listeners.
5. Override `validate()` / `setValidationState()` only if the field has its own validation; override `setDisabled()` only if it has interactive controls.
6. Register with `customElements.define('your-field', YourField)` and add it to the orchestrator's `collectFieldRefs()` `_fields` map under a logical key. Aggregation in `buildRecipeData()` reads that key.
7. Add a sibling test under `tests/lib/...` exercising the contract (`getValue`/`setValue` round-trip, `isDirty` after mutation, events fired).

## Dynamic import pattern

```js
// In a page module's mount():
async importComponents() {
  await Promise.all([
    import('../../lib/collections/recipe-card/recipe-card.js'),
    import('../../lib/search/header-search-bar/header-search-bar.js'),
  ]);
}
```

Vite splits each component into its own chunk, and the parent page's chunk only references it by URL. This keeps the initial JS payload focused on the shell + first page.

For the home page route specifically, a few components (auth controller, header search bar) are **preloaded** non-blocking in `src/app.js` because they're part of the persistent shell. Everything else lazy-loads per page.

## A11y patterns

- **Interactive cards** that are not native buttons or links must add `tabindex="0"`, `role="button"`, and a `keydown` handler for Enter/Space alongside the `click` listener. See `docs/lessons/accessibility.md` ("Keyboard Accessible Cards").
- **Stretched-link pattern**: prefer a real `<a>` inside the card stretched via `::after { inset: 0 }`, with secondary actions (favourite button) sitting at a higher `z-index` so they remain clickable. This gives native link semantics (open-in-new-tab, middle-click) and avoids the ARIA violation of nesting a button inside `role="button"`.

## XSS hygiene

- Prefer `textContent` or `document.createTextNode` for any value that originated from user input (recipe titles, ingredients, comments). Type-checking a Firestore field as a string is **not** enough — Firestore data is not implicitly trusted at render time.
- If rich text is genuinely required, use DOMPurify before assigning to `innerHTML`.
- See `docs/lessons/security.md` ("DOM XSS in Recipe Component") for the incident that established this rule.

## Templates

Many components fetch an HTML template via:

```js
const response = await fetch(new URL('./component-name.html', import.meta.url));
```

This works identically in dev (Vite) and prod (Netlify) because `import.meta.url` resolves relative to the served chunk URL.
