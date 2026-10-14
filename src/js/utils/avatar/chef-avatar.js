/**
 * Chef avatars: the part catalogue and a pure SVG renderer.
 *
 * An avatar is a small config of part and colour ids, stored on `users/{uid}.avatarConfig`:
 *
 *   { v: 1,
 *     parts:  { face, hair, eyes, brows, mouth, facialHair, glasses, extras, hat, outfit },
 *     colors: { skin, hair, outfit, background } }
 *
 * Every value is an id from the catalogue below, so a config is easy to validate and easy
 * to produce from elsewhere (e.g. a future "match my photo" function asking a vision model
 * to pick one id per part — `describeAvatarSchema()` gives it the vocabulary).
 *
 * The drawing follows the stock chef avatars: a 64×64 grid, #343433 outlines at 1.5,
 * flat fills with one shade tone. No DOM access here — the output is an SVG string.
 */

export const AVATAR_CONFIG_VERSION = 1;

const INK = '#343433';
const LINE = `stroke="${INK}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"`;
const thin = (width = 1.1) =>
  `stroke="${INK}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"`;
const THIN = thin();

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

/** Colour palettes. `hex` is the fill, `shade` the darker tone used for shading. */
export const AVATAR_COLORS = {
  skin: {
    label: 'גוון עור',
    describe: 'skin tone, lightest to darkest',
    options: [
      { id: 'porcelain', label: 'בהיר מאוד', hex: '#f8e1d4', shade: '#ecc9b8' },
      { id: 'light', label: 'בהיר', hex: '#edccc3', shade: '#ddb3a7' },
      { id: 'tan', label: 'שזוף', hex: '#e2ad8a', shade: '#cf9874' },
      { id: 'olive', label: 'זית', hex: '#c88f63', shade: '#b37b51' },
      { id: 'brown', label: 'חום', hex: '#a86c4d', shade: '#925c40' },
      { id: 'deep', label: 'כהה', hex: '#6f4631', shade: '#5c3a28' },
    ],
  },
  hair: {
    label: 'צבע שיער',
    describe: 'hair, eyebrow and facial-hair colour',
    options: [
      { id: 'black', label: 'שחור', hex: '#2f2b28', shade: '#1f1c1a' },
      { id: 'darkBrown', label: 'חום כהה', hex: '#4b3226', shade: '#33221a' },
      { id: 'brown', label: 'חום', hex: '#80522f', shade: '#5f3c22' },
      { id: 'auburn', label: 'ערמוני', hex: '#a3472a', shade: '#7c341f' },
      { id: 'ginger', label: 'ג׳ינג׳י', hex: '#d0702f', shade: '#a85823' },
      { id: 'blonde', label: 'בלונד', hex: '#e3b55c', shade: '#b98c3c' },
      { id: 'grey', label: 'אפור', hex: '#a3a19c', shade: '#7c7a76' },
      { id: 'white', label: 'לבן', hex: '#ecebe6', shade: '#b9b7b1' },
    ],
  },
  outfit: {
    label: 'צבע בד',
    describe: 'accent colour of the apron, scarf or bandana',
    options: [
      { id: 'burgundy', label: 'בורדו', hex: '#b1304f', shade: '#8f2440' },
      { id: 'green', label: 'ירוק', hex: '#6a994e', shade: '#557d3e' },
      { id: 'red', label: 'אדום', hex: '#bc4749', shade: '#9a3a3c' },
      { id: 'navy', label: 'כחול', hex: '#36506f', shade: '#283d55' },
      { id: 'mustard', label: 'חרדל', hex: '#dfa43a', shade: '#bd8628' },
      { id: 'charcoal', label: 'פחם', hex: '#3d3c39', shade: '#2a2927' },
    ],
  },
  background: {
    label: 'רקע',
    describe: 'background circle colour',
    options: [
      { id: 'none', label: 'שקוף', hex: null },
      { id: 'cream', label: 'שמנת', hex: '#f2e8cf' },
      { id: 'sage', label: 'מרווה', hex: '#dce8cf' },
      { id: 'rose', label: 'ורוד', hex: '#f4dad6' },
      { id: 'sky', label: 'תכלת', hex: '#d8e6ef' },
      { id: 'butter', label: 'חמאה', hex: '#f8e4ae' },
    ],
  },
};

/**
 * Parts, in the order the builder shows them. `crop` is the viewBox the builder uses
 * for that part's option thumbnails (zoomed on the part).
 */
export const AVATAR_PARTS = {
  face: {
    label: 'פנים',
    describe: 'face shape',
    crop: '11 14 42 36',
    options: [
      { id: 'oval', label: 'אובלי', describe: 'oval face' },
      { id: 'round', label: 'עגול', describe: 'round, wide face' },
      { id: 'square', label: 'מרובע', describe: 'square jaw' },
      { id: 'long', label: 'מוארך', describe: 'long, narrow face' },
    ],
  },
  hair: {
    label: 'תסרוקת',
    describe: 'hairstyle',
    crop: '10 2 44 52',
    options: [
      { id: 'short', label: 'קצר', describe: 'short hair' },
      { id: 'side', label: 'שביל צד', describe: 'short hair with a side part' },
      { id: 'curly', label: 'מתולתל', describe: 'short curly hair' },
      { id: 'buzz', label: 'קצוץ', describe: 'buzz cut' },
      { id: 'bob', label: 'קארה', describe: 'chin-length bob with a fringe' },
      { id: 'long', label: 'ארוך', describe: 'long straight hair past the shoulders' },
      { id: 'bun', label: 'פקעת', describe: 'hair pulled up into a top bun' },
      { id: 'ponytail', label: 'קוקו', describe: 'hair tied back in a ponytail' },
      { id: 'bald', label: 'קרחת', describe: 'bald' },
    ],
  },
  eyes: {
    label: 'עיניים',
    describe: 'eyes',
    crop: '20 20 24 20',
    options: [
      { id: 'dots', label: 'נקודות', describe: 'simple dot eyes' },
      { id: 'round', label: 'גדולות', describe: 'big round open eyes' },
      { id: 'happy', label: 'שמחות', describe: 'closed, smiling eyes' },
      { id: 'lashes', label: 'ריסים', describe: 'dot eyes with eyelashes' },
      { id: 'sleepy', label: 'רדומות', describe: 'half-closed, relaxed eyes' },
      { id: 'wink', label: 'קריצה', describe: 'winking' },
    ],
  },
  brows: {
    label: 'גבות',
    describe: 'eyebrows',
    crop: '20 18 24 20',
    options: [
      { id: 'soft', label: 'רכות', describe: 'softly curved eyebrows' },
      { id: 'straight', label: 'ישרות', describe: 'straight eyebrows' },
      { id: 'arched', label: 'מקושתות', describe: 'high arched eyebrows' },
      { id: 'thick', label: 'עבות', describe: 'thick eyebrows' },
      { id: 'focused', label: 'מרוכזות', describe: 'eyebrows angled down, focused' },
    ],
  },
  mouth: {
    label: 'פה',
    describe: 'mouth',
    crop: '20 26 24 20',
    options: [
      { id: 'smile', label: 'חיוך', describe: 'closed smile' },
      { id: 'grin', label: 'חיוך רחב', describe: 'open smile showing teeth' },
      { id: 'laugh', label: 'צחוק', describe: 'open laughing mouth' },
      { id: 'yum', label: 'טעים', describe: 'smile with the tongue out, tasting' },
      { id: 'smirk', label: 'חצי חיוך', describe: 'lopsided smirk' },
      { id: 'neutral', label: 'רציני', describe: 'straight, neutral mouth' },
    ],
  },
  facialHair: {
    label: 'זקן ושפם',
    describe: 'facial hair',
    crop: '14 22 36 30',
    options: [
      { id: 'none', label: 'ללא', describe: 'clean shaven' },
      { id: 'mustache', label: 'שפם מסולסל', describe: 'curled handlebar mustache' },
      { id: 'chevron', label: 'שפם', describe: 'thick straight mustache' },
      { id: 'beard', label: 'זקן מלא', describe: 'full beard' },
      { id: 'goatee', label: 'זקנקן', describe: 'goatee' },
      { id: 'stubble', label: 'זיפים', describe: 'light stubble' },
    ],
  },
  glasses: {
    label: 'משקפיים',
    describe: 'glasses',
    crop: '14 18 36 26',
    options: [
      { id: 'none', label: 'ללא', describe: 'no glasses' },
      { id: 'round', label: 'עגולים', describe: 'round glasses' },
      { id: 'square', label: 'מרובעים', describe: 'rectangular glasses' },
    ],
  },
  extras: {
    label: 'פרטים',
    describe: 'cheek details',
    crop: '14 18 36 30',
    options: [
      { id: 'none', label: 'ללא', describe: 'nothing' },
      { id: 'blush', label: 'סומק', describe: 'rosy cheeks' },
      { id: 'freckles', label: 'נמשים', describe: 'freckles' },
    ],
  },
  hat: {
    label: 'כובע',
    describe: 'headwear',
    crop: '6 0 52 52',
    options: [
      { id: 'toque', label: 'כובע שף', describe: 'tall pleated chef toque' },
      { id: 'cap', label: 'כובע שף נמוך', describe: 'short pleated chef cap' },
      { id: 'bandana', label: 'בנדנה', describe: 'polka-dot bandana tied at the side' },
      { id: 'beanie', label: 'כיפת מטבח', describe: 'snug kitchen skull cap' },
      { id: 'none', label: 'בלי כובע', describe: 'no hat' },
    ],
  },
  outfit: {
    label: 'מדים',
    describe: 'kitchen outfit',
    crop: '0 30 64 34',
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
    face: 'oval',
    hair: 'short',
    eyes: 'dots',
    brows: 'soft',
    mouth: 'smile',
    facialHair: 'none',
    glasses: 'none',
    extras: 'blush',
    hat: 'toque',
    outfit: 'apron',
  }),
  colors: Object.freeze({ skin: 'light', hair: 'brown', outfit: 'burgundy', background: 'cream' }),
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
 * A random config. Facial hair and glasses are rarer than "none", so random avatars
 * don't all look alike.
 * @param {() => number} [random=Math.random]
 */
export function randomAvatarConfig(random = Math.random) {
  const pick = (list) => list[Math.floor(random() * list.length)].id;
  const config = { v: AVATAR_CONFIG_VERSION, parts: {}, colors: {} };
  for (const [key, part] of Object.entries(AVATAR_PARTS)) {
    const rare = ['facialHair', 'glasses', 'extras'].includes(key);
    config.parts[key] = rare && random() < 0.55 ? 'none' : pick(part.options);
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
// Drawing
// ---------------------------------------------------------------------------

const color = (key, id) => AVATAR_COLORS[key].options.find((o) => o.id === id);

/**
 * Several shapes drawn as one outlined blob: each shape is stroked at double width,
 * then all are filled again on top, which hides the inner outlines.
 */
function blob(shapes, fill, extra = '') {
  const stroked = shapes.map((s) =>
    s.replace('/>', ` fill="${fill}" stroke="${INK}" stroke-width="3"/>`),
  );
  const filled = shapes.map((s) => s.replace('/>', ` fill="${fill}"/>`));
  return `<g ${extra}>${stroked.join('')}${filled.join('')}</g>`;
}

// Face geometry per shape: half-width, chin y, and the outline path.
const FACES = {
  oval: {
    hw: 11,
    chin: 44,
    d: 'M32,13.5 C38.6,13.5 43,17.6 43,24 L43,33 C43,38.8 38,44 32,44 C26,44 21,38.8 21,33 L21,24 C21,17.6 25.4,13.5 32,13.5 Z',
  },
  round: {
    hw: 12,
    chin: 43.5,
    d: 'M32,13.5 C39.2,13.5 44,18 44,25.5 L44,31.5 C44,38.6 38.6,43.5 32,43.5 C25.4,43.5 20,38.6 20,31.5 L20,25.5 C20,18 24.8,13.5 32,13.5 Z',
  },
  square: {
    hw: 11.2,
    chin: 44.2,
    d: 'M32,13.5 C38.8,13.5 43.2,17.4 43.2,23.8 L43.2,36 C43.2,38.8 41.6,40.6 38.4,42.4 L35.2,43.8 Q32,44.6 28.8,43.8 L25.6,42.4 C22.4,40.6 20.8,38.8 20.8,36 L20.8,23.8 C20.8,17.4 25.2,13.5 32,13.5 Z',
  },
  long: {
    hw: 10.2,
    chin: 45.2,
    d: 'M32,13 C38.2,13 42.2,17 42.2,23.5 L42.2,34 C42.2,40 37.6,45.2 32,45.2 C26.4,45.2 21.8,40 21.8,34 L21.8,23.5 C21.8,17 25.8,13 32,13 Z',
  },
};

// Hair pieces: `back` goes behind the head (and over the shoulders), `front` over the
// forehead. Built per face so the sides hug the face width.
function hairLayers(style, face, c, underHat) {
  const L = 32 - face.hw;
  const R = 32 + face.hw;
  const fill = c.hex;
  const cap = (bottom) =>
    `<path d="M${L - 0.6},${bottom} C${L - 1.4},18 ${L + 4},12.2 32,12.2 C${R - 4},12.2 ${R + 1.4},18 ${R + 0.6},${bottom} L${R - 0.6},${bottom} C${R - 1.4},23 ${R - 2.6},21 ${R - 4.6},20 C${R - 8},21.6 ${L + 8.5},21.8 ${L + 4.8},19.6 C${L + 2.6},21 ${L + 1.4},23.5 ${L + 0.6},${bottom} Z" fill="${fill}" ${LINE}/>`;

  // Long styles: the fringe is filled up to the back piece's crown (so the crown has one
  // outline) and only the hairline is stroked.
  const crownTop = `M${L - 1.6},27 C${L - 2.6},16 ${L + 3.6},11.5 32,11.5 C${R - 3.6},11.5 ${R + 2.6},16 ${R + 1.6},27`;
  const crownWith = (hairline) =>
    `<path d="${crownTop} ${hairline} Z" fill="${fill}"/><path d="M${hairline.slice(1)}" fill="none" ${LINE}/>`;

  switch (style) {
    case 'bald':
      return {
        back: '',
        front: `<path d="M27,16.2 Q29.5,15 32,15.2" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.2" stroke-linecap="round"/>`,
      };
    case 'buzz':
      return {
        back: '',
        front: `<path d="M${L},25.5 C${L - 0.4},17.4 ${L + 4.6},13 32,13 C${R - 4.6},13 ${R + 0.4},17.4 ${R},25.5 C${R - 1.6},21.4 ${R - 5},19.8 32,19.8 C${L + 5},19.8 ${L + 1.6},21.4 ${L},25.5 Z" fill="${fill}" fill-opacity=".85" ${THIN}/>`,
      };
    case 'short':
      return { back: '', front: cap(27.5) };
    case 'side':
      return {
        back: '',
        front: `<path d="M${L - 0.6},28 C${L - 1.6},17 ${L + 4},12 32.5,12 C${R - 3},12 ${R + 1.6},17.5 ${R + 0.6},28 L${R - 0.6},28 C${R - 0.8},24 ${R - 1.8},21.8 ${R - 3},20.8 C${R - 8},22.6 ${L + 9},21.4 ${L + 6.2},18.4 C${L + 3.6},21.4 ${L + 1.6},23.6 ${L + 0.6},28 Z" fill="${fill}" ${LINE}/><path d="M34,12.8 Q31.5,16.2 ${L + 6.2},18.4" fill="none" stroke="${c.shade}" stroke-width="1.1" stroke-linecap="round"/>`,
      };
    case 'curly': {
      const curls = [];
      for (let i = 0; i <= 8; i++) {
        if (underHat && i > 1 && i < 7) continue;
        const a = Math.PI * (1 - i / 8);
        const x = 32 + (face.hw + 0.6) * Math.cos(a);
        const y = 22 - 9.2 * Math.sin(a);
        curls.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3.6"/>`);
      }
      curls.push(
        `<circle cx="${(L - 0.2).toFixed(2)}" cy="26.2" r="2.6"/>`,
        `<circle cx="${(R + 0.2).toFixed(2)}" cy="26.2" r="2.6"/>`,
      );
      return { back: '', front: blob(curls, fill) };
    }
    case 'bob':
      return {
        back: `<path d="M${L - 1.6},27 C${L - 2.6},16 ${L + 3.6},11.5 32,11.5 C${R - 3.6},11.5 ${R + 2.6},16 ${R + 1.6},27 L${R + 2.2},38.6 C${R + 2.2},40.2 ${R + 1},40.8 ${R - 0.4},40.6 L${L + 0.4},40.6 C${L - 1},40.8 ${L - 2.2},40.2 ${L - 2.2},38.6 Z" fill="${fill}" ${LINE}/>`,
        front: crownWith(
          `L${R - 0.2},26 C${R - 3},24.5 ${R - 6},22 ${R - 7.5},19.6 C${R - 10.5},22.6 ${L + 6},24.6 ${L + 0.2},26`,
        ),
      };
    case 'long':
      return {
        back: `<path d="M${L - 1.6},27 C${L - 2.6},16 ${L + 3.6},11.5 32,11.5 C${R - 3.6},11.5 ${R + 2.6},16 ${R + 1.6},27 L${R + 3},48.5 C${R + 3},50.4 ${R + 1.6},51.2 ${R - 0.4},50.8 L${L + 0.4},50.8 C${L - 1.6},51.2 ${L - 3},50.4 ${L - 3},48.5 Z" fill="${fill}" ${LINE}/>`,
        front: crownWith(
          `L${R - 0.2},31 C${R - 1.4},24.6 ${R - 4},20 32,17.6 C${L + 4},20 ${L + 1.4},24.6 ${L + 0.2},31`,
        ),
      };
    case 'bun':
    case 'ponytail': {
      const front = `<path d="M${L - 0.2},27 C${L - 1},17.6 ${L + 4},12.8 32,12.8 C${R - 4},12.8 ${R + 1},17.6 ${R + 0.2},27 C${R - 0.6},22 ${R - 3.6},18.8 32,18.6 C${L + 3.6},18.8 ${L + 0.6},22 ${L - 0.2},27 Z" fill="${fill}" ${LINE}/><path d="M28,14.2 Q30,17 32,18.4 M36,14.2 Q34,17 32,18.4" fill="none" stroke="${c.shade}" stroke-width=".9" stroke-linecap="round"/>`;
      const back =
        style === 'bun'
          ? `<circle cx="32" cy="9.6" r="4.6" fill="${fill}" ${LINE}/><path d="M29.4,8.6 Q32,6.8 34.6,8.6" fill="none" stroke="${c.shade}" stroke-width=".9" stroke-linecap="round"/>`
          : `<path d="M${R - 1},17 C${R + 6},17.6 ${R + 7.6},24 ${R + 6},33.5 C${R + 5.2},37.6 ${R + 3.6},40 ${R + 2.2},41 C${R + 3},35.4 ${R + 2.6},26.6 ${R - 1.4},21 Z" fill="${fill}" ${LINE}/>`;
      return { back, front };
    }
    default:
      return { back: '', front: '' };
  }
}

function eyes(style) {
  const dot = (x) => `<circle cx="${x}" cy="30" r="1.05" fill="${INK}"/>`;
  const arc = (x) =>
    `<path d="M${x - 1.6},30.6 Q${x},28.6 ${x + 1.6},30.6" fill="none" ${thin(1.3)}/>`;
  switch (style) {
    case 'round':
      return [27.5, 36.5]
        .map(
          (x) =>
            `<ellipse cx="${x}" cy="29.9" rx="1.9" ry="2.1" fill="#fff" stroke="${INK}" stroke-width=".9"/><circle cx="${x + 0.25}" cy="30.2" r="1.05" fill="${INK}"/>`,
        )
        .join('');
    case 'happy':
      return arc(27.5) + arc(36.5);
    case 'lashes':
      return (
        dot(27.5) +
        dot(36.5) +
        `<path d="M26.2,29.2 L25.1,28.4 M37.8,29.2 L38.9,28.4" fill="none" stroke="${INK}" stroke-width=".9" stroke-linecap="round"/>`
      );
    case 'sleepy':
      return [27.5, 36.5]
        .map(
          (x) =>
            `<path d="M${x - 1.6},29.6 L${x + 1.6},29.6" ${THIN}/><path d="M${x - 1.2},29.8 Q${x},31.4 ${x + 1.2},29.8 Z" fill="${INK}"/>`,
        )
        .join('');
    case 'wink':
      return dot(27.5) + arc(36.5);
    default:
      return dot(27.5) + dot(36.5);
  }
}

function brows(style, c) {
  const mirror = (d) =>
    `<path d="${d}" fill="none" stroke="${c}" stroke-width="${style === 'thick' ? 1.9 : 1.2}" stroke-linecap="round"/>`;
  const pair = (l, r) => mirror(l) + mirror(r);
  switch (style) {
    case 'straight':
      return pair('M25.4,26.6 L29.6,26.6', 'M34.4,26.6 L38.6,26.6');
    case 'arched':
      return pair('M25.3,27.2 Q26.8,24.8 29.6,26.2', 'M34.4,26.2 Q37.2,24.8 38.7,27.2');
    case 'focused':
      return pair('M25.4,25.8 L29.6,27', 'M34.4,27 L38.6,25.8');
    default: // soft, thick
      return pair('M25.4,27 Q27.5,25.6 29.6,26.6', 'M34.4,26.6 Q36.5,25.6 38.6,27');
  }
}

function mouth(style) {
  const tongue = '#e7787a';
  const inside = '#7a2b2e';
  switch (style) {
    case 'grin':
      return `<path d="M28.4,37.7 Q32,38.2 35.6,37.7 Q35.1,41.6 32,41.6 Q28.9,41.6 28.4,37.7 Z" fill="${inside}" ${THIN}/><path d="M28.9,38.2 Q32,38.6 35.1,38.2 L34.9,39.2 Q32,39.6 29.1,39.2 Z" fill="#fff"/>`;
    case 'laugh':
      return `<path d="M27.8,37.4 Q32,38 36.2,37.4 Q35.8,42.8 32,42.8 Q28.2,42.8 27.8,37.4 Z" fill="${inside}" ${THIN}/><path d="M29.4,41.4 Q32,39.4 34.6,41.4 Q33.4,42.6 32,42.6 Q30.6,42.6 29.4,41.4 Z" fill="${tongue}"/>`;
    case 'yum':
      return `<path d="M31,38.9 Q30.9,41.8 32.6,41.8 Q34.3,41.8 34.2,38.6 Z" fill="${tongue}" stroke="${INK}" stroke-width=".9" stroke-linejoin="round"/><path d="M28.6,37.6 Q32,40.4 35.4,37.6" fill="none" ${thin(1.25)}/>`;
    case 'smirk':
      return `<path d="M29.2,38.9 Q32.6,39.8 35.2,37.4" fill="none" ${thin(1.25)}/>`;
    case 'neutral':
      return `<path d="M29.6,38.8 L34.4,38.8" fill="none" ${thin(1.25)}/>`;
    default:
      return `<path d="M28.8,37.8 Q32,40.8 35.2,37.8" fill="none" ${thin(1.25)}/>`;
  }
}

function facialHair(style, face, c) {
  const L = 32 - face.hw;
  const R = 32 + face.hw;
  const beard = `M${L},30.5 C${L},39 ${L + 4.4},${face.chin + 2.6} 32,${face.chin + 2.6} C${R - 4.4},${face.chin + 2.6} ${R},39 ${R},30.5 L${R - 1.4},30.5 C${R - 1.8},34.6 ${R - 3.6},36 ${R - 6},36.6 C${R - 7.6},35.4 33.6,35.2 32,36 C30.4,35.2 ${L + 7.6},35.4 ${L + 6},36.6 C${L + 3.6},36 ${L + 1.8},34.6 ${L + 1.4},30.5 Z M28.2,39.2 a3.8,2.9 0 1 0 7.6,0 a3.8,2.9 0 1 0 -7.6,0 Z`;
  switch (style) {
    case 'mustache':
      return `<path d="M32,35.6 C30.5,34.6 28.4,34.8 27.3,36.1 C26.7,36.9 25.6,36.8 25.6,35.9 C25,37.4 26.6,38.4 28.2,37.9 C29.6,37.4 30.9,36.8 32,36.4 C33.1,36.8 34.4,37.4 35.8,37.9 C37.4,38.4 39,37.4 38.4,35.9 C38.4,36.8 37.3,36.9 36.7,36.1 C35.6,34.8 33.5,34.6 32,35.6 Z" fill="${c.hex}" stroke="${INK}" stroke-width=".8" stroke-linejoin="round"/>`;
    case 'chevron':
      return `<path d="M27.4,36.6 Q32,33.6 36.6,36.6 Q36.9,37.8 35.7,37.6 Q32,36.2 28.3,37.6 Q27.1,37.8 27.4,36.6 Z" fill="${c.hex}" stroke="${INK}" stroke-width=".9" stroke-linejoin="round"/>`;
    case 'beard':
      return `<path d="${beard}" fill="${c.hex}" fill-rule="evenodd" ${LINE}/>`;
    case 'goatee':
      return `<path d="M29.4,41.6 Q32,40.9 34.6,41.6 Q34.6,45.4 32,46 Q29.4,45.4 29.4,41.6 Z" fill="${c.hex}" stroke="${INK}" stroke-width="1" stroke-linejoin="round"/><path d="M28.6,36.8 Q32,35.2 35.4,36.8" fill="none" stroke="${c.hex}" stroke-width="1.4" stroke-linecap="round"/>`;
    case 'stubble':
      return `<path d="${beard}" fill="${c.shade}" fill-opacity=".2" fill-rule="evenodd"/>`;
    default:
      return '';
  }
}

function glasses(style, face) {
  const L = 32 - face.hw;
  const R = 32 + face.hw;
  const lens = 'fill="#fff" fill-opacity=".3"';
  const arms = `<path d="M${style === 'round' ? 24.5 : 24.3},29.4 L${L + 0.2},28.6 M${style === 'round' ? 39.5 : 39.7},29.4 L${R - 0.2},28.6" fill="none" ${THIN}/>`;
  if (style === 'round') {
    return `${arms}<circle cx="27.5" cy="30" r="3" ${lens} ${THIN}/><circle cx="36.5" cy="30" r="3" ${lens} ${THIN}/><path d="M30.5,29.6 Q32,28.7 33.5,29.6" fill="none" ${THIN}/>`;
  }
  if (style === 'square') {
    return `${arms}<rect x="24.3" y="27.7" width="6.4" height="4.8" rx="1.2" ${lens} ${THIN}/><rect x="33.3" y="27.7" width="6.4" height="4.8" rx="1.2" ${lens} ${THIN}/><path d="M30.7,29.4 Q32,28.6 33.3,29.4" fill="none" ${THIN}/>`;
  }
  return '';
}

function extras(style) {
  if (style === 'blush') {
    return '<ellipse cx="25" cy="34.4" rx="1.9" ry="1.1" fill="#f08f8f" fill-opacity=".5"/><ellipse cx="39" cy="34.4" rx="1.9" ry="1.1" fill="#f08f8f" fill-opacity=".5"/>';
  }
  if (style === 'freckles') {
    const dots = [
      [24.2, 33.6],
      [25.8, 34.4],
      [25, 35.4],
      [26.6, 33.2],
      [39.8, 33.6],
      [38.2, 34.4],
      [39, 35.4],
      [37.4, 33.2],
    ];
    return dots.map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".45" fill="#a5654a"/>`).join('');
  }
  return '';
}

function hat(style, outfit, id) {
  const pleats = (y1, y2) =>
    [26, 32, 38]
      .map(
        (x) =>
          `<line x1="${x}" x2="${x}" y1="${y1}" y2="${y2}" stroke="#cdcccb" stroke-width="1.5" stroke-linecap="round"/>`,
      )
      .join('');
  switch (style) {
    case 'toque':
      return (
        blob(
          [
            '<circle cx="22.4" cy="12.6" r="5.6"/>',
            '<circle cx="32" cy="8.4" r="7"/>',
            '<circle cx="41.6" cy="12.6" r="5.6"/>',
            '<rect x="21" y="13" width="22" height="11.8"/>',
          ],
          '#fff',
        ) +
        `<path d="M40.2,7.6 C44.6,8.6 47.6,12.6 45.6,16.6 C44.6,18.4 43,18.8 43,18.8 L39.4,18.8 C41.6,15.4 42,10.4 40.2,7.6 Z" fill="#eee"/>` +
        `<line x1="21" x2="43" y1="17.4" y2="17.4" stroke="${INK}" stroke-width="1.2"/>` +
        pleats(19.6, 22.6)
      );
    case 'cap':
      return (
        `<path d="M20.4,24.8 L20.4,15.6 C20.4,11.6 25,9.6 32,9.6 C39,9.6 43.6,11.6 43.6,15.6 L43.6,24.8 Z" fill="#fff" ${LINE}/>` +
        `<path d="M38.6,10.2 C42,11 43.6,12.6 43.6,15.6 L43.6,24.1 L40.2,24.1 L40.2,13.4 Z" fill="#eee"/>` +
        `<path d="M20.4,15.8 Q32,13 43.6,15.8" fill="none" stroke="${INK}" stroke-width="1.2"/>` +
        pleats(18.4, 22.4)
      );
    case 'bandana':
      return (
        `<path d="M44,20.6 L49.6,17.6 Q50.6,21.2 48.6,22.6 L50.4,26.6 Q47.6,27.2 45.2,23.6 Z" fill="${outfit.hex}" ${LINE}/>` +
        `<path d="M20.2,24.8 C19.8,16.6 25,12 32,12 C39,12 44.2,16.6 43.8,24.8 Z" fill="${outfit.hex}" ${LINE}/>` +
        `<path d="M20.2,24.8 C25,23 39,23 43.8,24.8" fill="none" stroke="${outfit.shade}" stroke-width="1.2"/>` +
        [
          [26, 17],
          [32, 15],
          [38, 17],
          [29, 20.6],
          [35, 20.6],
          [23.4, 21.4],
          [40.6, 21.4],
          [32, 19.4],
        ]
          .map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".95" fill="#fff" fill-opacity=".9"/>`)
          .join('')
      );
    case 'beanie':
      return (
        `<clipPath id="${id}-beanie"><path d="M20.2,24.8 C19.8,15.4 25,11.2 32,11.2 C39,11.2 44.2,15.4 43.8,24.8 Z"/></clipPath>` +
        `<path d="M20.2,24.8 C19.8,15.4 25,11.2 32,11.2 C39,11.2 44.2,15.4 43.8,24.8 Z" fill="#fff"/>` +
        `<path d="M37,11.6 C41.6,12.8 44,15.6 44,20.6 L40,20.6 C40.2,17 39.2,13.6 37,11.6 Z" fill="#eee" clip-path="url(#${id}-beanie)"/>` +
        `<path d="M20.2,24.8 C19.8,15.4 25,11.2 32,11.2 C39,11.2 44.2,15.4 43.8,24.8 Z" fill="none" ${LINE}/>` +
        `<rect x="19.6" y="20.4" width="24.8" height="4.8" rx="2.2" fill="#fff" ${LINE}/>`
      );
    default:
      return '';
  }
}

// Shoulders: the bust ends in a shallow arc, as in the stock avatars.
const BODY =
  'M6.8,58.2 L7.1,56 C7.4,53.8 9.1,52.4 11.5,51.4 L24.6,46 Q32,50.4 39.4,46 L52.5,51.4 C54.9,52.4 56.6,53.8 56.9,56 L57.2,58.2 A62,62 0 0 1 6.8,58.2 Z';

function outfit(style, accent, id) {
  const clip = `<clipPath id="${id}-body"><path d="${BODY}"/></clipPath>`;
  const shade = '<path d="M0,53.6 Q32,58 64,53.6 L64,64 L0,64 Z" fill="#ececec"/>';
  let inner = '';
  let over = '';
  switch (style) {
    case 'jacket':
      inner =
        `<rect x="0" y="40" width="64" height="24" fill="#fff"/>${shade}` +
        `<path d="M26.6,46.6 L37.6,51 L37.6,64" fill="none" ${LINE}/>` +
        [
          [28, 51.6],
          [28, 56.6],
          [41.6, 51.6],
          [41.6, 56.6],
        ]
          .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1" fill="${INK}"/>`)
          .join('');
      over = `<path d="M26.4,45.2 Q32,49.6 37.6,45.2 L35.2,50 Q32,51.4 28.8,50 Z" fill="${accent.hex}" ${LINE}/>`;
      break;
    case 'apron':
      inner =
        `<rect x="0" y="40" width="64" height="24" fill="#fff"/>${shade}` +
        `<path d="M19,47.2 L24.6,45.2 Q32,50.6 39.4,45.2 L45,47.2 L45,64 L19,64 Z" fill="${accent.hex}" ${LINE}/>` +
        [
          [28, 52.4],
          [28, 57.6],
          [36, 52.4],
          [36, 57.6],
        ]
          .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1" fill="#fff"/>`)
          .join('');
      break;
    case 'tee':
      inner =
        `<rect x="0" y="40" width="64" height="24" fill="${accent.hex}"/><path d="M0,53.6 Q32,58 64,53.6 L64,64 L0,64 Z" fill="${accent.shade}"/>` +
        `<path d="M23,64 L23,52 Q32,53.6 41,52 L41,64 Z" fill="#fff" ${LINE}/>` +
        `<path d="M23.6,52.2 L26.4,46.8 M40.4,52.2 L37.6,46.8" fill="none" ${LINE}/>` +
        `<path d="M28,57 Q32,58 36,57" fill="none" stroke="#cdcccb" stroke-width="1.2" stroke-linecap="round"/>`;
      break;
    case 'stripes':
      inner =
        `<rect x="0" y="40" width="64" height="24" fill="#fff"/>${shade}` +
        `<clipPath id="${id}-bib"><path d="M21,47 L25.4,45.4 Q32,50.6 38.6,45.4 L43,47 L43,64 L21,64 Z"/></clipPath>` +
        `<g clip-path="url(#${id}-bib)"><rect x="20" y="44" width="24" height="20" fill="#fff"/>` +
        [22.6, 27.4, 32.2, 37, 41.8]
          .map((x) => `<rect x="${x}" y="44" width="2.4" height="20" fill="${accent.hex}"/>`)
          .join('') +
        `</g><path d="M21,47 L25.4,45.4 Q32,50.6 38.6,45.4 L43,47 L43,64" fill="none" ${LINE}/><path d="M21,47 L21,64" fill="none" ${LINE}/>`;
      break;
  }
  return {
    body: `${clip}<g clip-path="url(#${id}-body)">${inner}</g><path d="${BODY}" fill="none" ${LINE}/>`,
    over,
  };
}

let renderCount = 0;

/**
 * Draw an avatar as an SVG string.
 * @param {*} rawConfig - a config (normalised here, so partial or old configs are fine)
 * @param {Object} [options]
 * @param {string} [options.viewBox='0 0 64 64'] - crop, e.g. a part's `crop`
 * @param {number} [options.size] - width/height attributes; omitted = scales to its box
 * @param {string} [options.title] - accessible name; omitted = decorative (aria-hidden)
 * @returns {string}
 */
export function renderAvatarSvg(rawConfig, { viewBox = '0 0 64 64', size, title } = {}) {
  const { parts, colors } = normalizeAvatarConfig(rawConfig);
  const id = `ca${(renderCount = (renderCount + 1) % 1e6)}`;
  const skin = color('skin', colors.skin);
  const hairColor = color('hair', colors.hair);
  const accent = color('outfit', colors.outfit);
  const bg = color('background', colors.background);
  const face = FACES[parts.face];
  const L = 32 - face.hw;
  const R = 32 + face.hw;

  let hair = hairLayers(parts.hair, face, hairColor, parts.hat !== 'none');
  const clothes = outfit(parts.outfit, accent, id);
  if (parts.hat !== 'none' && parts.hair === 'bun') hair = { ...hair, back: '' }; // under the hat

  const svg = [
    bg.hex ? `<circle cx="32" cy="32" r="32" fill="${bg.hex}"/>` : '',
    clothes.body,
    hair.back,
    // neck
    `<path d="M27,37 L27,46.4 Q32,49.6 37,46.4 L37,37 Z" fill="${skin.shade}" ${LINE}/>`,
    clothes.over,
    // ears
    `<ellipse cx="${L - 0.2}" cy="30" rx="2.4" ry="3.4" fill="${skin.hex}" ${LINE}/>`,
    `<ellipse cx="${R + 0.2}" cy="30" rx="2.4" ry="3.4" fill="${skin.hex}" ${LINE}/>`,
    // face with a soft shade on its right side
    `<clipPath id="${id}-face"><path d="${face.d}"/></clipPath>`,
    `<path d="${face.d}" fill="${skin.hex}"/>`,
    `<path d="M35,10 C${R + 2},14 ${R + 2},40 34,48 L64,48 L64,10 Z" fill="${skin.shade}" fill-opacity=".45" clip-path="url(#${id}-face)"/>`,
    `<path d="${face.d}" fill="none" ${LINE}/>`,
    extras(parts.extras),
    `<path d="M31.4,31.8 Q30.6,33.9 32,34.1 Q33,34.2 33.3,33.6" fill="none" stroke="${skin.shade}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>`,
    mouth(parts.mouth),
    eyes(parts.eyes),
    facialHair(parts.facialHair, face, hairColor),
    brows(parts.brows, hairColor.shade === '#b9b7b1' ? '#8c8a85' : hairColor.shade),
    hair.front,
    glasses(parts.glasses, face),
    hat(parts.hat, accent, id),
  ].join('');

  const sizeAttrs = size ? ` width="${size}" height="${size}"` : '';
  const a11y = title ? ` role="img" aria-label="${title}"` : ' aria-hidden="true"';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${sizeAttrs}${a11y}>${svg}</svg>`;
}
