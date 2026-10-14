import { jest } from '@jest/globals';
import { DEFAULT_AVATAR_CONFIG, AVATAR_PARTS } from 'src/js/utils/avatar/chef-avatar.js';
import 'src/lib/auth/avatar-builder/avatar-builder.js';

const SAVED = {
  ...DEFAULT_AVATAR_CONFIG,
  parts: { ...DEFAULT_AVATAR_CONFIG.parts, hair: 'curly', hat: 'bandana' },
  colors: { ...DEFAULT_AVATAR_CONFIG.colors, skin: 'dark' },
};

function mount(config) {
  const el = document.createElement('avatar-builder');
  if (config !== undefined) el.config = config;
  document.body.appendChild(el);
  const $ = (sel) => el.shadowRoot.querySelector(sel);
  const $$ = (sel) => [...el.shadowRoot.querySelectorAll(sel)];
  return { el, $, $$ };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('<avatar-builder>', () => {
  it('starts from the default chef when there is no saved config', () => {
    const { el, $ } = mount(null);
    expect(el.config).toEqual(DEFAULT_AVATAR_CONFIG);
    expect($('#preview svg')).not.toBeNull();
    // Nothing built yet: Save is available, undo has nothing to undo to beyond the default.
    expect($('#save-btn').disabled).toBe(false);
  });

  it('shows a skin tab, one tab per part, and the background tab', () => {
    const { $$ } = mount(null);
    expect($$('.tab').map((t) => t.dataset.tab)).toEqual([
      'skin',
      ...Object.keys(AVATAR_PARTS),
      'background',
    ]);
  });

  it('shows the options of the selected tab with the current one checked', () => {
    const { $, $$ } = mount(SAVED);
    $('.tab[data-tab="hair"]').click();
    const opts = $$('.opt');
    expect(opts.map((o) => o.dataset.option)).toEqual(AVATAR_PARTS.hair.options.map((o) => o.id));
    expect(opts.find((o) => o.getAttribute('aria-checked') === 'true').dataset.option).toBe(
      'curly',
    );
    // Hair palette under the options
    expect($$('.swatch').every((s) => s.dataset.palette === 'hair')).toBe(true);
  });

  it('explains that the hat hides the hair, and drops the hat from hair thumbnails', () => {
    const { $, $$ } = mount(SAVED);
    $('.tab[data-tab="hair"]').click();
    expect($('#hint').hidden).toBe(false);
    expect($$('.opt')[0].innerHTML).not.toContain('fill-opacity=".9"'); // bandana dots
  });

  it('picking an option or a colour updates the config and the preview', () => {
    const { el, $ } = mount(SAVED);
    const before = $('#preview').innerHTML;
    $('.tab[data-tab="glasses"]').click();
    $('.opt[data-option="round"]').click();
    expect(el.config.parts.glasses).toBe('round');
    $('.tab[data-tab="skin"]').click();
    $('.swatch[data-color="tan"]').click();
    expect(el.config.colors.skin).toBe('tan');
    expect($('#preview').innerHTML).not.toBe(before);
  });

  it('background tab shows only the background palette', () => {
    const { $, $$ } = mount(SAVED);
    $('.tab[data-tab="background"]').click();
    expect($('#options').hidden).toBe(true);
    expect($$('.swatch').map((s) => s.dataset.color)).toContain('none');
  });

  it('while the built avatar is in use, Save and Undo wait for a change', () => {
    const { el, $ } = mount(SAVED);
    el.active = true;
    expect($('#save-btn').disabled).toBe(true);
    expect($('#undo-btn').disabled).toBe(true);
    expect($('#status').textContent).toContain('זה האווטאר שלך כרגע');

    $('.tab[data-tab="mouth"]').click();
    $('.opt[data-option="tongue"]').click();
    expect($('#save-btn').disabled).toBe(false);
    expect($('#status').textContent).toBe('');

    $('#undo-btn').click();
    expect(el.config).toEqual(SAVED);
    expect($('#save-btn').disabled).toBe(true);
  });

  it('when a stock avatar is in use, Save can re-apply the built one unchanged', () => {
    const { el, $ } = mount(SAVED);
    el.active = false;
    expect($('#save-btn').disabled).toBe(false);
  });

  it('Save fires avatar-builder-save with the config and locks until the parent answers', () => {
    const { el, $ } = mount(SAVED);
    const onSave = jest.fn();
    document.addEventListener('avatar-builder-save', onSave);
    $('.tab[data-tab="eyes"]').click();
    $('.opt[data-option="wink"]').click();
    $('#save-btn').click();
    $('#save-btn').click(); // ignored while busy
    document.removeEventListener('avatar-builder-save', onSave);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].detail.config.parts.eyes).toBe('wink');
    expect($('#save-btn').disabled).toBe(true);
    expect($('#random-btn').disabled).toBe(true);

    el.markSaved(onSave.mock.calls[0][0].detail.config);
    expect(el.active).toBe(true);
    expect($('#save-btn').disabled).toBe(true);
    expect($('#random-btn').disabled).toBe(false);
    expect($('#status').textContent).toContain('זה האווטאר שלך כרגע');
  });

  it('a failed save unlocks the builder and keeps the edits', () => {
    const { el, $ } = mount(SAVED);
    el.active = true;
    $('.tab[data-tab="eyes"]').click();
    $('.opt[data-option="wink"]').click();
    $('#save-btn').click();
    el.setBusy(false);
    expect($('#save-btn').disabled).toBe(false);
    expect(el.config.parts.eyes).toBe('wink');
  });

  it('"surprise me" replaces the avatar with a random valid one', () => {
    const { el, $ } = mount(SAVED);
    const random = jest.spyOn(Math, 'random').mockReturnValue(0.99);
    $('#random-btn').click();
    random.mockRestore();
    expect(el.config.parts.hair).toBe(AVATAR_PARTS.hair.options.at(-1).id);
  });

  it('arrow keys move between tabs', () => {
    const { $ } = mount(SAVED);
    $('.tab[data-tab="skin"]').focus();
    $('#tabs').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect($('.tab[aria-selected="true"]').dataset.tab).toBe('hair');
    $('#tabs').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    $('#tabs').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect($('.tab[aria-selected="true"]').dataset.tab).toBe('background');
  });
});
