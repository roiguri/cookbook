export type GameKey =
  'memory' | 'burger' | 'pizza' | 'knife' | 'chef-says' | 'pancake' | 'garden' | 'cake';

export type FillerGameKey = 'memory' | 'burger';

export type PreferredOrientation = 'portrait' | 'landscape' | null;

export type HapticStyle = 'light' | 'medium' | 'success' | 'error';

export interface GameCatalogEntry {
  key: GameKey;
  name: string;
  icon: string;
  description: string;
  defaultConfig: Record<string, unknown>;
  successMessage: string;
  loadingText: string;
  preferredOrientation: PreferredOrientation;
  excludeFromRandom: boolean;
  supportsNativePause: boolean;
}

export type WebViewToNativeMessage =
  | { type: 'host-booted' }
  | { type: 'ready'; gameKey: GameKey; preferredOrientation: PreferredOrientation }
  | { type: 'haptic'; style: HapticStyle }
  | { type: 'complete'; elapsedMs: number }
  | { type: 'gameover'; reason: string }
  | { type: 'close' }
  | { type: 'error'; message: string };

export type NativeToWebViewMessage =
  | { type: 'launch'; gameKey: GameKey; config?: Record<string, unknown> }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'restart' }
  | { type: 'markAsyncReady' };

export const GAMES_CATALOG: readonly GameCatalogEntry[] = [
  {
    key: 'memory',
    name: 'משחק זיכרון',
    icon: '🧠',
    description: 'מצאו את הזוגות',
    defaultConfig: { rows: 3 },
    successMessage: 'כל הכבוד! הזיכרון שלך חד!',
    loadingText: 'זה עשוי לקחת מספר שניות... הנה משחק קטן בינתיים!',
    preferredOrientation: null,
    excludeFromRandom: false,
    supportsNativePause: false,
  },
  {
    key: 'burger',
    name: 'מגדל ההמבורגר',
    icon: '🍔',
    description: 'תפסו את המרכיבים והרכיבו המבורגר',
    defaultConfig: { targetHeight: 5 },
    successMessage: 'כל הכבוד! ההמבוגר מוכן',
    loadingText: 'מכין את המטבח... תפוס את המרכיבים!',
    preferredOrientation: 'portrait',
    excludeFromRandom: false,
    supportsNativePause: false,
  },
  {
    key: 'pizza',
    name: 'הפיצריה',
    icon: '🍕',
    description: 'הרכיבו פיצות לפי ההזמנה',
    defaultConfig: { ordersToWin: 10 },
    successMessage: 'כל הכבוד! משלוחים הושלמו',
    loadingText: 'מחממים את התנור... תפסו הזמנות בינתיים!',
    preferredOrientation: 'landscape',
    excludeFromRandom: true,
    supportsNativePause: false,
  },
  {
    key: 'knife',
    name: 'אמנות הסכין',
    icon: '🔪',
    description: 'חתכו את הפירות, היזהרו מהמכשולים',
    defaultConfig: { toSlice: 30, maxStrikes: 3 },
    successMessage: 'כל הכבוד! חיתוך מושלם',
    loadingText: 'משחיזים את הסכינים... חכה רגע!',
    preferredOrientation: 'portrait',
    excludeFromRandom: true,
    supportsNativePause: false,
  },
  {
    key: 'chef-says',
    name: 'השף אומר',
    icon: '👨‍🍳',
    description: 'זכרו את סדר המרכיבים',
    defaultConfig: { roundsToWin: 10 },
    successMessage: 'כל הכבוד! זיכרון של שף',
    loadingText: 'השף מתכונן... חכה רגע!',
    preferredOrientation: null,
    excludeFromRandom: true,
    supportsNativePause: false,
  },
  {
    key: 'pancake',
    name: 'מחבת הפנקייקים',
    icon: '🥞',
    description: 'הפכו והגישו בדיוק בזמן',
    defaultConfig: { toServe: 10, maxStrikes: 3 },
    successMessage: 'כל הכבוד! ערימת פנקייקים מושלמת',
    loadingText: 'מחממים את המחבת... חכה רגע!',
    preferredOrientation: 'portrait',
    excludeFromRandom: true,
    supportsNativePause: true,
  },
  {
    key: 'garden',
    name: 'קציר בגינה',
    icon: '🥕',
    description: 'קטפו ירקות, היזהרו מתולעים',
    defaultConfig: { toHarvest: 20, maxStrikes: 3 },
    successMessage: 'כל הכבוד! סל מלא ירקות',
    loadingText: 'משקים את הגינה... חכה רגע!',
    preferredOrientation: 'portrait',
    excludeFromRandom: true,
    supportsNativePause: true,
  },
  {
    key: 'cake',
    name: 'עוגת שכבות',
    icon: '🎂',
    description: 'בנו עוגה גבוהה, שכבה אחר שכבה',
    defaultConfig: { toStack: 20 },
    successMessage: 'כל הכבוד! עוגה מושלמת',
    loadingText: 'אופים שכבות... חכה רגע!',
    preferredOrientation: 'portrait',
    excludeFromRandom: true,
    supportsNativePause: true,
  },
] as const;

export const FILLER_GAME_KEYS: readonly FillerGameKey[] = ['memory', 'burger'] as const;

const CATALOG_MAP = new Map<GameKey, GameCatalogEntry>(
  GAMES_CATALOG.map((entry) => [entry.key, entry]),
);

export function isGameKey(value: string): value is GameKey {
  return CATALOG_MAP.has(value as GameKey);
}

export function getGameEntry(key: GameKey): GameCatalogEntry {
  const entry = CATALOG_MAP.get(key);
  if (!entry) {
    throw new Error(`Unknown mini-game key: ${key}`);
  }
  return entry;
}

/**
 * Picks randomly strictly from non-excluded filler games (`memory` | `burger`).
 * Mirrors `GameWrapper.random()` in `src/lib/games/game_wrapper.js`.
 */
export function pickRandomFillerGameKey(): FillerGameKey {
  const pool = GAMES_CATALOG.filter((g) => !g.excludeFromRandom);
  const pick = pool[Math.floor(Math.random() * pool.length)];
  if (pick && (pick.key === 'memory' || pick.key === 'burger')) {
    return pick.key;
  }
  return FILLER_GAME_KEYS[Math.floor(Math.random() * FILLER_GAME_KEYS.length)];
}

export function getOrientationHintHebrew(orientation: PreferredOrientation): string {
  if (orientation === 'landscape') return 'לרוחב';
  if (orientation === 'portrait') return 'לאורך';
  return 'גמיש';
}
