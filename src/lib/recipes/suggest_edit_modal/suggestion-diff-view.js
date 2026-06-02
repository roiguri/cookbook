/**
 * SuggestionDiffView Component
 * @class
 * @extends HTMLElement
 *
 * @description
 * Renders a recipe edit suggestion as a full recipe in the recipe-display visual
 * language, with changes highlighted inline (added = green, removed = red/struck,
 * unchanged = context). Images and step-media render as actual thumbnails marked
 * added/removed; related recipes render as recipe-cards (by name) marked
 * added/removed. Read-only — no editing here.
 *
 * @example
 * const view = document.createElement('suggestion-diff-view');
 * container.appendChild(view);
 * await view.render(currentRecipe, proposedChanges);
 */
import { buildRecipeDiffModel } from '../../../js/utils/recipes/recipe-diff-utils.js';
import { CATEGORY_MAP } from '../../../js/utils/recipes/recipe-data-utils.js';
import { formatIngredientAmount } from '../../../js/utils/recipes/recipe-ingredients-utils.js';
import { RecipeImageService } from '../../../js/services/recipes/recipe-image-service.js';
import { MediaInstructionService } from '../../../js/services/recipes/media-instruction-service.js';

import '../recipe-card/recipe-card.js';

class SuggestionDiffView extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  esc(v) {
    return String(v ?? '').replace(
      /[&<>]/g,
      (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[s],
    );
  }

  /**
   * Render the diff of `proposed` against `current`.
   * @param {Object} current - The live recipe (raw Firestore shape).
   * @param {Object} proposed - The suggestion's proposedChanges.
   */
  async render(current = {}, proposed = {}) {
    const model = buildRecipeDiffModel(current, proposed);
    this.shadowRoot.innerHTML = `<style>${this.styles()}</style><div class="diff" dir="rtl">${this.bodyHtml(model)}</div>`;
    // Async sections that need URL resolution / element wiring.
    await this.fillImages(model.images);
    await this.fillMedia(model.media);
    this.fillRelated(model.related);
  }

  bodyHtml(model) {
    if (!model.hasChange) {
      return '<div class="empty">אין שינויים בתוכן.</div>';
    }
    return [
      this.metaHtml(model.meta),
      this.imagesSectionShell(model.images),
      this.linesSection('מצרכים', model.ingredients, (op) => this.ingredientLine(op)),
      this.linesSection('הוראות הכנה', model.instructions, (op) => this.instructionLine(op)),
      this.mediaSectionShell(model.media),
      this.linesSection('הערות', model.comments, (op) => this.commentLine(op)),
      this.relatedSectionShell(model.related),
    ]
      .filter(Boolean)
      .join('');
  }

  // ---- metadata ----
  metaHtml(meta) {
    if (!meta.length) return '';
    const rows = meta
      .map((m) => {
        const before = m.field === 'category' ? CATEGORY_MAP[m.before] || m.before : m.before;
        const after = m.field === 'category' ? CATEGORY_MAP[m.after] || m.after : m.after;
        const value = m.changed
          ? `<span class="before">${this.esc(before) || '—'}</span><span class="arrow">←</span><span class="after">${this.esc(after) || '—'}</span>`
          : `<span class="ctx">${this.esc(after) || '—'}</span>`;
        return `<div class="meta-row${m.changed ? ' changed' : ''}"><span class="meta-label">${this.esc(m.label)}</span><span class="meta-val">${value}</span></div>`;
      })
      .join('');
    return `<section class="sec"><div class="meta-grid">${rows}</div></section>`;
  }

  // ---- generic line section (ingredients / instructions / comments) ----
  linesSection(title, ops, lineRenderer) {
    if (!ops || ops.length === 0) return '';
    const body = ops.map(lineRenderer).join('');
    return `<section class="sec"><h3 class="sec-title">${this.esc(title)}</h3><ul class="lines">${body}</ul></section>`;
  }

  cls(type) {
    return type === 'add' ? 'd-add' : type === 'remove' ? 'd-rem' : 'd-ctx';
  }

  ingredientLine(op) {
    const it = op.item;
    if (it.kind === 'section') {
      // A new/removed section shows its header marked too (explicit new section).
      return `<li class="sub-head ${this.cls(op.type)}">${this.esc(it.title)}</li>`;
    }
    const ing = it.ingredient || {};
    const amount = formatIngredientAmount(ing.amount);
    const unit = (ing.unit ?? '').toString().trim();
    // Row stays RTL (right-aligned, like the rest of the section); only the
    // amount · unit · item triplet reads LTR inside its own group.
    return `<li class="line ing ${this.cls(op.type)}"><span class="ing-fields"><span class="amt">${this.esc(amount)}</span><span class="unit">${this.esc(unit)}</span><span class="nm">${this.esc(ing.item || it.text)}</span></span></li>`;
  }

  instructionLine(op) {
    const it = op.item;
    if (it.kind === 'stage') {
      // A new/removed stage shows its header marked too (explicit new stage).
      return `<li class="sub-head ${this.cls(op.type)}">${this.esc(it.title)}</li>`;
    }
    return `<li class="line ${this.cls(op.type)}">${this.esc(it.text)}</li>`;
  }

  commentLine(op) {
    return `<li class="line ${this.cls(op.type)}">${this.esc(op.item.text)}</li>`;
  }

  // ---- images ----
  imagesSectionShell(images) {
    if (!images.added.length && !images.removed.length && !images.kept.length) return '';
    const note = images.primaryChanged ? '<span class="note">התמונה הראשית עודכנה</span>' : '';
    return `<section class="sec"><h3 class="sec-title">תמונות ${note}</h3><div class="thumbs" id="img-thumbs"></div></section>`;
  }

  async fillImages(images) {
    const host = this.shadowRoot.getElementById('img-thumbs');
    if (!host) return;
    const groups = [
      ...images.removed.map((img) => ({ img, kind: 'removed' })),
      ...images.kept.map((img) => ({ img, kind: 'kept' })),
      ...images.added.map((img) => ({ img, kind: 'added' })),
    ];
    const html = await Promise.all(
      groups.map(async ({ img, kind }) => {
        let url = '';
        if (img.preview) url = img.preview;
        else {
          try {
            url = await RecipeImageService.getOptimizedUrl(img, '400x400');
          } catch {
            url = ''; // silent: best-effort thumbnail
          }
        }
        const badge =
          kind === 'added'
            ? '<span class="badge add">נוסף</span>'
            : kind === 'removed'
              ? '<span class="badge rem">הוסר</span>'
              : '';
        const star = img.isPrimary ? '<span class="badge primary">ראשי</span>' : '';
        return `<div class="thumb ${kind}"><img src="${this.esc(url)}" alt="" loading="lazy">${badge}${star}</div>`;
      }),
    );
    host.innerHTML = html.join('');
  }

  // ---- media instructions ----
  mediaSectionShell(media) {
    if (!media.added.length && !media.removed.length && !(media.captionChanged?.length || 0)) {
      return '';
    }
    return `<section class="sec"><h3 class="sec-title">מדיה (הוראות מצולמות)</h3><div class="thumbs" id="media-thumbs"></div></section>`;
  }

  async fillMedia(media) {
    const host = this.shadowRoot.getElementById('media-thumbs');
    if (!host) return;
    const groups = [
      ...media.removed.map((m) => ({ m, kind: 'removed' })),
      ...media.added.map((m) => ({ m, kind: 'added' })),
      ...(media.captionChanged || []).map((c) => ({
        m: c.item,
        kind: 'changed',
        captionBefore: c.before,
        captionAfter: c.after,
      })),
    ];
    const html = await Promise.all(
      groups.map(async ({ m, kind, captionBefore, captionAfter }) => {
        let url = '';
        try {
          url = await MediaInstructionService.getUrl(m.path);
        } catch {
          url = ''; // silent: best-effort thumbnail
        }
        const el =
          m.type === 'video'
            ? `<video src="${this.esc(url)}" muted playsinline controls></video>`
            : `<img src="${this.esc(url)}" alt="" loading="lazy">`;
        const badge =
          kind === 'added'
            ? '<span class="badge add">נוסף</span>'
            : kind === 'removed'
              ? '<span class="badge rem">הוסר</span>'
              : '<span class="badge changed">כיתוב עודכן</span>';
        const cap =
          kind === 'changed'
            ? `<div class="cap cap-diff"><span class="before">${this.esc(captionBefore) || '—'}</span><span class="arrow">←</span><span class="after">${this.esc(captionAfter) || '—'}</span></div>`
            : m.caption
              ? `<div class="cap">${this.esc(m.caption)}</div>`
              : '';
        return `<div class="thumb ${kind}">${el}${badge}${cap}</div>`;
      }),
    );
    host.innerHTML = html.join('');
  }

  // ---- related recipes ----
  relatedSectionShell(related) {
    if (!related.added.length && !related.removed.length) return '';
    return `<section class="sec"><h3 class="sec-title">מתכונים קשורים</h3><div class="related" id="related-cards"></div></section>`;
  }

  fillRelated(related) {
    const host = this.shadowRoot.getElementById('related-cards');
    if (!host) return;
    const make = (id, kind) => {
      const wrap = document.createElement('div');
      wrap.className = `rel ${kind}`;
      const badge = document.createElement('span');
      badge.className = `badge ${kind === 'added' ? 'add' : 'rem'}`;
      badge.textContent = kind === 'added' ? 'נוסף' : 'הוסר';
      const card = document.createElement('recipe-card');
      card.setAttribute('recipe-id', id);
      card.setAttribute('card-width', '150px');
      // Don't set show-favorites / show-add-to-meal at all — recipe-card shows
      // those controls when the attribute is PRESENT (any value). Omitting them
      // hides the heart and + in this read-only diff.
      wrap.appendChild(badge);
      wrap.appendChild(card);
      return wrap;
    };
    related.removed.forEach((id) => host.appendChild(make(id, 'removed')));
    related.added.forEach((id) => host.appendChild(make(id, 'added')));
  }

  styles() {
    return `
      .diff { font-family: var(--font-ui-he, sans-serif); display:flex; flex-direction:column; gap:18px; color: var(--ink, #1f1d18); }
      .empty { text-align:center; color: var(--ink-3, rgba(31,29,24,0.55)); font-style:italic; padding:24px 0; }
      .sec-title { font-family: var(--font-display, serif); font-size:18px; margin:0 0 10px; color: var(--ink, #1f1d18); display:flex; align-items:center; gap:8px; }
      .note { font-size:12px; font-style:italic; color: var(--ink-3, rgba(31,29,24,0.55)); font-family: var(--font-ui-he, sans-serif); }

      /* metadata */
      .meta-grid { display:flex; flex-direction:column; gap:2px; border:1px solid var(--hairline, rgba(31,29,24,0.12)); border-radius: var(--r-lg,14px); overflow:hidden; }
      .meta-row { display:flex; gap:12px; align-items:baseline; padding:8px 14px; }
      .meta-row + .meta-row { border-top:1px solid var(--hairline, rgba(31,29,24,0.07)); }
      .meta-row.changed { background: rgba(106,153,78,0.06); }
      .meta-label { flex-shrink:0; width:110px; font-size:12px; font-weight:600; color: var(--ink-3, rgba(31,29,24,0.55)); }
      .meta-val { flex:1; display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; font-size:14.5px; }
      .before { color: var(--secondary-dark,#bc4749); text-decoration:line-through; opacity:0.8; }
      .arrow { color: var(--ink-4, rgba(31,29,24,0.35)); }
      .after { color: var(--primary-dark,#386641); font-weight:500; }

      /* lines (ingredients / instructions / comments) */
      .lines { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:2px; }
      .sub-head { font-family: var(--font-display, serif); font-size:14px; font-weight:600; color: var(--ink-2, rgba(31,29,24,0.75)); margin:8px 0 2px; }
      .line { font-size:14.5px; padding:4px 10px; border-radius: var(--r-xs,6px); display:flex; gap:10px; align-items:baseline; }
      /* triplet reads LTR (amount · unit · item) while the row stays RTL */
      .ing-fields { display:inline-flex; direction:ltr; gap:6px; align-items:baseline; flex-wrap:wrap; }
      .ing .amt { color: var(--ink-3, rgba(31,29,24,0.6)); }
      .ing .unit { color: var(--ink-3, rgba(31,29,24,0.6)); }
      .d-ctx { color: var(--ink, #1f1d18); }
      .d-add { background: rgba(106,153,78,0.14); color: var(--primary-dark,#386641); }
      .d-rem { background: rgba(188,71,73,0.12); color: var(--secondary-dark,#bc4749); text-decoration:line-through; opacity:0.85; }

      /* thumbnails (images + media) */
      .thumbs { display:flex; gap:10px; flex-wrap:wrap; }
      .thumb { position:relative; }
      .thumb img, .thumb video { width:120px; height:90px; object-fit:cover; border-radius: var(--r-sm,10px); display:block; border:2px solid var(--hairline, rgba(31,29,24,0.12)); background: var(--surface-2,#f0ede6); }
      .thumb.added img, .thumb.added video { border-color: var(--primary,#6a994e); }
      .thumb.removed img, .thumb.removed video { border-color: var(--secondary-dark,#bc4749); opacity:0.85; }
      .thumb.changed img, .thumb.changed video { border-color: var(--hairline-strong, rgba(31,29,24,0.25)); }
      .badge { position:absolute; top:5px; inset-inline-start:5px; font-size:10px; font-weight:600; padding:1px 7px; border-radius: var(--r-pill,999px); color:#fff; }
      .badge.add { background: var(--primary,#6a994e); }
      .badge.rem { background: var(--secondary-dark,#bc4749); }
      .badge.changed { background: var(--ink-3, rgba(31,29,24,0.55)); }
      .badge.primary { inset-inline-start:auto; inset-inline-end:5px; background: var(--ink, #1f1d18); opacity:0.75; }
      .cap { font-size:11px; color: var(--ink-3, rgba(31,29,24,0.55)); margin-top:3px; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .cap-diff { display:flex; gap:4px; flex-wrap:wrap; align-items:baseline; white-space:normal; overflow:visible; max-width:128px; }

      /* related */
      .related { display:flex; gap:12px; flex-wrap:wrap; }
      .rel { position:relative; }
      .rel .badge { z-index: 1; }
    `;
  }
}

customElements.define('suggestion-diff-view', SuggestionDiffView);
