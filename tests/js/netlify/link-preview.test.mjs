import { jest } from '@jest/globals';
import {
  FALLBACK_IMAGE,
  SITE_DESCRIPTION,
  fetchPublishedRecipe,
  fromFirestoreFields,
  injectPreview,
  previewFor,
  previewImagePath,
  recipeIdFromPath,
} from '../../../netlify/edge-functions/link-preview/preview.js';

const site = { projectId: 'proj', apiKey: 'key', bucket: 'bucket.test', title: 'Our Kitchen' };
const url = new URL('https://cookbook.test/recipe/abc?servings=8');
const tag = (preview, key) => preview.tags.find(([, name]) => name === key)?.[2];

const recipe = {
  name: 'פרוסות שוקו-ביסקוויט',
  description: '',
  category: 'desserts',
  prepTime: 30,
  servings: 20,
  visibility: 'published',
  images: [
    { full: 'recipes/abc/images/family.jpg', access: 'approved', isPrimary: true },
    { full: 'recipes/abc/images/public.jpg', access: 'public', isPrimary: false },
  ],
};

describe('recipeIdFromPath', () => {
  it('finds the id on recipe pages only', () => {
    expect(recipeIdFromPath('/recipe/abc')).toBe('abc');
    expect(recipeIdFromPath('/recipe/abc/')).toBe('abc');
    expect(recipeIdFromPath('/recipe/')).toBeNull();
    expect(recipeIdFromPath('/categories')).toBeNull();
    expect(recipeIdFromPath('/recipe/abc/edit')).toBeNull();
  });
});

describe('fromFirestoreFields', () => {
  it('turns REST values into plain values', () => {
    expect(
      fromFirestoreFields({
        name: { stringValue: 'סלט' },
        servings: { integerValue: '4' },
        description: { nullValue: null },
        images: {
          arrayValue: {
            values: [
              {
                mapValue: {
                  fields: { full: { stringValue: 'a.jpg' }, isPrimary: { booleanValue: true } },
                },
              },
            ],
          },
        },
      }),
    ).toEqual({
      name: 'סלט',
      servings: 4,
      description: null,
      images: [{ full: 'a.jpg', isPrimary: true }],
    });
  });
});

describe('previewImagePath', () => {
  it('uses public photos only, primary first, as the 1080 WebP', () => {
    expect(previewImagePath(recipe)).toBe('recipes/abc/images/public_1080x1080.webp');
    expect(
      previewImagePath({
        images: [
          { full: 'recipes/abc/images/a.png', access: 'public' },
          { full: 'recipes/abc/images/b.jpg', access: 'public', isPrimary: true },
        ],
      }),
    ).toBe('recipes/abc/images/b_1080x1080.webp');
  });

  it('has none without a public photo', () => {
    expect(previewImagePath({ images: [{ full: 'x.jpg', access: 'manager' }] })).toBeNull();
    expect(previewImagePath({ images: ['legacy/path.jpg'] })).toBeNull();
    expect(previewImagePath({})).toBeNull();
  });
});

describe('previewFor', () => {
  it('previews a recipe with its name, a description line and its photo', () => {
    const preview = previewFor({ recipe, url, site });
    expect(preview.title).toBe('פרוסות שוקו-ביסקוויט - Our Kitchen');
    expect(tag(preview, 'og:title')).toBe('פרוסות שוקו-ביסקוויט');
    expect(tag(preview, 'og:description')).toBe('קינוחים · 30 דקות הכנה · 20 מנות');
    expect(tag(preview, 'og:url')).toBe('https://cookbook.test/recipe/abc');
    expect(tag(preview, 'og:image')).toBe(
      'https://firebasestorage.googleapis.com/v0/b/bucket.test/o/recipes%2Fabc%2Fimages%2Fpublic_1080x1080.webp?alt=media',
    );
    expect(tag(preview, 'og:image:width')).toBeUndefined();
  });

  it("uses the recipe's own description, shortened", () => {
    const long = 'א'.repeat(250);
    expect(
      tag(previewFor({ recipe: { ...recipe, description: 'קלועה.' }, url, site }), 'description'),
    ).toBe('קלועה.');
    const shortened = tag(
      previewFor({ recipe: { ...recipe, description: long }, url, site }),
      'description',
    );
    expect(shortened).toHaveLength(200);
    expect(shortened.endsWith('…')).toBe(true);
  });

  it('falls back to the branded card without a public photo', () => {
    const preview = previewFor({ recipe: { ...recipe, images: [] }, url, site });
    expect(tag(preview, 'og:image')).toBe(`https://cookbook.test${FALLBACK_IMAGE.path}`);
    expect(tag(preview, 'og:image:width')).toBe('1200');
  });

  it("gives other pages (and private or missing recipes) the site's preview", () => {
    const preview = previewFor({ recipe: null, url, site });
    expect(preview.title).toBe('Our Kitchen');
    expect(tag(preview, 'og:title')).toBe('Our Kitchen');
    expect(tag(preview, 'og:description')).toBe(SITE_DESCRIPTION);
    expect(tag(preview, 'og:image')).toBe(`https://cookbook.test${FALLBACK_IMAGE.path}`);
  });
});

describe('injectPreview', () => {
  const html = [
    '<html><head>',
    '<title>Our Kitchen</title>',
    '<!-- link-preview:start -->',
    '<meta property="og:title" content="Our Kitchen" />',
    '<!-- link-preview:end -->',
    '</head><body></body></html>',
  ].join('\n');

  it('replaces the title and the default block', () => {
    const out = injectPreview(html, {
      title: 'Pie $& "quotes" <b>',
      tags: [['property', 'og:title', 'Pie $1 & "more"']],
    });
    expect(out).toContain('<title>Pie $&amp; &quot;quotes&quot; &lt;b&gt;</title>');
    expect(out).toContain('<meta property="og:title" content="Pie $1 &amp; &quot;more&quot;" />');
    expect(out).not.toContain('content="Our Kitchen"');
    expect(out.match(/link-preview:start/g)).toHaveLength(1);
  });

  it('adds the tags before </head> when the markers are missing', () => {
    const out = injectPreview('<html><head><title>x</title></head></html>', {
      title: 'y',
      tags: [['name', 'description', 'd']],
    });
    expect(out).toMatch(/<meta name="description" content="d" \/>[\s\S]*<\/head>/);
  });
});

describe('fetchPublishedRecipe', () => {
  const ok = (fields) => jest.fn().mockResolvedValue({ ok: true, json: async () => ({ fields }) });

  it('reads the recipe through the REST API', async () => {
    const fetchImpl = ok({
      name: { stringValue: 'סלט' },
      visibility: { stringValue: 'published' },
    });
    await expect(fetchPublishedRecipe('a b', site, fetchImpl)).resolves.toEqual({
      name: 'סלט',
      visibility: 'published',
    });
    const requested = fetchImpl.mock.calls[0][0];
    expect(requested).toContain(
      '/projects/proj/databases/(default)/documents/recipes/a%20b?key=key',
    );
    expect(requested).toContain('mask.fieldPaths=images');
  });

  it('returns nothing for refused, missing or private recipes', async () => {
    const refused = jest.fn().mockResolvedValue({ ok: false, status: 403 });
    await expect(fetchPublishedRecipe('x', site, refused)).resolves.toBeNull();
    const priv = ok({ name: { stringValue: 'סוד' }, visibility: { stringValue: 'private' } });
    await expect(fetchPublishedRecipe('x', site, priv)).resolves.toBeNull();
  });
});
