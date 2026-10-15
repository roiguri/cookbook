import {
  AVATAR_COLORS,
  AVATAR_CONFIG_VERSION,
  AVATAR_PARTS,
  DEFAULT_AVATAR_CONFIG,
  describeAvatarSchema,
  normalizeAvatarConfig,
  randomAvatarConfig,
  renderAvatarSvg,
  renderKitchenPropSvg,
  HAT_FIT,
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
      colors: { skin: 'dark', hair: '#ff00ff' },
      extra: true,
    });
    expect(config.v).toBe(AVATAR_CONFIG_VERSION);
    expect(config.parts.hair).toBe('curly');
    expect(config.parts.eyes).toBe(DEFAULT_AVATAR_CONFIG.parts.eyes);
    expect(config.parts).not.toHaveProperty('tail');
    expect(config.colors.skin).toBe('dark');
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
      const svg = renderAvatarSvg(config).toLowerCase();
      expect(parseErrors(svg)).toBe(0);
      if (option.hex) expect(svg).toContain(`#${option.hex}`);
    },
  );

  it('has no background for the transparent background', () => {
    const svg = renderAvatarSvg({
      ...DEFAULT_AVATAR_CONFIG,
      colors: { ...DEFAULT_AVATAR_CONFIG.colors, background: 'none' },
    }).toLowerCase();
    for (const { hex } of AVATAR_COLORS.background.options.filter((o) => o.hex)) {
      expect(svg).not.toContain(`#${hex}`);
    }
  });

  it('gives each render its own ids, so many avatars can share a page', () => {
    const ids = (svg) => [...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
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

  it('replaces the Avataaars shirt with the kitchen outfit', () => {
    const svg = renderAvatarSvg(DEFAULT_AVATAR_CONFIG);
    expect(svg).toMatch(/clip-path="url\(#ca\d+-shirt\)"/);
  });

  const withHat = (hair, hat) =>
    renderAvatarSvg({
      ...DEFAULT_AVATAR_CONFIG,
      parts: { ...DEFAULT_AVATAR_CONFIG.parts, hair, hat },
    });

  it('short hair shows only below a hat, and is not cut without one', () => {
    expect(withHat('shortFlat', 'toque')).toMatch(/-under-hat/);
    expect(withHat('shortFlat', 'none')).not.toMatch(/-under-hat/);
  });

  // The hat is the last scaled group in the figure (the figure itself is scaled first).
  const hatScale = (svg) => +[...svg.matchAll(/scale\(([\d.]+)\)">/g)].at(-1)[1];

  it('big and long hair is not cut; the hat grows to cover its crown', () => {
    for (const hair of Object.keys(HAT_FIT).filter((h) => HAT_FIT[h].crown != null)) {
      const svg = withHat(hair, 'bandana');
      expect(svg).not.toMatch(/-under-hat/);
      expect(hatScale(svg)).toBeGreaterThanOrEqual(1);
    }
    expect(hatScale(withHat('fro', 'cap'))).toBeGreaterThan(hatScale(withHat('bob', 'cap')));
    expect(hatScale(withHat('shortFlat', 'cap'))).toBe(1);
  });
});

describe('kitchen props', () => {
  // A prop's shading and decoration are clipped to its own outline (pixel-checked by
  // scripts/avatars/check-avatars.cjs); here: every detail group is clipped.
  it.each([
    ...AVATAR_PARTS.hat.options.filter((o) => o.id !== 'none').map((o) => ['hat', o.id]),
    ...AVATAR_PARTS.outfit.options.map((o) => ['outfit', o.id]),
  ])('%s %s keeps its details inside its outline', (kind, id) => {
    const svg = renderKitchenPropSvg(kind, id);
    expect(parseErrors(svg)).toBe(0);
    expect(svg).toMatch(
      kind === 'hat' ? /clip-path="url\(#kp\d+-hat\)"/ : /clip-path="url\(#kp\d+-shirt\)"/,
    );
  });
});
