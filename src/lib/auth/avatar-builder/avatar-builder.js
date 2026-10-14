/**
 * AvatarBuilder Component
 * @class
 * @extends HTMLElement
 *
 * @description
 * Build a chef avatar part by part: a live preview, one tab per part (face, hair, eyes…)
 * with a thumbnail per option, colour swatches for the part's palette, "surprise me"
 * and "undo changes". Drawing and the part catalogue live in
 * `src/js/utils/avatar/chef-avatar.js`.
 *
 * The component does not save. Save fires `avatar-builder-save` ({ config }); the parent
 * uploads and then calls `markSaved(config)` (or `setBusy(false)` on failure).
 *
 * @property {Object} config - the avatar config being edited (set before or after connect)
 * @property {boolean} active - whether the saved config is the avatar in use (not a stock
 *   pick or initials); when false, Save stays enabled so the built avatar can be re-applied
 *
 * @fires avatar-builder-save - detail: { config }
 */

import { icons } from '../../../js/icons.js';
import {
  AVATAR_COLORS,
  AVATAR_PARTS,
  DEFAULT_AVATAR_CONFIG,
  normalizeAvatarConfig,
  randomAvatarConfig,
  renderAvatarSvg,
} from '../../../js/utils/avatar/chef-avatar.js';

// Which palette each part's tab shows under its options.
const PALETTE_FOR = {
  hair: 'hair',
  facialHair: 'hair',
  hat: 'outfit',
  outfit: 'outfit',
};

// Skin and background are colour-only tabs, at the start and end.
const TABS = [
  { key: 'skin', label: AVATAR_COLORS.skin.label, palette: 'skin' },
  ...Object.entries(AVATAR_PARTS).map(([key, part]) => ({
    key,
    label: part.label,
    part: key,
    palette: PALETTE_FOR[key],
  })),
  { key: 'background', label: AVATAR_COLORS.background.label, palette: 'background' },
];

const sameConfig = (a, b) => JSON.stringify(a) === JSON.stringify(b);

class AvatarBuilder extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = normalizeAvatarConfig(DEFAULT_AVATAR_CONFIG);
    this._saved = null;
    this._tab = TABS[0].key;
    this._busy = false;
    this._active = false;
  }

  get active() {
    return this._active;
  }

  set active(value) {
    this._active = Boolean(value);
    this._updateActions();
  }

  get config() {
    return this._config;
  }

  /** The config to edit; also becomes the "saved" state that undo returns to. */
  set config(value) {
    this._config = normalizeAvatarConfig(value);
    this._saved = value ? this._config : null;
    if (this.isConnected) this._update();
  }

  connectedCallback() {
    if (!this.shadowRoot.firstChild) {
      this._render();
      this._bind();
    }
    this._update();
  }

  /** After a successful save: this config is now the saved one. */
  markSaved(config = this._config) {
    this._saved = normalizeAvatarConfig(config);
    this._active = true;
    this.setBusy(false);
  }

  setBusy(busy) {
    this._busy = busy;
    this._updateActions();
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        :host([hidden]) { display: none; }
        * { box-sizing: border-box; }

        .top {
          display: flex; align-items: center; gap: 18px;
        }
        .preview {
          width: 112px; height: 112px; flex-shrink: 0;
          border-radius: 50%;
          background: var(--surface-2, #f2e8cf);
          box-shadow: var(--shadow-1, 0 1px 4px rgba(31,29,24,0.08));
          overflow: hidden;
        }
        .preview svg { width: 100%; height: 100%; display: block; }
        .actions { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; min-width: 0; }
        .actions-row { display: flex; flex-wrap: wrap; gap: 8px; }

        .btn {
          display: inline-flex; align-items: center; justify-content: center; gap: 7px;
          font-family: var(--font-ui-he, var(--font-ui, system-ui, sans-serif));
          font-size: 13.5px; font-weight: 500;
          padding: 9px 16px; border-radius: var(--r-sm, 8px);
          border: 1px solid transparent; cursor: pointer;
          transition: background var(--dur-1, 160ms) var(--ease, ease), border-color var(--dur-1, 160ms) var(--ease, ease);
        }
        .btn svg { width: 14px; height: 14px; fill: currentColor; }
        .btn:focus-visible, .tab:focus-visible, .opt:focus-visible, .swatch:focus-visible {
          outline: none; box-shadow: var(--ring, 0 0 0 3px rgba(106,153,78,0.35));
        }
        .btn-primary { background: var(--primary, #6a994e); color: #fff; }
        .btn-primary:hover:not(:disabled) { background: var(--primary-dark, #386641); }
        .btn-ghost {
          background: var(--surface-1, #fff); color: var(--ink, #1f1d18);
          border-color: var(--hairline-strong, rgba(31,29,24,0.2));
        }
        .btn-ghost:hover:not(:disabled) { background: var(--surface-2, #f2e8cf); }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .status {
          font-family: var(--font-ui-he, var(--font-ui, system-ui, sans-serif));
          font-size: 12.5px; color: var(--ink-3, #7c7562); margin: 0;
        }

        .tabs {
          display: flex; flex-wrap: wrap; gap: 6px;
          margin: 20px 0 14px;
        }
        .tab {
          font-family: var(--font-ui-he, var(--font-ui, system-ui, sans-serif));
          font-size: 13px; font-weight: 500;
          padding: 6px 12px; border-radius: var(--r-pill, 999px);
          border: 1px solid var(--hairline-strong, rgba(31,29,24,0.2));
          background: var(--surface-1, #fff); color: var(--ink-2, #4a4538);
          cursor: pointer;
          transition: background var(--dur-1, 160ms) var(--ease, ease), color var(--dur-1, 160ms) var(--ease, ease);
        }
        .tab:hover { background: var(--surface-2, #f2e8cf); }
        .tab[aria-selected="true"] {
          background: var(--primary-dark, #386641); border-color: var(--primary-dark, #386641); color: #fff;
        }

        .options {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
          gap: 8px;
        }
        .opt {
          aspect-ratio: 1 / 1; padding: 0;
          border-radius: var(--r-md, 12px);
          border: 2px solid var(--hairline, rgba(31,29,24,0.08));
          background: var(--surface-2, #f2e8cf);
          cursor: pointer; overflow: hidden; position: relative;
          transition: border-color var(--dur-1, 160ms) var(--ease, ease), transform var(--dur-1, 160ms) var(--ease, ease);
        }
        .opt svg { width: 100%; height: 100%; display: block; }
        .opt:hover { transform: translateY(-2px); border-color: var(--primary-bright, #a7c957); }
        .opt[aria-checked="true"] {
          border-color: var(--primary-dark, #386641);
          box-shadow: 0 0 0 3px rgba(106,153,78,0.12);
        }
        .opt[aria-checked="true"]::after {
          content: "✓"; position: absolute; top: 2px; inset-inline-end: 5px;
          color: var(--primary-dark, #386641); font-weight: 600; font-size: 12px;
        }
        .hint {
          font-family: var(--font-ui-he, var(--font-ui, system-ui, sans-serif));
          font-size: 12.5px; color: var(--ink-3, #7c7562); margin: 0 0 10px;
        }

        .palette { margin-top: 16px; }
        .palette[hidden] { display: none; }
        .palette-label {
          font-family: var(--font-ui-he, var(--font-ui, system-ui, sans-serif));
          font-size: 12.5px; color: var(--ink-3, #7c7562); margin: 0 0 8px;
        }
        .swatches { display: flex; flex-wrap: wrap; gap: 8px; }
        .swatch {
          width: 32px; height: 32px; border-radius: 50%; padding: 0;
          border: 2px solid var(--surface-1, #fff);
          box-shadow: 0 0 0 1px var(--hairline-strong, rgba(31,29,24,0.2));
          cursor: pointer;
          transition: transform var(--dur-1, 160ms) var(--ease, ease);
        }
        .swatch:hover { transform: scale(1.08); }
        .swatch[aria-checked="true"] { box-shadow: 0 0 0 2px var(--primary-dark, #386641); }
        .swatch.none {
          background:
            linear-gradient(135deg, transparent 46%, var(--secondary, #bc4749) 46%, var(--secondary, #bc4749) 54%, transparent 54%),
            var(--surface-1, #fff);
        }

        @media (max-width: 560px) {
          .top { gap: 14px; }
          .preview { width: 96px; height: 96px; }
          .options { grid-template-columns: repeat(auto-fill, minmax(58px, 1fr)); }
        }
        @media (prefers-reduced-motion: reduce) {
          .opt, .swatch, .btn, .tab { transition: none; }
          .opt:hover, .swatch:hover { transform: none; }
        }
      </style>

      <div class="top">
        <div class="preview" id="preview"></div>
        <div class="actions">
          <div class="actions-row">
            <button type="button" class="btn btn-primary" id="save-btn">שמירת האווטאר</button>
            <button type="button" class="btn btn-ghost" id="random-btn">${icons.magic}הפתע אותי</button>
          </div>
          <button type="button" class="btn btn-ghost" id="undo-btn">${icons.undoAlt}ביטול השינויים</button>
          <p class="status" id="status" aria-live="polite"></p>
        </div>
      </div>

      <div class="tabs" role="tablist" aria-label="חלקי האווטאר" id="tabs">
        ${TABS.map(
          (t) =>
            `<button type="button" class="tab" role="tab" id="tab-${t.key}" data-tab="${t.key}" aria-controls="panel">${t.label}</button>`,
        ).join('')}
      </div>

      <div id="panel" role="tabpanel">
        <p class="hint" id="hint" hidden></p>
        <div class="options" role="radiogroup" id="options"></div>
        <div class="palette" id="palette">
          <p class="palette-label" id="palette-label"></p>
          <div class="swatches" role="radiogroup" id="swatches"></div>
        </div>
      </div>
    `;
  }

  _bind() {
    const $ = (id) => this.shadowRoot.getElementById(id);
    $('tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]');
      if (!tab) return;
      this._tab = tab.dataset.tab;
      this._update();
    });
    $('tabs').addEventListener('keydown', (e) => this._onTabKey(e));
    $('options').addEventListener('click', (e) => {
      const opt = e.target.closest('[data-option]');
      if (opt) this._set('parts', opt.dataset.part, opt.dataset.option);
    });
    $('swatches').addEventListener('click', (e) => {
      const sw = e.target.closest('[data-color]');
      if (sw) this._set('colors', sw.dataset.palette, sw.dataset.color);
    });
    $('random-btn').addEventListener('click', () => {
      this._config = randomAvatarConfig();
      this._update();
    });
    $('undo-btn').addEventListener('click', () => {
      this._config = this._saved || normalizeAvatarConfig(DEFAULT_AVATAR_CONFIG);
      this._update();
    });
    $('save-btn').addEventListener('click', () => {
      if (this._busy) return;
      this.setBusy(true);
      this.dispatchEvent(
        new CustomEvent('avatar-builder-save', {
          detail: { config: this._config },
          bubbles: true,
          composed: true,
        }),
      );
    });
  }

  // Arrow keys move between tabs (RTL: the row runs right to left).
  _onTabKey(e) {
    const step = { ArrowLeft: 1, ArrowRight: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.key === this._tab);
    this._tab = TABS[(i + step + TABS.length) % TABS.length].key;
    this._update();
    this.shadowRoot.getElementById(`tab-${this._tab}`).focus();
  }

  _set(group, key, id) {
    this._config = { ...this._config, [group]: { ...this._config[group], [key]: id } };
    this._update();
  }

  _update() {
    const $ = (id) => this.shadowRoot.getElementById(id);
    if (!$('preview')) return;
    const config = this._config;
    $('preview').innerHTML = renderAvatarSvg(config, { title: 'תצוגה מקדימה של האווטאר' });

    const tab = TABS.find((t) => t.key === this._tab);
    this.shadowRoot.querySelectorAll('.tab').forEach((el) => {
      const on = el.dataset.tab === tab.key;
      el.setAttribute('aria-selected', String(on));
      el.tabIndex = on ? 0 : -1;
    });
    $('panel').setAttribute('aria-labelledby', `tab-${tab.key}`);

    // Under a hat most hairstyles hide, so hair thumbnails are drawn without one.
    const hatHidesHair = tab.part === 'hair' && config.parts.hat !== 'none';
    $('hint').hidden = !hatHidesHair;
    $('hint').textContent = hatHidesHair
      ? 'רוב השיער מוסתר מתחת לכובע. אפשר להוריד אותו בלשונית ״כובע״.'
      : '';

    const options = $('options');
    options.hidden = !tab.part;
    if (tab.part) {
      const part = AVATAR_PARTS[tab.part];
      options.setAttribute('aria-label', part.label);
      options.innerHTML = part.options
        .map((o) => {
          const parts = {
            ...config.parts,
            [tab.part]: o.id,
            ...(hatHidesHair ? { hat: 'none' } : {}),
          };
          const thumb = renderAvatarSvg(
            { ...config, parts, colors: { ...config.colors, background: 'none' } },
            { viewBox: part.crop },
          );
          const on = config.parts[tab.part] === o.id;
          return `<button type="button" class="opt" role="radio" aria-checked="${on}" aria-label="${o.label}" title="${o.label}" data-part="${tab.part}" data-option="${o.id}">${thumb}</button>`;
        })
        .join('');
    }

    const palette = tab.palette && AVATAR_COLORS[tab.palette];
    $('palette').hidden = !palette;
    if (palette) {
      $('palette-label').textContent = palette.label;
      $('swatches').setAttribute('aria-label', palette.label);
      $('swatches').innerHTML = palette.options
        .map((c) => {
          const on = config.colors[tab.palette] === c.id;
          const style = c.hex ? ` style="background:#${c.hex}"` : '';
          return `<button type="button" class="swatch${c.hex ? '' : ' none'}" role="radio" aria-checked="${on}" aria-label="${c.label}" title="${c.label}" data-palette="${tab.palette}" data-color="${c.id}"${style}></button>`;
        })
        .join('');
    }

    this._updateActions();
  }

  _updateActions() {
    const $ = (id) => this.shadowRoot.getElementById(id);
    if (!$('save-btn')) return;
    const changed = !this._saved || !sameConfig(this._config, this._saved);
    $('save-btn').disabled = this._busy || (this._active && !changed);
    $('save-btn').textContent = this._busy ? 'שומר…' : 'שמירת האווטאר';
    $('undo-btn').disabled = this._busy || !changed;
    $('random-btn').disabled = this._busy;
    $('status').textContent = this._active && !changed ? 'זה האווטאר שלך כרגע.' : '';
  }
}

customElements.define('avatar-builder', AvatarBuilder);
