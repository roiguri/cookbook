/**
 * Regression tests for the YouTube extractor and the shared video-extraction
 * core it delegates to. The Gemini SDK and the secret param are mocked so no
 * network or real credential is needed — these lock the behavior that Part 2
 * (Instagram) will reuse.
 *
 * Written as CommonJS (.cjs) because the code under test is CommonJS Cloud
 * Functions code; classic `jest.mock` intercepts its `require()` chain and
 * avoids loading the ESM-only `@google/genai` SDK at all.
 */

const mockGenerateContent = jest.fn();

// `virtual` because these packages live in functions/node_modules and aren't
// resolvable from the test's location — we never load the real modules anyway.
jest.mock(
  '@google/genai',
  () => ({
    GoogleGenAI: class {
      constructor() {
        this.models = { generateContent: mockGenerateContent };
      }
    },
  }),
  { virtual: true },
);

jest.mock(
  'firebase-functions/params',
  () => ({
    defineSecret: () => ({ value: () => 'test-key' }),
  }),
  { virtual: true },
);

const {
  extractRecipeFromVideo,
  parseYouTubeUrl,
} = require('../../../functions/utils/gemini/extractors/youtube');

const VALID_RECIPE = {
  name: 'עוגת שוקולד',
  ingredients: [{ item: 'קמח', amount: 2, unit: 'כוסות' }],
  instructions: ['ערבבו את החומרים', 'אפו 30 דקות'],
};

beforeEach(() => {
  // The validation-failure paths log via console.error; keep test output clean.
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('parseYouTubeUrl', () => {
  it('normalizes watch / youtu.be / shorts URLs to a canonical watch URL', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=abcdefghijk').normalizedUrl).toBe(
      'https://www.youtube.com/watch?v=abcdefghijk',
    );
    expect(parseYouTubeUrl('https://youtu.be/abcdefghijk').videoId).toBe('abcdefghijk');
    expect(parseYouTubeUrl('https://www.youtube.com/shorts/abcdefghijk').videoId).toBe(
      'abcdefghijk',
    );
  });

  it('rejects non-YouTube and malformed input', () => {
    expect(parseYouTubeUrl('https://example.com/watch?v=abcdefghijk')).toBeNull();
    expect(parseYouTubeUrl('not a url')).toBeNull();
    expect(parseYouTubeUrl(null)).toBeNull();
  });
});

describe('extractRecipeFromVideo', () => {
  it('sends the normalized URL as a fileData part and returns validated data', async () => {
    mockGenerateContent.mockResolvedValue({ text: JSON.stringify(VALID_RECIPE) });

    const result = await extractRecipeFromVideo('https://youtu.be/abcdefghijk');

    expect(result).toEqual(VALID_RECIPE);
    const call = mockGenerateContent.mock.calls[0][0];
    expect(call.model).toBe('gemini-2.5-flash');
    const parts = call.contents[0].parts;
    expect(parts[0]).toEqual({
      fileData: { fileUri: 'https://www.youtube.com/watch?v=abcdefghijk', mimeType: 'video/mp4' },
    });
    expect(parts[1].text).toContain('Extract the complete recipe');
    expect(call.config.responseMimeType).toBe('application/json');
  });

  it('throws on an invalid URL without calling Gemini', async () => {
    await expect(extractRecipeFromVideo('https://example.com')).rejects.toThrow(
      'not a valid YouTube URL',
    );
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('throws when the model returns an empty response', async () => {
    mockGenerateContent.mockResolvedValue({ text: '' });
    await expect(extractRecipeFromVideo('https://youtu.be/abcdefghijk')).rejects.toThrow(
      'Could not extract',
    );
  });

  it('throws when the model returns data without a recognizable recipe', async () => {
    mockGenerateContent.mockResolvedValue({ text: JSON.stringify({ name: null }) });
    await expect(extractRecipeFromVideo('https://youtu.be/abcdefghijk')).rejects.toThrow(
      'Could not extract',
    );
  });
});
