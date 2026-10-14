import { jest } from '@jest/globals';
import { shareOrCopy } from 'src/js/utils/share.js';

describe('shareOrCopy', () => {
  const data = { title: 'חלה', url: 'https://example.test/recipe/abc' };
  let writeText;

  beforeEach(() => {
    writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  afterEach(() => {
    delete navigator.share;
  });

  it('uses the share sheet when there is one', async () => {
    navigator.share = jest.fn().mockResolvedValue(undefined);
    await expect(shareOrCopy(data, data.url)).resolves.toBe('shared');
    expect(navigator.share).toHaveBeenCalledWith(data);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('reports a closed share sheet without copying', async () => {
    navigator.share = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error(), { name: 'AbortError' }));
    await expect(shareOrCopy(data, data.url)).resolves.toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies when the share sheet refuses', async () => {
    navigator.share = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error(), { name: 'NotAllowedError' }));
    await expect(shareOrCopy(data, data.url)).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith(data.url);
  });

  it('copies when there is no share sheet', async () => {
    await expect(shareOrCopy(data, 'the text')).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith('the text');
  });

  it('throws when copying fails too', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    await expect(shareOrCopy(data, data.url)).rejects.toThrow('denied');
  });
});
