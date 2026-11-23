import { createHash } from 'node:crypto';
import * as core from '@cookbook/core';
import {
  PUSH_PLATFORMS,
  isValidPushPlatform,
  deviceIdForToken,
  buildDeviceRecord,
} from '@cookbook/core/push-devices';
import { renderAvatarSvg, DEFAULT_AVATAR_CONFIG } from '@cookbook/core/avatar/chef-avatar';

describe('@cookbook/core workspace package', () => {
  it('exports pure recipe, filter, and utility APIs without loading DiceBear avatar art', () => {
    expect(typeof core.normalizeRecipeContent).toBe('function');
    expect(typeof core.scaleIngredients).toBe('function');
    expect(typeof core.recipeShareText).toBe('function');
    expect(typeof core.parseYouTubeUrl).toBe('function');
    expect(typeof core.FilterUtils).toBe('function');
    expect(typeof core.LRUCache).toBe('function');
    expect(typeof core.isBuiltAvatarUrl).toBe('function');
    // Lazy artwork library must stay out of root barrel
    expect(core.renderAvatarSvg).toBeUndefined();
  });

  it('exposes the chef-avatar composer via its explicit lazy subpath', () => {
    const svg = renderAvatarSvg(DEFAULT_AVATAR_CONFIG);
    expect(svg).toContain('<svg');
  });

  describe('push-devices helpers', () => {
    it('validates supported platforms strictly', () => {
      expect(isValidPushPlatform(PUSH_PLATFORMS.WEB)).toBe(true);
      expect(isValidPushPlatform(PUSH_PLATFORMS.ANDROID)).toBe(true);
      expect(isValidPushPlatform(PUSH_PLATFORMS.IOS)).toBe(true);
      expect(isValidPushPlatform('desktop')).toBe(false);
      expect(isValidPushPlatform(null)).toBe(false);
    });

    it('derives deterministic 32-hex device IDs matching Node SHA-256', () => {
      const sample = 'fcm-token-abc123:APA91b-unicode-שלום-🔥';
      const expected = createHash('sha256').update(sample, 'utf8').digest('hex').slice(0, 32);
      expect(deviceIdForToken(sample)).toBe(expected);
      expect(deviceIdForToken(sample)).toMatch(/^[0-9a-f]{32}$/);
    });

    it('rejects empty tokens in deviceIdForToken', () => {
      expect(() => deviceIdForToken('')).toThrow('token');
      expect(() => deviceIdForToken('   ')).toThrow('token');
    });

    it('builds validated device records and truncates ua to 200 chars', () => {
      const now = new Date();
      const record = buildDeviceRecord({
        token: 'tok-1',
        platform: 'ios',
        ua: 'x'.repeat(250),
        updatedAt: now,
      });
      expect(record).toEqual({
        token: 'tok-1',
        platform: 'ios',
        ua: 'x'.repeat(200),
        updatedAt: now,
      });
    });

    it('omits ua when blank and rejects invalid platform or missing timestamp', () => {
      const now = new Date();
      expect(buildDeviceRecord({ token: 'tok-1', platform: 'android', updatedAt: now })).toEqual({
        token: 'tok-1',
        platform: 'android',
        updatedAt: now,
      });
      expect(() =>
        buildDeviceRecord({ token: 'tok-1', platform: 'blackberry', updatedAt: now }),
      ).toThrow('platform');
      expect(() => buildDeviceRecord({ token: 'tok-1', platform: 'web' })).toThrow('updatedAt');
    });
  });
});
