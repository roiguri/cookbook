import { jest } from '@jest/globals';
import 'src/lib/media/image-handler/image-handler.js';

function mount() {
  const el = document.createElement('image-handler');
  document.body.appendChild(el);
  return el;
}

const IMAGES = {
  images: [
    { id: 'a', preview: 'data:img-a', isPrimary: true },
    { id: 'b', preview: 'data:img-b', isPrimary: false },
  ],
  removed: [],
};

describe('image-handler — unified contract', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('getValue returns { images, removed }', () => {
    const el = mount();
    el.setValue(IMAGES);
    const value = el.getValue();
    expect(value.images.map((i) => i.id)).toEqual(['a', 'b']);
    expect(value.removed).toEqual([]);
  });

  test('setValue marks pristine (not dirty)', () => {
    const el = mount();
    el.setValue(IMAGES);
    expect(el.isDirty()).toBe(false);
  });

  test('removing an image makes the handler dirty and fires value-changed', () => {
    const el = mount();
    el.setValue(IMAGES);
    const valueHandler = jest.fn();
    el.addEventListener('value-changed', valueHandler);

    el.removeImage('b');

    expect(el.isDirty()).toBe(true);
    expect(valueHandler).toHaveBeenCalled();
    expect(valueHandler.mock.calls.at(-1)[0].detail.action).toBe('images-changed');
  });

  test('setPrimaryImage fires value-changed with the primary action', () => {
    const el = mount();
    el.setValue(IMAGES);
    const handler = jest.fn();
    el.addEventListener('value-changed', handler);
    el.setPrimaryImage('b');
    expect(handler.mock.calls.at(-1)[0].detail.action).toBe('primary-image-changed');
    expect(el.isDirty()).toBe(true);
  });

  test('the five legacy events are no longer dispatched', () => {
    const el = mount();
    el.setValue(IMAGES);
    const legacy = jest.fn();
    [
      'file-added',
      'images-changed',
      'images-reordered',
      'primary-image-changed',
      'images-cleared',
    ].forEach((name) => el.addEventListener(name, legacy));
    el.removeImage('b');
    el.setPrimaryImage('a');
    el.clearImages();
    expect(legacy).not.toHaveBeenCalled();
  });

  test('clear() empties images and is pristine', () => {
    const el = mount();
    el.setValue(IMAGES);
    el.clear();
    expect(el.getValue().images).toEqual([]);
    expect(el.isDirty()).toBe(false);
  });

  test('setDisabled persists across re-render (updatePreviewContainer)', () => {
    const el = mount();
    el.setValue(IMAGES);
    el.setDisabled(true);
    const uploadZone = el.shadowRoot.querySelector('upload-zone');
    expect(uploadZone.hasAttribute('disabled')).toBe(true);
    // A re-render must not silently re-enable.
    el.updatePreviewContainer();
    expect(uploadZone.hasAttribute('disabled')).toBe(true);
  });

  test('dirty signature ignores preview/file payload size', () => {
    const el = mount();
    el.setValue(IMAGES);
    // mutate a preview string only — should NOT be considered dirty
    el.images[0].preview = 'data:changed';
    expect(el.isDirty()).toBe(false);
  });
});
