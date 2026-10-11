// Base64 placeholder images (1x1 pixel solid colors)
const IMG_RED =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const IMG_GREEN =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const IMG_BLUE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export const MOCK_RECIPES = [
  {
    id: 'mock-recipe-1',
    name: 'Classic Pancakes',
    description: 'Fluffy and delicious pancakes',
    category: 'breakfast-brunch',
    prepTime: 10,
    waitTime: 5,
    difficulty: 'Easy',
    images: [{ id: 'img-1', full: IMG_RED, isPrimary: true, access: 'public' }],
    approved: true,
    visibility: 'published',
    stage: 'tested',
    creationTime: { seconds: 1700000003 },
  },
  {
    id: 'mock-recipe-2',
    name: 'Spaghetti Carbonara',
    description: 'Authentic Italian pasta dish',
    category: 'main-courses',
    prepTime: 15,
    waitTime: 0,
    difficulty: 'Medium',
    images: [{ id: 'img-2', full: IMG_GREEN, isPrimary: true, access: 'public' }],
    approved: true,
    visibility: 'published',
    stage: 'tested',
    creationTime: { seconds: 1700000002 },
  },
  {
    id: 'mock-recipe-3',
    name: 'Vegetable Stir Fry',
    description: 'Healthy and quick veggie stir fry',
    category: 'main-courses',
    prepTime: 15,
    waitTime: 0,
    difficulty: 'Easy',
    images: [{ id: 'img-3', full: IMG_BLUE, isPrimary: true, access: 'public' }],
    approved: true,
    visibility: 'published',
    stage: 'tested',
    creationTime: { seconds: 1700000001 },
  },
  {
    id: 'mock-recipe-4',
    name: 'Fruit Salad',
    description: 'Fresh seasonal fruit salad',
    category: 'desserts',
    prepTime: 10,
    waitTime: 0,
    difficulty: 'Easy',
    images: [{ id: 'img-4', full: IMG_RED, isPrimary: true, access: 'public' }],
    approved: true,
    visibility: 'published',
    stage: 'tested',
    creationTime: { seconds: 1700000000 },
  },
];

export class FirestoreService {
  static async queryDocuments(collectionName, queryParams = {}) {
    console.log('[Mock] FirestoreService.queryDocuments', collectionName, queryParams);

    if (collectionName !== 'recipes') return [];

    let results = [...MOCK_RECIPES];

    // Filter
    if (queryParams.where) {
      for (const [field, op, value] of queryParams.where) {
        results = results.filter((item) => {
          if (op === '==') return item[field] === value;
          return true; // Simplification for mock
        });
      }
    }

    // Order
    if (queryParams.orderBy) {
      const [field, direction] = queryParams.orderBy;
      results.sort((a, b) => {
        const valA = a[field]?.seconds || a[field];
        const valB = b[field]?.seconds || b[field];

        if (direction === 'desc') {
          return valB > valA ? 1 : -1;
        }
        return valA > valB ? 1 : -1;
      });
    }

    // Limit
    if (queryParams.limit) {
      results = results.slice(0, queryParams.limit);
    }

    return results;
  }

  static async getDocument(collectionName, id) {
    console.log('[Mock] FirestoreService.getDocument', collectionName, id);
    if (collectionName === 'recipes') {
      const recipe = MOCK_RECIPES.find((r) => r.id === id);
      return recipe ? { ...recipe } : null;
    }
    return null;
  }

  static async addDocument() {
    return 'mock-id';
  }
  static async updateDocument() {}
  static async deleteDocument() {}
  static async batchWrite() {}
}

export const getFirestoreInstance = () => ({});
export const firestoreService = FirestoreService;
