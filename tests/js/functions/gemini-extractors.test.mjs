/** @jest-environment node */
import { jest } from '@jest/globals';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const client = require('../../../functions/utils/gemini/client.js');
const { requireRecipeText } = client;

let generateContentMock = jest.fn();

// Stub createClient on the cached exports object before loading extractors so
// their destructured `createClient` uses the mock while `requireRecipeText` stays real.
client.createClient = () => ({
  models: {
    generateContent: (...args) => generateContentMock(...args),
  },
});

const { extractRecipeFromUrl } = require('../../../functions/utils/gemini/extractors/url.js');
const { extractRecipeFromImage } = require('../../../functions/utils/gemini/extractors/image.js');
const { extractRecipeFromVideo } = require('../../../functions/utils/gemini/extractors/youtube.js');

const VALID_RECIPE = {
  name: 'שקשוקה',
  category: 'breakfast-brunch',
  ingredients: [{ item: 'ביצים', amount: 4, unit: null }],
  instructions: ['לבשל עגבניות ולהוסיף ביצים'],
};

describe('Gemini recipe extraction — empty response handling', () => {
  let warnSpy;
  let errorSpy;
  let logSpy;

  beforeEach(() => {
    generateContentMock = jest.fn();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  describe('requireRecipeText', () => {
    it('returns response.text when present', () => {
      expect(requireRecipeText({ text: '{"name":"פנקייק"}' }, 'url')).toBe('{"name":"פנקייק"}');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('throws with finishReason and logs details when text is undefined', () => {
      const response = {
        candidates: [{ finishReason: 'RECITATION', finishMessage: 'Recited source text' }],
      };

      expect(() => requireRecipeText(response, 'url')).toThrow(
        'Could not extract valid recipe data - Gemini returned no text (RECITATION)',
      );
      expect(warnSpy).toHaveBeenCalledWith(
        '[gemini] url: empty response',
        JSON.stringify({
          finishReason: 'RECITATION',
          finishMessage: 'Recited source text',
        }),
      );
    });

    it('prefers blockReason over finishReason when prompt is blocked', () => {
      const response = {
        candidates: [{ finishReason: 'OTHER' }],
        promptFeedback: { blockReason: 'SAFETY', blockReasonMessage: 'Blocked by safety filter' },
      };

      expect(() => requireRecipeText(response, 'url')).toThrow(
        'Could not extract valid recipe data - Gemini returned no text (SAFETY)',
      );
      expect(warnSpy).toHaveBeenCalledWith(
        '[gemini] url: empty response',
        JSON.stringify({
          finishReason: 'OTHER',
          blockReason: 'SAFETY',
          blockReasonMessage: 'Blocked by safety filter',
        }),
      );
    });

    it('falls back to unknown when no reason metadata is present', () => {
      expect(() => requireRecipeText({}, 'image')).toThrow(
        'Could not extract valid recipe data - Gemini returned no text (unknown)',
      );
      expect(() => requireRecipeText(null, 'video')).toThrow(
        'Could not extract valid recipe data - Gemini returned no text (unknown)',
      );
    });
  });

  describe('extractRecipeFromUrl', () => {
    it('parses a valid fenced JSON response', async () => {
      generateContentMock.mockResolvedValue({
        text: `\`\`\`json\n${JSON.stringify(VALID_RECIPE)}\n\`\`\``,
      });

      await expect(extractRecipeFromUrl('https://example.com/shakshuka')).resolves.toEqual(
        VALID_RECIPE,
      );
    });

    it('throws a descriptive error instead of TypeError when Gemini returns no text', async () => {
      generateContentMock.mockResolvedValue({
        text: undefined,
        candidates: [{ finishReason: 'RECITATION' }],
      });

      await expect(extractRecipeFromUrl('https://example.com/shakshuka')).rejects.toThrow(
        'Could not extract valid recipe data - Gemini returned no text (RECITATION)',
      );
      expect(warnSpy).toHaveBeenCalledWith(
        '[gemini] url: empty response',
        JSON.stringify({ finishReason: 'RECITATION' }),
      );
    });

    it('throws a descriptive error when prompt is blocked by safety', async () => {
      generateContentMock.mockResolvedValue({
        promptFeedback: { blockReason: 'SAFETY' },
      });

      await expect(extractRecipeFromUrl('https://example.com/blocked')).rejects.toThrow(
        'Could not extract valid recipe data - Gemini returned no text (SAFETY)',
      );
    });

    it('logs the reason and throws cleanly when the cleanup call returns no text', async () => {
      generateContentMock
        .mockResolvedValueOnce({ text: 'not json at all' })
        .mockResolvedValueOnce({ text: undefined, candidates: [{ finishReason: 'MAX_TOKENS' }] });

      await expect(extractRecipeFromUrl('https://example.com/messy')).rejects.toThrow(
        'Could not extract valid recipe data - response was not valid JSON',
      );
      expect(warnSpy).toHaveBeenCalledWith(
        '[gemini] url cleanup: empty response',
        JSON.stringify({ finishReason: 'MAX_TOKENS' }),
      );
    });
  });

  describe('extractRecipeFromImage', () => {
    it('parses a valid JSON response', async () => {
      generateContentMock.mockResolvedValue({ text: JSON.stringify(VALID_RECIPE) });

      await expect(
        extractRecipeFromImage([{ base64: 'AAAA', mimeType: 'image/png' }]),
      ).resolves.toEqual(VALID_RECIPE);
    });

    it('throws with the stop reason when Gemini returns no text', async () => {
      generateContentMock.mockResolvedValue({
        text: undefined,
        candidates: [{ finishReason: 'MAX_TOKENS' }],
      });

      await expect(
        extractRecipeFromImage([{ base64: 'AAAA', mimeType: 'image/png' }]),
      ).rejects.toThrow(
        'Could not extract valid recipe data - Gemini returned no text (MAX_TOKENS)',
      );
      expect(warnSpy).toHaveBeenCalledWith(
        '[gemini] image: empty response',
        JSON.stringify({ finishReason: 'MAX_TOKENS' }),
      );
    });
  });

  describe('extractRecipeFromVideo', () => {
    it('parses a valid JSON response for a YouTube URL', async () => {
      generateContentMock.mockResolvedValue({ text: JSON.stringify(VALID_RECIPE) });

      await expect(
        extractRecipeFromVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
      ).resolves.toEqual(VALID_RECIPE);
    });

    it('throws with the stop reason when Gemini returns no text', async () => {
      generateContentMock.mockResolvedValue({
        text: '',
        promptFeedback: { blockReason: 'SAFETY' },
      });

      await expect(
        extractRecipeFromVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
      ).rejects.toThrow('Could not extract valid recipe data - Gemini returned no text (SAFETY)');
      expect(warnSpy).toHaveBeenCalledWith(
        '[gemini] video: empty response',
        JSON.stringify({ blockReason: 'SAFETY' }),
      );
    });
  });
});
