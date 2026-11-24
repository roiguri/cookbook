/**
 * Deterministic Hebrew Cookbook fixtures for the Digital Twin Universe (DTU).
 * Every document matches `firestore.rules`, `storage.rules`, and `@cookbook/core`.
 */
import { CATEGORY_IDS, buildImageEntry, buildMediaEntry } from '@cookbook/core/recipe-model';
import { PUSH_PLATFORMS, deviceIdForToken } from '@cookbook/core/push-devices';

// Valid tiny 16x16 warm herb-green PNG (zlib/CRC32 verified) for Storage fixtures
export const SAMPLE_PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAIElEQVR4nGP49OI8SYiBTA1ZM/0IolENoxqI0UDD1AoAydbnkEIbojoAAAAASUVORK5CYII=',
  'base64',
);

// Minimal valid 1x1 JPEG
export const SAMPLE_JPG_BUFFER = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=',
  'base64',
);

export const SEED_USERS = [
  {
    key: 'user',
    uid: 'dtu-user-1',
    email: 'user@cookbook.test',
    password: 'TestPass123!',
    fullName: 'אורח משפחתי',
    role: 'user',
    favorites: ['dtu-pub-desserts'],
  },
  {
    key: 'approved',
    uid: 'dtu-approved-1',
    email: 'family@cookbook.test',
    password: 'TestPass123!',
    fullName: 'דנה כהן',
    role: 'approved',
    favorites: ['dtu-pub-main-courses', 'dtu-pub-desserts'],
    avatarConfig: {
      v: 1,
      parts: {
        hair: 'bob',
        eyes: 'happy',
        brows: 'defaultNatural',
        mouth: 'smile',
        facialHair: 'none',
        glasses: 'none',
        hat: 'toque',
        outfit: 'chefJacket',
      },
      colors: {
        skin: 'light',
        hair: 'brown',
        outfit: 'white',
        background: 'sage',
      },
    },
  },
  {
    key: 'approved2',
    uid: 'dtu-approved-2',
    email: 'family2@cookbook.test',
    password: 'TestPass123!',
    fullName: 'יוסי לוי',
    role: 'approved',
    favorites: [],
  },
  {
    key: 'manager',
    uid: 'dtu-manager-1',
    email: 'manager@cookbook.test',
    password: 'TestPass123!',
    fullName: 'מנהל המטבח',
    role: 'manager',
    favorites: ['dtu-pub-breads-pastries'],
  },
];

const PUBLISHED_BY_CATEGORY = {
  appetizers: {
    name: 'חומוס ביתי חלק',
    description: 'חומוס עשיר בטחינה גולמית ולימון טרי',
    difficulty: 'קלה',
    prepTime: 20,
    waitTime: 480,
    servings: 6,
    servingsUnit: 'מנות',
    mainIngredient: 'גרגירי חומוס',
    tags: ['טבעוני', 'אירוח'],
  },
  'main-courses': {
    name: 'קציצות ברוטב עגבניות',
    description: 'קציצות ביתיות רכות ברוטב עגבניות ושום של שישי',
    difficulty: 'בינונית',
    prepTime: 35,
    waitTime: 45,
    servings: 6,
    servingsUnit: 'מנות',
    mainIngredient: 'בשר טחון',
    tags: ['שבת', 'משפחתי'],
  },
  'side-dishes': {
    name: 'אורז עם אטריות',
    description: 'אורז אחד-אחד עם אטריות זהובות',
    difficulty: 'קלה',
    prepTime: 10,
    waitTime: 20,
    servings: 4,
    servingsUnit: 'מנות',
    mainIngredient: 'אורז',
    tags: ['תוספת', 'מהיר'],
  },
  'soups-stews': {
    name: 'מרק כתום קטיפתי',
    description: 'מרק בטטה, דלעת וגזר עם ג׳ינג׳ר עדין',
    difficulty: 'קלה',
    prepTime: 15,
    waitTime: 35,
    servings: 6,
    servingsUnit: 'קערות',
    mainIngredient: 'בטטה',
    tags: ['חורף', 'טבעוני'],
  },
  salads: {
    name: 'סלט ירקות קצוץ דק',
    description: 'סלט ישראלי רענן עם שמן זית ולימון',
    difficulty: 'קלה',
    prepTime: 10,
    waitTime: 0,
    servings: 4,
    servingsUnit: 'מנות',
    mainIngredient: 'עגבניות',
    tags: ['טרי', 'מהיר'],
  },
  desserts: {
    name: 'עוגת ביסקוויטים קלאסית',
    description: 'שכבות פתי בר עם קרם וניל וגנאש שוקולד',
    difficulty: 'קלה',
    prepTime: 25,
    waitTime: 240,
    servings: 12,
    servingsUnit: 'פרוסות',
    mainIngredient: 'שוקולד',
    tags: ['ילדים', 'ללא אפייה'],
    sectioned: true,
  },
  'breakfast-brunch': {
    name: 'שקשוקה של שבת',
    description: 'עגבניות טריות, פלפלים קלויים וביצים רכות',
    difficulty: 'קלה',
    prepTime: 15,
    waitTime: 20,
    servings: 4,
    servingsUnit: 'מנות',
    mainIngredient: 'ביצים',
    tags: ['בוקר', 'מהיר'],
  },
  'breads-pastries': {
    name: 'חלה מתוקה לשבת',
    description: 'חלה רכה וקלועה עם שומשום מעל',
    difficulty: 'קשה',
    prepTime: 40,
    waitTime: 120,
    servings: 2,
    servingsUnit: 'חלות',
    mainIngredient: 'קמח',
    tags: ['שבת', 'שמרים'],
    sectioned: true,
  },
  snacks: {
    name: 'כדורי תמרים ואגוזים',
    description: 'נשנוש מתוק טבעי ב-5 דקות',
    difficulty: 'קלה',
    prepTime: 10,
    waitTime: 15,
    servings: 15,
    servingsUnit: 'כדורים',
    mainIngredient: 'תמרים',
    tags: ['טבעוני', 'בריא'],
  },
  beverages: {
    name: 'לימונענע גרוסה',
    description: 'משקה קייצי מרענן עם נענע טרייה',
    difficulty: 'קלה',
    prepTime: 5,
    waitTime: 0,
    servings: 4,
    servingsUnit: 'כוסות',
    mainIngredient: 'לימון',
    tags: ['קיץ', 'מהיר'],
  },
};

export function buildSeedDataset(profile = 'baseline') {
  const baseTime = new Date('2026-10-01T10:00:00.000Z');
  const tsAt = (offsetHours) => new Date(baseTime.getTime() + offsetHours * 3600 * 1000);

  const docs = {}; // path -> plain JS object (Dates become timestampValue)
  const files = []; // { path, contentType, buffer, metadata }

  // 1. Users (always seeded)
  for (const u of SEED_USERS) {
    const userDoc = {
      email: u.email,
      fullName: u.fullName,
      role: u.role,
      favorites: u.favorites,
      createdAt: tsAt(0),
    };
    if (u.avatarConfig) userDoc.avatarConfig = u.avatarConfig;
    docs[`users/${u.uid}`] = userDoc;
  }

  if (profile === 'empty') {
    return { docs, files, users: SEED_USERS, recipes: {} };
  }

  const managerUid = 'dtu-manager-1';
  const approvedUid = 'dtu-approved-1';
  const approved2Uid = 'dtu-approved-2';
  const plainUid = 'dtu-user-1';

  // 2. Registered push devices for manager across all 3 platforms (web, android, ios)
  const managerDevices = [
    { token: 'dtu-fcm-web-manager-1', platform: PUSH_PLATFORMS.WEB, ua: 'DTU-Web/1.0' },
    { token: 'dtu-fcm-android-manager-1', platform: PUSH_PLATFORMS.ANDROID, ua: 'DTU-Android/1.0' },
    { token: 'dtu-fcm-ios-manager-1', platform: PUSH_PLATFORMS.IOS, ua: 'DTU-iOS/1.0' },
  ];
  for (const dev of managerDevices) {
    const devId = deviceIdForToken(dev.token);
    docs[`users/${managerUid}/devices/${devId}`] = {
      token: dev.token,
      platform: dev.platform,
      ua: dev.ua,
      updatedAt: tsAt(1),
    };
  }

  // 3. Published recipes across all 10 categories
  const publishedIds = {};
  CATEGORY_IDS.forEach((catId, idx) => {
    const recipeId = `dtu-pub-${catId}`;
    publishedIds[catId] = recipeId;
    const spec = PUBLISHED_BY_CATEGORY[catId];
    const imagePath = `recipes/${recipeId}/images/img-seed-${idx}.jpg`;
    files.push({
      path: imagePath,
      contentType: 'image/jpeg',
      buffer: SAMPLE_JPG_BUFFER,
      metadata: { uploadedBy: managerUid },
    });

    const recipeDoc = {
      name: spec.name,
      description: spec.description,
      attribution: 'סבתא רחל',
      category: catId,
      difficulty: spec.difficulty,
      prepTime: spec.prepTime,
      waitTime: spec.waitTime,
      servings: spec.servings,
      servingsUnit: spec.servingsUnit,
      mainIngredient: spec.mainIngredient,
      tags: spec.tags,
      comments: ['מומלץ להכין מראש'],
      authorId: managerUid,
      visibility: 'published',
      stage: 'tested',
      creationTime: tsAt(10 + idx),
      images: [
        buildImageEntry({
          id: `img-seed-${idx}`,
          path: imagePath,
          fileName: `img-seed-${idx}.jpg`,
          isPrimary: true,
          uploadedBy: managerUid,
          uploadedAt: tsAt(10 + idx),
        }),
      ],
      mediaInstructions: [],
    };

    if (spec.sectioned) {
      recipeDoc.ingredientSections = [
        {
          title: 'בסיס',
          items: [
            { item: 'קמח', amount: 2, unit: 'כוסות' },
            { item: 'סוכר', amount: 0.5, unit: 'כוס' },
          ],
        },
        {
          title: 'ציפוי',
          items: [
            { item: 'שוקולד מריר', amount: 150, unit: 'גרם' },
            { item: 'שמנת מתוקה', amount: 0.75, unit: 'כוס' },
          ],
        },
      ];
      recipeDoc.stages = [
        {
          title: 'הכנת הבסיס',
          instructions: ['מערבבים חומרים יבשים.', 'מוסיפים נוזלים ומאחדים.'],
        },
        {
          title: 'הרכבה וציפוי',
          instructions: ['ממיסים שוקולד עם שמנת.', 'יוצקים מעל ומקררים.'],
        },
      ];
    } else {
      recipeDoc.ingredients = [
        { item: spec.mainIngredient, amount: 2, unit: 'כוסות' },
        { item: 'שמן זית', amount: 1.5, unit: 'כפות' },
        { item: 'מלח לפי הטעם', amount: null, unit: '' },
      ];
      recipeDoc.instructions = [
        'מכינים את כל המרכיבים מראש על משטח העבודה.',
        'מבשלים על אש בינונית עד לריכוך ואיחוד טעמים.',
        'טועמים, מתקנים תיבול ומגישים חם.',
      ];
    }

    if (catId === 'main-courses') {
      recipeDoc.relatedRecipes = ['dtu-pub-side-dishes', 'dtu-pub-salads'];
      const stepMediaPath = `recipes/${recipeId}/media/media-step-1_step.png`;
      files.push({
        path: stepMediaPath,
        contentType: 'image/png',
        buffer: SAMPLE_PNG_BUFFER,
        metadata: { uploadedBy: managerUid },
      });
      recipeDoc.mediaInstructions = [
        {
          ...buildMediaEntry({
            id: 'media-step-1',
            path: stepMediaPath,
            type: 'image',
            uploadedBy: managerUid,
            uploadedAt: tsAt(10 + idx),
          }),
          caption: 'צורת הקציצות לפני הבישול',
        },
      ];
    }

    docs[`recipes/${recipeId}`] = recipeDoc;
  });

  // Extra pagination recipes when profile === 'all'
  if (profile === 'all') {
    for (let i = 1; i <= 15; i++) {
      const id = `dtu-pub-extra-${String(i).padStart(2, '0')}`;
      docs[`recipes/${id}`] = {
        name: `מתכון נוסף מספר ${i}`,
        description: `תיאור למתכון עמוד ${i}`,
        category: CATEGORY_IDS[i % CATEGORY_IDS.length],
        difficulty: 'קלה',
        prepTime: 15 + i,
        waitTime: 0,
        servings: 4,
        mainIngredient: 'ירקות',
        ingredients: [{ item: 'ירקות עונתיים', amount: 2, unit: 'כוסות' }],
        instructions: ['קוצצים ומבשלים.'],
        authorId: managerUid,
        visibility: 'published',
        stage: 'tested',
        creationTime: tsAt(30 + i),
        images: [],
        mediaInstructions: [],
      };
    }
  }

  // 4. Private recipes (to-try, tested + shared, pending submission, rejected submission)
  docs['recipes/dtu-priv-totry'] = {
    name: 'ראמן ביתי לנסות',
    description: 'מתכון פרטי ששמרתי לניסיון בסופ"ש',
    category: 'soups-stews',
    difficulty: 'בינונית',
    prepTime: 30,
    waitTime: 60,
    servings: 2,
    mainIngredient: 'אטריות ראמן',
    ingredients: [{ item: 'אטריות ראמן', amount: 200, unit: 'גרם' }],
    instructions: ['מבשלים ציר עשיר ומוסיפים אטריות.'],
    authorId: approvedUid,
    visibility: 'private',
    stage: 'to-try',
    creationTime: tsAt(50),
    images: [],
    mediaInstructions: [],
  };

  const sharedPrivateId = 'dtu-priv-shared';
  // All recipe photos (private AND published) live under recipes/{recipeId}/images/
  // matching packages/cookbook-core/recipe-model.js so approving in-place never breaks URLs.
  const sharedImgPath = `recipes/${sharedPrivateId}/images/img-priv-1.jpg`;
  files.push({
    path: sharedImgPath,
    contentType: 'image/jpeg',
    buffer: SAMPLE_JPG_BUFFER,
    metadata: { uploadedBy: approvedUid },
  });
  docs[`recipes/${sharedPrivateId}`] = {
    name: 'עוגיות טחינה סודיות',
    description: 'מתכון פרטי ששותף עם המשפחה',
    category: 'desserts',
    difficulty: 'קלה',
    prepTime: 15,
    waitTime: 12,
    servings: 20,
    servingsUnit: 'עוגיות',
    mainIngredient: 'טחינה',
    ingredients: [
      { item: 'טחינה גולמית', amount: 1, unit: 'כוס' },
      { item: 'קמח', amount: 2, unit: 'כוסות' },
    ],
    instructions: ['מערבבים לכדורים ואופים 12 דקות.'],
    authorId: approvedUid,
    visibility: 'private',
    stage: 'tested',
    creationTime: tsAt(51),
    images: [
      buildImageEntry({
        id: 'img-priv-1',
        path: sharedImgPath,
        fileName: 'img-priv-1.jpg',
        isPrimary: true,
        uploadedBy: approvedUid,
        uploadedAt: tsAt(51),
      }),
    ],
    mediaInstructions: [],
  };
  docs[`recipes/${sharedPrivateId}/shares/${approved2Uid}`] = {
    recipientUid: approved2Uid,
    authorId: approvedUid,
    authorName: 'דנה כהן',
    sharedAt: tsAt(52),
  };

  // Pending submission
  docs['recipes/dtu-sub-pending'] = {
    name: 'קובה סלק לאישור',
    description: 'מתכון שממתין לאישור מנהל',
    category: 'soups-stews',
    difficulty: 'קשה',
    prepTime: 60,
    waitTime: 45,
    servings: 6,
    mainIngredient: 'סולת',
    ingredients: [{ item: 'סולת', amount: 2, unit: 'כוסות' }],
    instructions: ['ממלאים ומבשלים במרק סלק.'],
    authorId: approvedUid,
    visibility: 'private',
    stage: 'tested',
    creationTime: tsAt(53),
    images: [],
    mediaInstructions: [],
  };
  docs['recipe_submissions/dtu-sub-pending'] = {
    recipeId: 'dtu-sub-pending',
    authorId: approvedUid,
    status: 'pending',
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    createdAt: tsAt(53),
  };

  // Rejected submission
  docs['recipes/dtu-sub-rejected'] = {
    name: 'לביבות תפוחי אדמה',
    description: 'לביבות פריכות לחנוכה',
    category: 'appetizers',
    difficulty: 'קלה',
    prepTime: 20,
    waitTime: 0,
    servings: 4,
    mainIngredient: 'תפוחי אדמה',
    ingredients: [{ item: 'תפוחי אדמה', amount: 4, unit: '' }],
    instructions: ['מגרדים ומטגנים.'],
    authorId: approvedUid,
    visibility: 'private',
    stage: 'tested',
    creationTime: tsAt(54),
    images: [],
    mediaInstructions: [],
  };
  docs['recipe_submissions/dtu-sub-rejected'] = {
    recipeId: 'dtu-sub-rejected',
    authorId: approvedUid,
    status: 'rejected',
    reviewedBy: managerUid,
    reviewedAt: tsAt(55),
    rejectionReason: 'חסרה כמות מדויקת לקמח ולשמן',
    createdAt: tsAt(54),
  };

  // 5. Pending edit suggestion — full snapshot matching web RecipeEditSuggestionService
  // so buildApplyPayload() preserves all existing ingredients, steps, and images.
  const saladBase = docs['recipes/dtu-pub-salads'];
  docs['recipe_edit_suggestions/dtu-suggestion-1'] = {
    recipeId: 'dtu-pub-salads',
    recipeName: saladBase.name,
    suggestedBy: approvedUid,
    suggestedByName: 'דנה כהן',
    status: 'pending',
    note: 'עדכנתי זמן הכנה והוספתי טיפ סומק',
    proposedChanges: {
      name: saladBase.name,
      description: saladBase.description,
      attribution: saladBase.attribution,
      category: saladBase.category,
      difficulty: saladBase.difficulty,
      prepTime: 12,
      waitTime: saladBase.waitTime,
      servings: saladBase.servings,
      servingsUnit: saladBase.servingsUnit,
      mainIngredient: saladBase.mainIngredient,
      tags: saladBase.tags,
      ingredients: saladBase.ingredients,
      instructions: saladBase.instructions,
      comments: ['להוסיף כף סומק מעל'],
      images: saladBase.images,
      mediaInstructions: saladBase.mediaInstructions,
    },
    storagePaths: [],
    createdAt: tsAt(56),
  };

  // 6. Active meal for approved user (exact web schema: `lastUpdated`, `currentStepIndex`)
  docs[`active_meals/${approvedUid}`] = {
    recipeIds: ['dtu-pub-main-courses', 'dtu-pub-salads'],
    activeRecipeId: 'dtu-pub-main-courses',
    recipeStates: {
      'dtu-pub-main-courses': { servings: 6, currentStepIndex: 0, unselectedIngredients: [] },
      'dtu-pub-salads': { servings: 4, currentStepIndex: 0, unselectedIngredients: [] },
    },
    lastUpdated: tsAt(57),
  };

  // 7. Grandma's scanned cookbook index at `cookbook/recipes` (exact web PdfService schema)
  docs['cookbook/recipes'] = {
    categories: {
      'מרקים ותבשילים': { startPage: 1, endPage: 1 },
      'מאפים וחלות': { startPage: 2, endPage: 2 },
      'קינוחים של שבת': { startPage: 3, endPage: 3 },
    },
    recipes: {
      'מרק עוף של סבתא': 1,
      'חלת שבת קלועה': 2,
      'עוגת דבש של פעם': 3,
    },
  };
  for (let p = 1; p <= 3; p++) {
    files.push({
      path: `grandmas_cookbook/original/page.${p}.jpg`,
      contentType: 'image/jpeg',
      buffer: SAMPLE_JPG_BUFFER,
      metadata: { uploadedBy: managerUid },
    });
  }

  // Seed a real Storage avatar for plain user so account-deletion cleanup verifies Storage deletion end-to-end
  files.push({
    path: `user-avatars/${plainUid}.png`,
    contentType: 'image/png',
    buffer: SAMPLE_PNG_BUFFER,
    metadata: { uploadedBy: plainUid },
  });

  // 8. Failed URL extraction log for Manager Dashboard
  docs['failed_url_extractions/dtu-failed-url-1'] = {
    url: 'https://blocked.example.test/recipe/404',
    kind: 'url',
    count: 2,
    firstAttempt: tsAt(58),
    lastAttempt: tsAt(59),
    lastUserId: approvedUid,
    error: {
      message: 'Could not extract valid recipe data - page requires login',
      code: 'extraction-failed',
      stack: 'DTU Fixture',
    },
  };

  return {
    docs,
    files,
    users: SEED_USERS,
    recipes: {
      published: publishedIds,
      privateToTry: 'dtu-priv-totry',
      privateShared: sharedPrivateId,
      pendingSubmission: 'dtu-sub-pending',
      rejectedSubmission: 'dtu-sub-rejected',
    },
  };
}
