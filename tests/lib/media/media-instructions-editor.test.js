import { jest } from '@jest/globals';

const mediaServiceMock = {
  getUrl: jest.fn(async (path) => `https://cdn/${path}`),
  delete: jest.fn(async () => {}),
  deleteMany: jest.fn(async () => {}),
};
jest.unstable_mockModule('src/js/services/recipes/media-instruction-service.js', () => ({
  MediaInstructionService: mediaServiceMock,
}));

beforeAll(async () => {
  await import('src/lib/media/media-instructions-editor/media-instructions-editor.js');
});

function mount() {
  const el = document.createElement('media-instructions-editor');
  document.body.appendChild(el);
  return el;
}

describe('media-instructions-editor — unified contract', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('setValue populates from { mediaData, recipeId } and getValue returns { all, pending }', () => {
    const el = mount();
    el.setValue({
      mediaData: [{ path: 'p1', caption: 'c1', type: 'image', order: 0 }],
      recipeId: 'r1',
    });
    const value = el.getValue();
    expect(value.all).toHaveLength(1);
    expect(value.all[0].path).toBe('p1');
    expect(value.pending).toEqual([]);
    expect(el.recipeId).toBe('r1');
  });

  test('setValue marks pristine', () => {
    const el = mount();
    el.setValue({ mediaData: [{ path: 'p1', type: 'image' }], recipeId: 'r1' });
    expect(el.isDirty()).toBe(false);
  });

  test('changing a caption makes it dirty and emits value-changed (not media-changed)', () => {
    const el = mount();
    el.setValue({ mediaData: [{ path: 'p1', caption: '', type: 'image' }], recipeId: 'r1' });
    const valueHandler = jest.fn();
    const legacy = jest.fn();
    el.addEventListener('value-changed', valueHandler);
    el.addEventListener('media-changed', legacy);

    el.handleCaptionChange(0, 'new caption');

    expect(valueHandler).toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
    expect(el.isDirty()).toBe(true);
  });

  test('clear() empties media and is pristine', () => {
    const el = mount();
    el.setValue({ mediaData: [{ path: 'p1', type: 'image' }], recipeId: 'r1' });
    el.clear();
    expect(el.getValue().all).toEqual([]);
    expect(el.isDirty()).toBe(false);
  });

  test('deleting an uploaded item is deferred: queues its path, does not delete from storage', async () => {
    global.confirm = () => true;
    const el = mount();
    el.setValue({
      mediaData: [{ id: 'm1', path: 'recipes/r1/media/m1', caption: 'c', type: 'image', order: 0 }],
      recipeId: 'r1',
    });
    expect(el.getValue().all).toHaveLength(1);

    await el.handleDelete(0);

    expect(el.getValue().all).toHaveLength(0);
    expect(el.getValue().removed).toEqual(['recipes/r1/media/m1']);
    expect(mediaServiceMock.delete).not.toHaveBeenCalled();
    expect(mediaServiceMock.deleteMany).not.toHaveBeenCalled();
    expect(el.isDirty()).toBe(true);
  });

  test('setValue (form reset) clears queued deletions', async () => {
    global.confirm = () => true;
    const el = mount();
    el.setValue({
      mediaData: [{ id: 'm1', path: 'recipes/r1/media/m1', type: 'image', order: 0 }],
      recipeId: 'r1',
    });
    await el.handleDelete(0);
    expect(el.getValue().removed).toHaveLength(1);
    // reset to original
    el.setValue({
      mediaData: [{ id: 'm1', path: 'recipes/r1/media/m1', type: 'image', order: 0 }],
      recipeId: 'r1',
    });
    expect(el.getValue().removed).toEqual([]);
    expect(el.getValue().all).toHaveLength(1);
  });

  test('setDisabled disables the upload zone and persists across re-render', async () => {
    const el = mount();
    el.setValue({ mediaData: [{ path: 'p1', caption: 'c', type: 'image' }], recipeId: 'r1' });
    el.setDisabled(true);
    const uploadZone = el.shadowRoot.querySelector('upload-zone');
    expect(uploadZone.hasAttribute('disabled')).toBe(true);
    await el.renderMediaList();
    expect(uploadZone.hasAttribute('disabled')).toBe(true);
    el.shadowRoot.querySelectorAll('.caption-input').forEach((i) => expect(i.disabled).toBe(true));
  });
});
