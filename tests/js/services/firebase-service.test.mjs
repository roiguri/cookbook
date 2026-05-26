import { jest } from '@jest/globals';
// Import extracted mocks
import '../../common/mocks/firebase-app.mock.js';
import '../../common/mocks/firebase-auth.mock.js';
import '../../common/mocks/firebase-firestore.mock.js';
import '../../common/mocks/firebase-storage.mock.js';

describe('firebase-service', () => {
  let firebaseService;

  beforeEach(async () => {
    jest.resetModules();
    firebaseService = await import('src/js/services/_firebase/firebase-service.js');
  });

  it('should export initFirebase function', () => {
    const type = typeof firebaseService.initFirebase;

    expect(type).toBe('function');
  });

  it('should initialize and return all services', () => {
    const config = { apiKey: 'test' };

    const result = firebaseService.initFirebase(config);

    expect(result).toEqual({
      app: 'mockApp',
      auth: 'mockAuth',
      db: 'mockFirestore',
      storage: 'mockStorage',
    });
  });

  it('getter functions should return correct instances after init', () => {
    const config = { apiKey: 'test' };
    firebaseService.initFirebase(config);

    const app = firebaseService.getFirebaseApp();
    const auth = firebaseService.getAuthInstance();
    const db = firebaseService.getFirestoreInstance();
    const storage = firebaseService.getStorageInstance();

    expect(app).toBe('mockApp');
    expect(auth).toBe('mockAuth');
    expect(db).toBe('mockFirestore');
    expect(storage).toBe('mockStorage');
  });
});
