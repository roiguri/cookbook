/**
 * Chef avatars: the part catalogue and an SVG renderer.
 *
 * Faces and hair are Avataaars (https://avataaars.com/, by Pablo Stanley, free for personal
 * and commercial use) drawn through DiceBear. On top of them we draw our own kitchen layer
 * in the same flat style: chef hats and kitchen clothing.
 *
 * An avatar is a small config of part and colour ids, stored on `users/{uid}.avatarConfig`:
 *
 *   { v: 1,
 *     parts:  { hair, eyes, brows, mouth, facialHair, glasses, hat, outfit },
 *     colors: { skin, hair, outfit, background } }
 *
 * Every value is an id from the catalogue below, so a config is easy to validate and easy to
 * produce from elsewhere (e.g. a future "match my photo" function asking a vision model to
 * pick one id per part — `describeAvatarSchema()` gives it the vocabulary).
 *
 * How the kitchen layer is combined with Avataaars' output (DiceBear pinned to an exact
 * version; tests fail if the structure changes):
 *  - Clothing: the crew-neck shirt group is replaced by our outfit, cut to the same shape.
 *  - Hats: hair is clipped to below the hat's bottom edge and beside it; the hat is drawn last.
 *    Big and long hairstyles instead get a hat scaled to cover their crown (`HAT_FIT`).
 *  - The figure is scaled down a little so tall hats and the outfit both fit the frame.
 */

import { createAvatar } from '@dicebear/core';
import * as avataaars from '@dicebear/avataaars';

export const AVATAR_CONFIG_VERSION = 1;

// Figure scaling inside Avataaars' 280×280 frame (figure coordinates are inside its
// translate(8) group). `crop()` converts a figure-space box to a frame viewBox.
const SCALE = 0.84;
const SHIFT_X = 8 * SCALE + 140 * (1 - SCALE);
const SHIFT_Y = 280 * (1 - SCALE);
const crop = (x, y, w, h) =>
  [SHIFT_X + x * SCALE, SHIFT_Y + y * SCALE, w * SCALE, h * SCALE]
    .map((n) => +n.toFixed(2))
    .join(' ');

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

/** Colour palettes (`hex` without '#', as DiceBear takes them). */
export const AVATAR_COLORS = {
  skin: {
    label: 'גוון עור',
    describe: 'skin tone, lightest to darkest',
    options: [
      { id: 'light', label: 'בהיר', hex: 'ffdbb4' },
      { id: 'fair', label: 'בהיר-חם', hex: 'edb98a' },
      { id: 'tan', label: 'שזוף', hex: 'd08b5b' },
      { id: 'brown', label: 'חום', hex: 'ae5d29' },
      { id: 'dark', label: 'כהה', hex: '614335' },
    ],
  },
  hair: {
    label: 'צבע שיער',
    describe: 'hair and facial-hair colour',
    options: [
      { id: 'black', label: 'שחור', hex: '2c1b18' },
      { id: 'darkBrown', label: 'חום כהה', hex: '4a312c' },
      { id: 'brown', label: 'חום', hex: '724133' },
      { id: 'auburn', label: 'ערמוני', hex: 'a55728' },
      { id: 'ginger', label: 'ג׳ינג׳י', hex: 'c93305' },
      { id: 'lightBrown', label: 'חום בהיר', hex: 'b58143' },
      { id: 'blonde', label: 'בלונד', hex: 'd6b370' },
      { id: 'grey', label: 'אפור', hex: 'e8e1e1' },
    ],
  },
  outfit: {
    label: 'צבע בד',
    describe: 'accent colour of the apron, shirt, neckerchief or hat',
    options: [
      { id: 'burgundy', label: 'בורדו', hex: 'a8304b' },
      { id: 'green', label: 'ירוק', hex: '6a994e' },
      { id: 'red', label: 'אדום', hex: 'c8494b' },
      { id: 'navy', label: 'כחול', hex: '33506f' },
      { id: 'mustard', label: 'חרדל', hex: 'e2a53b' },
      { id: 'charcoal', label: 'פחם', hex: '3e3c3a' },
    ],
  },
  background: {
    label: 'רקע',
    describe: 'background colour',
    options: [
      { id: 'none', label: 'שקוף', hex: null },
      { id: 'cream', label: 'שמנת', hex: 'f2e8cf' },
      { id: 'sage', label: 'מרווה', hex: 'dbe7cc' },
      { id: 'rose', label: 'ורוד', hex: 'f5d9d4' },
      { id: 'sky', label: 'תכלת', hex: 'd5e4ef' },
      { id: 'butter', label: 'חמאה', hex: 'f8e3a8' },
    ],
  },
};

/**
 * Parts, in the order the builder shows them. `crop` is the viewBox the builder uses for
 * that part's option thumbnails. Option ids are Avataaars' own where they come from it.
 */
export const AVATAR_PARTS = {
  hair: {
    label: 'תסרוקת',
    describe: 'hairstyle',
    crop: crop(20, -30, 224, 250),
    options: [
      { id: 'shortFlat', label: 'קצר חלק', describe: 'short, flat hair' },
      { id: 'shortRound', label: 'קצר מעוגל', describe: 'short rounded hair' },
      { id: 'shortWaved', label: 'קצר גלי', describe: 'short wavy hair' },
      { id: 'shortCurly', label: 'קצר מתולתל', describe: 'short curly hair' },
      { id: 'theCaesar', label: 'קיסר', describe: 'very short Caesar cut' },
      { id: 'theCaesarAndSidePart', label: 'שביל צד', describe: 'short hair with a side part' },
      { id: 'sides', label: 'צדדים', describe: 'balding on top, hair on the sides' },
      { id: 'shavedSides', label: 'מגולח בצדדים', describe: 'long on top, shaved sides' },
      { id: 'dreads01', label: 'ראסטות קצרות', describe: 'short dreadlocks' },
      { id: 'frizzle', label: 'מקורזל', describe: 'short frizzy hair' },
      { id: 'shaggy', label: 'פרוע', describe: 'shaggy medium hair' },
      { id: 'shaggyMullet', label: 'מאלט', describe: 'shaggy mullet' },
      { id: 'bob', label: 'קארה', describe: 'chin-length bob' },
      { id: 'bun', label: 'פקעת', describe: 'hair pulled up into a top bun' },
      { id: 'curly', label: 'מתולתל', describe: 'medium curly hair' },
      { id: 'curvy', label: 'גלי ארוך', describe: 'long wavy hair' },
      { id: 'straight01', label: 'ארוך חלק', describe: 'long straight hair' },
      {
        id: 'straight02',
        label: 'ארוך עם פוני',
        describe: 'long straight hair with a side fringe',
      },
      {
        id: 'straightAndStrand',
        label: 'ארוך עם קווצה',
        describe: 'long straight hair with a loose strand',
      },
      { id: 'longButNotTooLong', label: 'חצי ארוך', describe: 'shoulder-length hair' },
      { id: 'miaWallace', label: 'פוני ישר', describe: 'straight hair with a blunt fringe' },
      { id: 'bigHair', label: 'נפוח', describe: 'big voluminous long hair' },
      { id: 'fro', label: 'אפרו', describe: 'afro' },
      { id: 'froBand', label: 'אפרו עם סרט', describe: 'afro with a headband' },
      { id: 'dreads', label: 'ראסטות', describe: 'long dreadlocks' },
      { id: 'dreads02', label: 'ראסטות בינוניות', describe: 'medium dreadlocks' },
      { id: 'frida', label: 'צמות ופרחים', describe: 'braids with flowers' },
      { id: 'bald', label: 'קרחת', describe: 'bald' },
    ],
  },
  eyes: {
    label: 'עיניים',
    describe: 'eyes',
    crop: crop(66, 70, 132, 70),
    options: [
      { id: 'default', label: 'רגילות', describe: 'open eyes' },
      { id: 'happy', label: 'שמחות', describe: 'closed, smiling eyes' },
      { id: 'wink', label: 'קריצה', describe: 'winking' },
      { id: 'squint', label: 'מצומצמות', describe: 'squinting' },
      { id: 'surprised', label: 'מופתעות', describe: 'wide, surprised eyes' },
      { id: 'side', label: 'מבט הצידה', describe: 'looking to the side' },
      { id: 'closed', label: 'עצומות', describe: 'eyes closed' },
      { id: 'hearts', label: 'לבבות', describe: 'heart eyes, in love with the food' },
    ],
  },
  brows: {
    label: 'גבות',
    describe: 'eyebrows',
    crop: crop(66, 66, 132, 64),
    options: [
      { id: 'defaultNatural', label: 'טבעיות', describe: 'natural eyebrows' },
      { id: 'raisedExcitedNatural', label: 'מורמות', describe: 'raised, excited eyebrows' },
      { id: 'flatNatural', label: 'ישרות', describe: 'flat eyebrows' },
      { id: 'upDownNatural', label: 'אחת מורמת', describe: 'one eyebrow raised' },
      { id: 'angryNatural', label: 'מרוכזות', describe: 'eyebrows angled down, focused' },
      { id: 'sadConcernedNatural', label: 'מודאגות', describe: 'concerned eyebrows' },
      { id: 'frownNatural', label: 'מכווצות', describe: 'frowning eyebrows' },
      { id: 'unibrowNatural', label: 'גבה אחת', describe: 'unibrow' },
    ],
  },
  mouth: {
    label: 'פה',
    describe: 'mouth',
    crop: crop(78, 112, 108, 64),
    options: [
      { id: 'smile', label: 'חיוך רחב', describe: 'big open smile' },
      { id: 'default', label: 'חיוך', describe: 'gentle smile' },
      { id: 'twinkle', label: 'חיוך קטן', describe: 'small closed smile' },
      { id: 'tongue', label: 'לשון', describe: 'tongue out, tasting' },
      { id: 'eating', label: 'לועס', describe: 'chewing, full cheeks' },
      { id: 'serious', label: 'רציני', describe: 'straight, serious mouth' },
      { id: 'disbelief', label: 'וואו', describe: 'open mouth, amazed' },
    ],
  },
  facialHair: {
    label: 'זקן ושפם',
    describe: 'facial hair',
    crop: crop(50, 80, 164, 120),
    options: [
      { id: 'none', label: 'ללא', describe: 'clean shaven' },
      { id: 'beardLight', label: 'זיפים', describe: 'light stubble beard' },
      { id: 'beardMedium', label: 'זקן', describe: 'medium beard' },
      { id: 'beardMajestic', label: 'זקן מלא', describe: 'big full beard' },
      { id: 'moustacheFancy', label: 'שפם מסולסל', describe: 'curled fancy mustache' },
      { id: 'moustacheMagnum', label: 'שפם עבות', describe: 'thick mustache' },
    ],
  },
  glasses: {
    label: 'משקפיים',
    describe: 'glasses',
    crop: crop(56, 70, 152, 70),
    options: [
      { id: 'none', label: 'ללא', describe: 'no glasses' },
      { id: 'prescription01', label: 'דקים', describe: 'thin glasses' },
      { id: 'prescription02', label: 'עבים', describe: 'thick-rimmed glasses' },
      { id: 'round', label: 'עגולים', describe: 'round glasses' },
      { id: 'wayfarers', label: 'משקפי שמש', describe: 'sunglasses' },
      { id: 'kurt', label: 'משקפי שמש עגולים', describe: 'round white sunglasses' },
    ],
  },
  hat: {
    label: 'כובע',
    describe: 'headwear',
    crop: crop(20, -30, 224, 200),
    options: [
      { id: 'toque', label: 'כובע שף', describe: 'tall puffy chef toque' },
      { id: 'cap', label: 'כובע שף נמוך', describe: 'short pleated chef cap' },
      { id: 'bandana', label: 'בנדנה', describe: 'polka-dot bandana tied at the side' },
      { id: 'beanie', label: 'כיפת מטבח', describe: 'snug white kitchen skull cap' },
      { id: 'baseball', label: 'כובע מצחייה', describe: 'baseball cap' },
      { id: 'tallToque', label: 'כובע שף גבוה', describe: 'classic tall pleated chef toque' },
      {
        id: 'paperCap',
        label: 'כובע נייר',
        describe: 'folded paper line-cook cap with a coloured stripe',
      },
      { id: 'beret', label: 'ברט', describe: 'soft beret tilted to one side' },
      { id: 'backwards', label: 'כובע הפוך', describe: 'baseball cap worn backwards' },
      { id: 'headband', label: 'סרט ראש', describe: 'fabric headband tied at the side' },
      { id: 'none', label: 'בלי כובע', describe: 'no hat' },
    ],
  },
  outfit: {
    label: 'מדים',
    describe: 'kitchen outfit',
    crop: crop(8, 170, 248, 120),
    options: [
      {
        id: 'jacket',
        label: 'מעיל שף',
        describe: 'white double-breasted chef jacket with a neckerchief',
      },
      { id: 'apron', label: 'סינר', describe: 'white chef jacket under a coloured bib apron' },
      { id: 'tee', label: 'חולצה וסינר', describe: 'coloured t-shirt under a white apron' },
      { id: 'stripes', label: 'סינר פסים', describe: 'striped butcher apron over a white shirt' },
    ],
  },
};

export const DEFAULT_AVATAR_CONFIG = Object.freeze({
  v: AVATAR_CONFIG_VERSION,
  parts: Object.freeze({
    hair: 'shortFlat',
    eyes: 'default',
    brows: 'defaultNatural',
    mouth: 'smile',
    facialHair: 'none',
    glasses: 'none',
    hat: 'toque',
    outfit: 'apron',
  }),
  colors: Object.freeze({ skin: 'fair', hair: 'brown', outfit: 'burgundy', background: 'cream' }),
});

const hasOption = (list, id) => list.some((o) => o.id === id);

/**
 * A complete, valid config from anything: unknown ids fall back to the default, missing
 * keys are filled in and extra keys dropped. Safe on `undefined` and on old versions.
 * @param {*} raw
 * @returns {{v: number, parts: Object<string,string>, colors: Object<string,string>}}
 */
export function normalizeAvatarConfig(raw) {
  const parts = {};
  for (const [key, part] of Object.entries(AVATAR_PARTS)) {
    const id = raw?.parts?.[key];
    parts[key] = hasOption(part.options, id) ? id : DEFAULT_AVATAR_CONFIG.parts[key];
  }
  const colors = {};
  for (const [key, palette] of Object.entries(AVATAR_COLORS)) {
    const id = raw?.colors?.[key];
    colors[key] = hasOption(palette.options, id) ? id : DEFAULT_AVATAR_CONFIG.colors[key];
  }
  return { v: AVATAR_CONFIG_VERSION, parts, colors };
}

/**
 * A random config. Facial hair and glasses are rarer than "none", so random avatars don't
 * all look alike.
 * @param {() => number} [random=Math.random]
 */
export function randomAvatarConfig(random = Math.random) {
  const pick = (list) => list[Math.floor(random() * list.length)].id;
  const config = { v: AVATAR_CONFIG_VERSION, parts: {}, colors: {} };
  for (const [key, part] of Object.entries(AVATAR_PARTS)) {
    const options = part.options;
    const rare = ['facialHair', 'glasses'].includes(key);
    config.parts[key] = rare && random() < 0.6 ? 'none' : pick(options);
  }
  for (const [key, palette] of Object.entries(AVATAR_COLORS)) {
    config.colors[key] = pick(key === 'background' ? palette.options.slice(1) : palette.options);
  }
  return config;
}

/**
 * The catalogue as plain data (ids and English descriptions) — the vocabulary a future
 * photo-matching function hands to a vision model.
 */
export function describeAvatarSchema() {
  const describe = (group) =>
    Object.fromEntries(
      Object.entries(group).map(([key, g]) => [
        key,
        {
          describe: g.describe,
          options: g.options.map((o) => ({ id: o.id, describe: o.describe || o.label })),
        },
      ]),
    );
  return {
    version: AVATAR_CONFIG_VERSION,
    parts: describe(AVATAR_PARTS),
    colors: describe(AVATAR_COLORS),
  };
}

// ---------------------------------------------------------------------------
// Kitchen layer (figure coordinates: head circle centred 132,92, radius 56)
// ---------------------------------------------------------------------------

// Opaque rim for white props (white hats and clothes), so they show on white backgrounds.
const WHITE_EDGE = '#DCD8CE';

// Avataaars' crew-neck shirt outline (clothing group, translated by 0,170).
// Kitchen props on their own (figure coordinates), for tests and docs: proves they paint
// nothing outside their own outline.
export function renderKitchenPropSvg(kind, propId, outfitColor = 'burgundy') {
  const accent = `#${color('outfit', outfitColor)}`;
  const id = `kp${(renderCount = (renderCount + 1) % 1e6)}`;
  const body = kind === 'hat' ? hatSvg(HATS[propId](accent), id) : outfit(propId, accent, id);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -24 264 304" fill="none">${body}</svg>`;
}

const SHIRT =
  'M132.5 51.83c18.5 0 33.5-9.62 33.5-21.48 0-.36-.01-.7-.04-1.06A72 72 0 0 1 232 101.04V110H32v-8.95a72 72 0 0 1 67.05-71.83c-.03.37-.05.75-.05 1.13 0 11.86 15 21.48 33.5 21.48Z';
const COLLAR =
  'M99.05 29.22C99 41 115 51.83 132.5 51.83S166 41 165.96 29.29l6.6 1.1C172.6 47 154.6 60 132.5 60S92.4 47 92.6 30.1Z';

function outfit(style, accent, id) {
  const white = '#F7F6F2';
  const sides =
    '<rect x="32" y="20" width="30" height="90" fill="#000" fill-opacity=".05"/>' +
    '<rect x="202" y="20" width="30" height="90" fill="#000" fill-opacity=".05"/>';
  const bib = 'M96 110V70a6 6 0 0 1 6-6h61a6 6 0 0 1 6 6v40Z';
  const straps = (c) =>
    `<path d="M101 66 110 50M164 66 155 50" stroke="${c}" stroke-width="6" stroke-linecap="round"/>`;
  const collar = `<path d="${COLLAR}" fill="#ECEAE4"/>`;
  let inner;
  switch (style) {
    case 'jacket':
      inner =
        `<path d="${SHIRT}" fill="${white}"/>${sides}` +
        '<path d="M168 52 156 110" stroke="#000" stroke-opacity=".14" stroke-width="2.5"/>' +
        [
          [116, 72],
          [116, 92],
          [176, 70],
          [174, 90],
        ]
          .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.2" fill="#3C4F5C"/>`)
          .join('') +
        collar +
        `<path d="M119 53q13.5 7 27 0l-6.5 17q-7 4-14 0Z" fill="${accent}"/>`;
      break;
    case 'tee':
      inner =
        `<path d="${SHIRT}" fill="${accent}"/>${sides}${straps('#fff')}` +
        '<path d="M100 110V74a6 6 0 0 1 6-6h53a6 6 0 0 1 6 6v36Z" fill="#fff"/>' +
        '<path d="M118 86h29v12a5 5 0 0 1-5 5h-19a5 5 0 0 1-5-5Z" fill="#000" fill-opacity=".07"/>' +
        '<path d="M99.05 29.22C99 41 115 51.83 132.5 51.83S166 41 165.96 29.29" stroke="#000" stroke-opacity=".15" stroke-width="5" fill="none"/>';
      break;
    case 'stripes':
      inner =
        `<path d="${SHIRT}" fill="${white}"/>${sides}${straps('#3C4F5C')}` +
        `<clipPath id="${id}-bib"><path d="${bib}"/></clipPath><path d="${bib}" fill="#fff"/>` +
        `<g clip-path="url(#${id}-bib)">${[98, 112, 126, 140, 154]
          .map((x) => `<rect x="${x}" y="60" width="7" height="60" fill="${accent}"/>`)
          .join('')}</g>${collar}`;
      break;
    default: // apron
      inner =
        `<path d="${SHIRT}" fill="${white}"/>${sides}${straps(accent)}<path d="${bib}" fill="${accent}"/>` +
        '<path d="M96 110V70a6 6 0 0 1 6-6h4v46Z" fill="#000" fill-opacity=".07"/>' +
        '<path d="M116 84h33v14a5 5 0 0 1-5 5h-23a5 5 0 0 1-5-5Z" fill="#000" fill-opacity=".1"/>' +
        collar;
  }
  const rim =
    style === 'tee'
      ? ''
      : `<path d="${SHIRT}" fill="${WHITE_EDGE}" stroke="${WHITE_EDGE}" stroke-width="4" stroke-linejoin="round"/>`;
  return `<g transform="translate(0 170)">${rim}<clipPath id="${id}-shirt"><path d="${SHIRT}"/></clipPath><g clip-path="url(#${id}-shirt)">${inner}</g></g>`;
}

const pleats = (y, h) =>
  [92, 112, 132, 152, 172]
    .map(
      (x) =>
        `<rect x="${x - 1.5}" y="${y}" width="3" height="${h}" rx="1.5" fill="#000" fill-opacity=".08"/>`,
    )
    .join('');

// Each hat: `shape` (its outline, filled with `fill`), `details` (shading, pleats, dots —
// clipped to the outline, so nothing ever paints outside the hat), `extra` (separate pieces
// drawn as they are, e.g. bandana tails), plus `crown` (top) and `bottom` (lower edge) used to
// fit the hair. All for a hat on a bare head; HAT_FIT adjusts per hairstyle.
const HATS = {
  toque: () => ({
    // where the puff meets the band: what has to cover big hair (the puff is narrower)
    crown: 22,
    bottom: 74,
    fill: '#fff',
    edge: WHITE_EDGE,
    shape:
      '<circle cx="98" cy="28" r="24"/><circle cx="132" cy="16" r="28"/><circle cx="166" cy="28" r="24"/>' +
      '<rect x="78" y="26" width="108" height="24"/><rect x="76" y="44" width="112" height="30" rx="6"/>',
    details:
      '<path d="M160 6c20 2 32 18 30 34-1 6-4 10-4 10h-16c6-12 6-30-10-44Z" fill="#000" fill-opacity=".06"/>' +
      '<rect x="76" y="44" width="112" height="30" rx="6" fill="#F2F1ED"/>' +
      pleats(50, 18),
  }),
  cap: () => ({
    crown: 20,
    bottom: 74,
    fill: '#fff',
    edge: WHITE_EDGE,
    shape: '<path d="M76 74V40c0-12 26-20 56-20s56 8 56 20v34Z"/>',
    details:
      '<path d="M76 44c16-8 36-11 56-11s40 3 56 11v-6c-16-8-36-11-56-11s-40 3-56 11Z" fill="#000" fill-opacity=".07"/>' +
      '<path d="M170 20h20v56h-20Z" fill="#000" fill-opacity=".04"/>' +
      pleats(50, 18),
  }),
  bandana: (a) => ({
    crown: 24,
    bottom: 74,
    fill: a,
    extra:
      `<path d="M188 52l26-16c4 10 0 18-8 20Z" fill="${a}"/><path d="M188 58l22 14c-6 6-14 4-18-4Z" fill="${a}"/>` +
      '<path d="M188 52l26-16c4 10 0 18-8 20ZM188 58l22 14c-6 6-14 4-18-4Z" fill="#000" fill-opacity=".12"/>',
    shape:
      '<path d="M74 76c-2-36 24-52 58-52s60 16 58 52c-18-8-38-11-58-11s-40 3-58 11Z"/><circle cx="190" cy="55" r="7"/>',
    details: [
      [100, 44],
      [120, 36],
      [144, 36],
      [164, 44],
      [110, 56],
      [132, 50],
      [154, 56],
      [88, 62],
      [176, 62],
    ]
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.2" fill="#fff" fill-opacity=".9"/>`)
      .join(''),
  }),
  beanie: () => ({
    crown: 24,
    bottom: 76,
    fill: '#fff',
    edge: WHITE_EDGE,
    shape:
      '<path d="M74 70c0-30 26-46 58-46s58 16 58 46Z"/><rect x="70" y="58" width="124" height="18" rx="9"/>',
    details:
      '<path d="M160 28c18 8 30 22 30 42h-14c0-16-6-30-16-42Z" fill="#000" fill-opacity=".06"/>' +
      '<rect x="70" y="58" width="124" height="18" rx="9" fill="#F2F1ED"/>',
  }),
  baseball: (a) => ({
    crown: 21,
    bottom: 78,
    fill: a,
    shape:
      '<path d="M76 72c0-30 24-48 56-48s56 18 56 48Z"/><circle cx="132" cy="25" r="4"/>' +
      '<path d="M70 74c20-8 104-8 124 0 2 8-18 12-62 12s-64-4-62-12Z"/>',
    details:
      '<path d="M132 24v48" stroke="#000" stroke-opacity=".12" stroke-width="2.5"/>' +
      '<path d="M70 74c20-8 104-8 124 0 2 8-18 12-62 12s-64-4-62-12Z" fill="#000" fill-opacity=".18"/>',
  }),
  tallToque: () => ({
    // its tall body already covers the crown; growing more would leave the frame
    crown: 4,
    bottom: 74,
    fill: '#fff',
    edge: WHITE_EDGE,
    shape:
      '<path d="M80 50 72 0Q132-12 192 0L184 50Z"/><ellipse cx="132" cy="-2" rx="62" ry="12"/>' +
      '<rect x="76" y="44" width="112" height="30" rx="6"/>',
    details:
      [
        [86, 82],
        [104, 102],
        [122, 121],
        [142, 143],
        [160, 162],
        [178, 182],
      ]
        .map(
          ([top, foot]) =>
            `<path d="M${top} 4 ${foot} 44" stroke="#000" stroke-opacity=".07" stroke-width="3" stroke-linecap="round"/>`,
        )
        .join('') +
      '<path d="M170-12Q194-8 194 0L184 50H168Z" fill="#000" fill-opacity=".06"/>' +
      '<rect x="76" y="44" width="112" height="30" rx="6" fill="#F2F1ED"/>',
  }),
  paperCap: (a) => ({
    crown: 30,
    bottom: 74,
    fill: '#fff',
    edge: WHITE_EDGE,
    shape: '<path d="M74 74 79 36Q132 26 185 36L190 74Q132 64 74 74Z"/>',
    details:
      // the folded-over top edge, a centre crease and the coloured stripe
      '<path d="M79 36Q132 26 185 36L184 48Q132 38 80 48Z" fill="#000" fill-opacity=".08"/>' +
      '<path d="M132 42V62" stroke="#000" stroke-opacity=".08" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M164 30 185 36 190 74H170Z" fill="#000" fill-opacity=".05"/>' +
      `<path d="M74 74 75.6 64Q132 54 188.4 64L190 74Q132 64 74 74Z" fill="${a}"/>`,
  }),
  beret: (a) => ({
    crown: 24,
    bottom: 68,
    fill: a,
    extra: `<rect x="128" y="14" width="8" height="13" rx="3" fill="${a}"/><rect x="128" y="14" width="8" height="13" rx="3" fill="#000" fill-opacity=".15"/>`,
    shape:
      '<path d="M68 64C62 40 92 24 134 24c44 0 76 14 76 32 0 8-10 12-24 12H90c-12 0-20-1-22-4Z"/>',
    details:
      '<path d="M66 60Q132 72 212 56L212 72H66Z" fill="#000" fill-opacity=".16"/>' +
      '<path d="M176 30C196 36 210 46 210 56L188 60C188 48 184 38 176 30Z" fill="#000" fill-opacity=".07"/>',
  }),
  backwards: (a) => ({
    crown: 21,
    bottom: 74,
    fill: a,
    shape: '<path d="M76 74c0-32 24-50 56-50s56 18 56 50Z"/><circle cx="132" cy="25" r="4"/>',
    details:
      '<path d="M132 24v30" stroke="#000" stroke-opacity=".12" stroke-width="2.5"/>' +
      '<path d="M110 76Q110 52 132 52T154 76Z" fill="#000" fill-opacity=".28"/>' +
      '<rect x="112" y="62" width="40" height="5" rx="2.5" fill="#000" fill-opacity=".22"/>' +
      '<path d="M76 70Q132 62 188 70V76H76Z" fill="#000" fill-opacity=".12"/>',
  }),
  headband: (a) => ({
    // Sits on the hair: no hair is hidden under it and it never grows.
    band: true,
    crown: 52,
    bottom: 70,
    fill: a,
    extra:
      `<path d="M180 56l20-10c3 8 0 14-6 15Z" fill="${a}"/><path d="M180 61l17 11c-5 5-11 3-14-3Z" fill="${a}"/>` +
      '<path d="M180 56l20-10c3 8 0 14-6 15ZM180 61l17 11c-5 5-11 3-14-3Z" fill="#000" fill-opacity=".12"/>',
    shape:
      '<path d="M82 70 86 52Q132 40 178 52L182 70Q132 58 82 70Z"/><circle cx="181" cy="59" r="5.5"/>',
    details: '<path d="M84 64Q132 52 180 64L182 70Q132 58 82 70Z" fill="#000" fill-opacity=".12"/>',
  }),
};

/** A hat's SVG (figure coordinates): outline, then details clipped to it. */
function hatSvg(hat, id) {
  // White hats get an opaque rim (outer half of a stroke under the fill), so they stay
  // visible on white backgrounds without any translucent paint outside the hat.
  const rim = hat.edge
    ? `<g fill="${hat.edge}" stroke="${hat.edge}" stroke-width="4" stroke-linejoin="round">${hat.shape}</g>`
    : '';
  return (
    (hat.extra || '') +
    rim +
    `<clipPath id="${id}-hat">${hat.shape}</clipPath>` +
    `<g fill="${hat.fill}">${hat.shape}</g>` +
    `<g clip-path="url(#${id}-hat)">${hat.details}</g>`
  );
}

/**
 * Per-hairstyle hat fit, checked against every hat:
 *  - `crown` (long or big hair): the hairstyle's top edge in figure units, measured from the
 *    rendered hair. The hair isn't cut; instead each hat is scaled around the head's centre
 *    just enough for its crown to cover the hair's crown, then drawn over it — so the hair
 *    meets the hat's real outline with no seam, and big hair gets a proportionally big hat.
 *  - Other styles show hair only below the hat (the hat covers the cut), so short hair and
 *    hair accessories never poke out next to it. `trim` hides that many more units under
 *    the hat's edge (frida's flower leaves).
 */
export const HAT_FIT = {
  bigHair: { crown: 12.7 },
  curly: { crown: 10.4 },
  curvy: { crown: 16.3 },
  bob: { crown: 19.9 },
  dreads: { crown: 13.9 },
  dreads02: { crown: 0 },
  fro: { crown: 0 },
  froBand: { crown: 0 },
  straight01: { crown: 15.1 },
  straight02: { crown: 18.1 },
  straightAndStrand: { crown: 18.1 },
  longButNotTooLong: { crown: 18.1 },
  miaWallace: { crown: 19.9 },
  frida: { trim: 10 },
};

// Hats scale around the head's centre (figure units); `crown` margin over the hair.
const HEAD_CENTRE_Y = 92;
const CROWN_MARGIN = 4;

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/** Find a balanced `<g …>…</g>` that starts with `open` in `svg`. */
function findGroup(svg, open) {
  const start = svg.indexOf(open);
  if (start < 0) throw new Error(`chef-avatar: Avataaars structure changed (${open} not found)`);
  const re = /<g\b[^>]*>|<\/g>/g;
  re.lastIndex = start;
  let depth = 0;
  let m;
  while ((m = re.exec(svg))) {
    depth += m[0] === '</g>' ? -1 : 1;
    if (depth === 0) return { start, end: re.lastIndex };
  }
  throw new Error('chef-avatar: unbalanced Avataaars output');
}

const splice = (svg, { start, end }, replacement) =>
  svg.slice(0, start) + replacement + svg.slice(end);

const color = (key, id) => AVATAR_COLORS[key].options.find((o) => o.id === id).hex;

let renderCount = 0;

/**
 * Draw an avatar as an SVG string.
 * @param {*} rawConfig - a config (normalised here, so partial or old configs are fine)
 * @param {Object} [options]
 * @param {string} [options.viewBox='0 0 280 280'] - crop, e.g. a part's `crop`
 * @param {number} [options.size] - width/height attributes; omitted = scales to its box
 * @param {string} [options.title] - accessible name; omitted = decorative (aria-hidden)
 * @returns {string}
 */
export function renderAvatarSvg(rawConfig, { viewBox = '0 0 280 280', size, title } = {}) {
  const { parts, colors } = normalizeAvatarConfig(rawConfig);
  const id = `ca${(renderCount = (renderCount + 1) % 1e6)}`;
  const accent = `#${color('outfit', colors.outfit)}`;
  const hat = HATS[parts.hat] ? HATS[parts.hat](accent) : null;
  const bg = color('background', colors.background);

  let svg = createAvatar(avataaars, {
    seed: 'chef',
    randomizeIds: true,
    style: ['default'],
    clothing: ['shirtCrewNeck'],
    top: [parts.hair === 'bald' ? 'shortFlat' : parts.hair],
    topProbability: parts.hair === 'bald' ? 0 : 100,
    hatColor: [color('outfit', colors.outfit)],
    hairColor: [color('hair', colors.hair)],
    facialHairColor: [color('hair', colors.hair)],
    skinColor: [color('skin', colors.skin)],
    eyes: [parts.eyes],
    eyebrows: [parts.brows],
    mouth: [parts.mouth],
    facialHair: [parts.facialHair === 'none' ? 'beardLight' : parts.facialHair],
    facialHairProbability: parts.facialHair === 'none' ? 0 : 100,
    accessories: [parts.glasses === 'none' ? 'round' : parts.glasses],
    accessoriesProbability: parts.glasses === 'none' ? 0 : 100,
    accessoriesColor: ['262e33'],
    ...(bg ? { backgroundColor: [bg] } : {}),
  }).toString();

  // Our outfit in place of the crew-neck shirt.
  svg = splice(
    svg,
    findGroup(svg, '<g transform="translate(0 170)">'),
    outfit(parts.outfit, accent, id),
  );

  if (hat) {
    const fit = HAT_FIT[parts.hair] || {};
    let grow = 1;
    if (hat.band) {
      // A headband sits on the hair: nothing to hide, nothing to cover.
    } else if (fit.crown != null) {
      // Scale the hat around the head's centre until its crown covers the hair's crown.
      const need = HEAD_CENTRE_Y - (fit.crown - CROWN_MARGIN);
      grow = Math.max(1, need / (HEAD_CENTRE_Y - hat.crown));
    } else {
      // Hair only below the hat's lower edge (the hat covers the cut).
      const bottom = hat.bottom + (fit.trim || 0);
      const top = findGroup(svg, '<g transform="translate(-1)">');
      svg = splice(
        svg,
        top,
        `<clipPath id="${id}-under-hat"><rect x="-40" y="${bottom - 6}" width="360" height="400"/></clipPath>` +
          `<g clip-path="url(#${id}-under-hat)">${svg.slice(top.start, top.end)}</g>`,
      );
    }
    // The hat goes last in the figure (over glasses and hair).
    const figure = findGroup(svg, '<g transform="translate(8)">');
    const at = figure.end - '</g>'.length;
    svg = splice(
      svg,
      { start: at, end: at },
      `<g transform="translate(${+(132 * (1 - grow)).toFixed(2)} ${+(HEAD_CENTRE_Y * (1 - grow)).toFixed(2)}) scale(${+grow.toFixed(3)})">${hatSvg(hat, id)}</g>`,
    );
  }

  // Scale the figure so tall hats and the outfit both fit.
  svg = svg.replace(
    '<g transform="translate(8)">',
    `<g transform="translate(${+SHIFT_X.toFixed(2)} ${+SHIFT_Y.toFixed(2)}) scale(${SCALE})">`,
  );

  // Our own root element: viewBox crop, size and accessible name.
  const inner = svg.slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>'));
  const sizeAttrs = size ? ` width="${size}" height="${size}"` : '';
  const a11y = title ? ` role="img" aria-label="${title}"` : ' aria-hidden="true"';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none"${sizeAttrs}${a11y}>${inner}</svg>`;
}
