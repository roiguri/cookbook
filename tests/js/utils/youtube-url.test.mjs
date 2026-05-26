import { parseYouTubeUrl } from '../../../src/js/utils/youtube-url.js';

describe('parseYouTubeUrl', () => {
  describe('valid URLs', () => {
    test('accepts a standard watch URL', () => {
      const result = parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(result).toEqual({
        videoId: 'dQw4w9WgXcQ',
        normalizedUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      });
    });

    test('accepts a watch URL without www', () => {
      const result = parseYouTubeUrl('https://youtube.com/watch?v=dQw4w9WgXcQ');
      expect(result?.videoId).toBe('dQw4w9WgXcQ');
    });

    test('accepts a mobile (m.youtube.com) URL', () => {
      const result = parseYouTubeUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(result?.videoId).toBe('dQw4w9WgXcQ');
    });

    test('accepts a music.youtube.com URL', () => {
      const result = parseYouTubeUrl('https://music.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(result?.videoId).toBe('dQw4w9WgXcQ');
    });

    test('accepts a youtu.be short URL', () => {
      const result = parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ');
      expect(result?.videoId).toBe('dQw4w9WgXcQ');
    });

    test('accepts a Shorts URL', () => {
      const result = parseYouTubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ');
      expect(result?.videoId).toBe('dQw4w9WgXcQ');
    });

    test('accepts an embed URL', () => {
      const result = parseYouTubeUrl('https://www.youtube.com/embed/dQw4w9WgXcQ');
      expect(result?.videoId).toBe('dQw4w9WgXcQ');
    });

    test('preserves the video ID when the URL has a timestamp', () => {
      const result = parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s');
      expect(result?.videoId).toBe('dQw4w9WgXcQ');
    });

    test('preserves the video ID when youtu.be has a share/timestamp param', () => {
      const result = parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?si=abc123&t=42');
      expect(result?.videoId).toBe('dQw4w9WgXcQ');
    });

    test('trims surrounding whitespace before parsing', () => {
      const result = parseYouTubeUrl('  https://www.youtube.com/watch?v=dQw4w9WgXcQ  ');
      expect(result?.videoId).toBe('dQw4w9WgXcQ');
    });

    test('produces a canonical normalized URL regardless of the input form', () => {
      const fromShorts = parseYouTubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ');
      const fromShort = parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ');
      const fromEmbed = parseYouTubeUrl('https://www.youtube.com/embed/dQw4w9WgXcQ');
      expect(fromShorts?.normalizedUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(fromShort?.normalizedUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(fromEmbed?.normalizedUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    });
  });

  describe('invalid URLs', () => {
    test('rejects vimeo', () => {
      expect(parseYouTubeUrl('https://vimeo.com/123456789')).toBeNull();
    });

    test('rejects raw non-URL text', () => {
      expect(parseYouTubeUrl('not a url')).toBeNull();
    });

    test('rejects an empty string', () => {
      expect(parseYouTubeUrl('')).toBeNull();
    });

    test('rejects null and undefined', () => {
      expect(parseYouTubeUrl(null)).toBeNull();
      expect(parseYouTubeUrl(undefined)).toBeNull();
    });

    test('rejects non-string inputs', () => {
      expect(parseYouTubeUrl(123)).toBeNull();
      expect(parseYouTubeUrl({})).toBeNull();
    });

    test('rejects a YouTube channel page', () => {
      expect(parseYouTubeUrl('https://www.youtube.com/@SomeChannel')).toBeNull();
    });

    test('rejects a YouTube watch URL without a v param', () => {
      expect(parseYouTubeUrl('https://www.youtube.com/watch')).toBeNull();
    });

    test('rejects a video ID that is not 11 characters', () => {
      expect(parseYouTubeUrl('https://www.youtube.com/watch?v=tooShort')).toBeNull();
      expect(parseYouTubeUrl('https://youtu.be/tooShort')).toBeNull();
    });

    test('rejects a video ID with illegal characters', () => {
      // 11 chars but contains "!" — outside [A-Za-z0-9_-]
      expect(parseYouTubeUrl('https://youtu.be/abcd!fghijk')).toBeNull();
    });
  });
});
