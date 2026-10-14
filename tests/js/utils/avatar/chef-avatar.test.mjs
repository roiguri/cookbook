import {
  AVATAR_COLORS,
  AVATAR_CONFIG_VERSION,
  AVATAR_PARTS,
  DEFAULT_AVATAR_CONFIG,
  describeAvatarSchema,
  normalizeAvatarConfig,
  randomAvatarConfig,
  renderAvatarSvg,
} from 'src/js/utils/avatar/chef-avatar.js';

// The avatar is rasterised from a standalone SVG (avatar-png.js), which browsers parse
// as strict XML: a duplicate attribute that inline HTML would forgive fails to decode.
const parseErrors = (svg) =>
  new DOMParser().parseFromString(svg, 'image/svg+xml').getElementsByTagName('parsererror').length;

const withPart = (key, id) => ({
  ...DEFAULT_AVATAR_CONFIG,
  parts: { ...DEFAULT_AVATAR_CONFIG.parts, [key]: id },
});

function seeded(seed) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

describe('chef avatar catalogue', () => {
  it('the default config uses ids from the catalogue', () => {
    expect(normalizeAvatarConfig(DEFAULT_AVATAR_CONFIG)).toEqual(DEFAULT_AVATAR_CONFIG);
  });

  it('option ids are unique within each part and palette', () => {
    for (const group of [AVATAR_PARTS, AVATAR_COLORS]) {
      for (const { options } of Object.values(group)) {
        const ids = options.map((o) => o.id);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });

  it('stays within what firestore.rules accepts for avatarConfig', () => {
    expect(Object.keys(AVATAR_PARTS).length).toBeLessThanOrEqual(16);
    expect(Object.keys(AVATAR_COLORS).length).toBeLessThanOrEqual(8);
  });

  it('describeAvatarSchema lists every part and colour id with a description', () => {
    const schema = describeAvatarSchema();
    expect(schema.version).toBe(AVATAR_CONFIG_VERSION);
    for (const [key, part] of Object.entries(AVATAR_PARTS)) {
      expect(schema.parts[key].options.map((o) => o.id)).toEqual(part.options.map((o) => o.id));
      expect(schema.parts[key].options.every((o) => o.describe)).toBe(true);
    }
    expect(Object.keys(schema.colors)).toEqual(Object.keys(AVATAR_COLORS));
  });
});

describe('normalizeAvatarConfig', () => {
  it('fills a missing config with the default', () => {
    expect(normalizeAvatarConfig(undefined)).toEqual(DEFAULT_AVATAR_CONFIG);
    expect(normalizeAvatarConfig(null)).toEqual(DEFAULT_AVATAR_CONFIG);
  });

  it('keeps valid ids, replaces unknown ones and drops extra keys', () => {
    const config = normalizeAvatarConfig({
      v: 0,
      parts: { hair: 'curly', eyes: 'laser', tail: 'long' },
      colors: { skin: 'deep', hair: '#ff00ff' },
      extra: true,
    });
    expect(config.v).toBe(AVATAR_CONFIG_VERSION);
    expect(config.parts.hair).toBe('curly');
    expect(config.parts.eyes).toBe(DEFAULT_AVATAR_CONFIG.parts.eyes);
    expect(config.parts).not.toHaveProperty('tail');
    expect(config.colors.skin).toBe('deep');
    expect(config.colors.hair).toBe(DEFAULT_AVATAR_CONFIG.colors.hair);
    expect(config).not.toHaveProperty('extra');
  });
});

describe('randomAvatarConfig', () => {
  it('only produces valid configs, with a visible background', () => {
    const random = seeded(42);
    for (let i = 0; i < 200; i++) {
      const config = randomAvatarConfig(random);
      expect(normalizeAvatarConfig(config)).toEqual(config);
      expect(config.colors.background).not.toBe('none');
    }
  });
});

describe('renderAvatarSvg', () => {
  it.each(
    Object.entries(AVATAR_PARTS).flatMap(([key, part]) => part.options.map((o) => [key, o.id])),
  )('renders %s=%s as well-formed SVG', (key, id) => {
    expect(parseErrors(renderAvatarSvg(withPart(key, id)))).toBe(0);
    // Without a hat too, so every hairstyle is fully drawn.
    expect(
      parseErrors(
        renderAvatarSvg({
          ...withPart(key, id),
          parts: { ...withPart(key, id).parts, hat: 'none' },
        }),
      ),
    ).toBe(0);
  });

  it.each(Object.entries(AVATAR_COLORS).flatMap(([key, p]) => p.options.map((o) => [key, o])))(
    'paints colour %s=%s',
    (key, option) => {
      const config = {
        ...DEFAULT_AVATAR_CONFIG,
        colors: { ...DEFAULT_AVATAR_CONFIG.colors, [key]: option.id },
      };
      const svg = renderAvatarSvg(config);
      expect(parseErrors(svg)).toBe(0);
      if (option.hex && key !== 'outfit') expect(svg).toContain(option.hex); // default outfit 'apron' shows the accent; covered below
    },
  );

  it('uses the outfit colour for the apron', () => {
    const svg = renderAvatarSvg({
      ...DEFAULT_AVATAR_CONFIG,
      colors: { ...DEFAULT_AVATAR_CONFIG.colors, outfit: 'navy' },
    });
    expect(svg).toContain(AVATAR_COLORS.outfit.options.find((o) => o.id === 'navy').hex);
  });

  it('draws no background circle for the transparent background', () => {
    const svg = renderAvatarSvg({
      ...DEFAULT_AVATAR_CONFIG,
      colors: { ...DEFAULT_AVATAR_CONFIG.colors, background: 'none' },
    });
    expect(svg).not.toContain('r="32"');
  });

  it('gives each render its own clip-path ids, so many avatars can share a page', () => {
    const ids = (svg) => [...svg.matchAll(/<clipPath id="([^"]+)"/g)].map((m) => m[1]);
    const a = ids(renderAvatarSvg(DEFAULT_AVATAR_CONFIG));
    const b = ids(renderAvatarSvg(DEFAULT_AVATAR_CONFIG));
    expect(a.length).toBeGreaterThan(0);
    expect(a.filter((id) => b.includes(id))).toEqual([]);
  });

  it('applies viewBox, size and an accessible name', () => {
    const svg = renderAvatarSvg(DEFAULT_AVATAR_CONFIG, {
      viewBox: '10 10 20 20',
      size: 96,
      title: 'שף',
    });
    expect(svg).toMatch(/^<svg [^>]*viewBox="10 10 20 20"/);
    expect(svg).toContain('width="96" height="96"');
    expect(svg).toContain('role="img" aria-label="שף"');
    expect(renderAvatarSvg(DEFAULT_AVATAR_CONFIG)).toContain('aria-hidden="true"');
  });

  it('hides a bun under a hat', () => {
    const bun = (hat) =>
      renderAvatarSvg({
        ...DEFAULT_AVATAR_CONFIG,
        parts: { ...DEFAULT_AVATAR_CONFIG.parts, hair: 'bun', hat },
      });
    expect(bun('none')).toContain('cy="9.6" r="4.6"');
    expect(bun('toque')).not.toContain('cy="9.6" r="4.6"');
  });
});
