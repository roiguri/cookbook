// auth-service.test.js
import { jest } from '@jest/globals';

// Import mocks
import '../../common/mocks/firebase-service.mock.js';
import '../../common/mocks/firebase-auth.mock.js';
import '../../common/mocks/firebase-firestore.mock.js';
import '../../common/mocks/document.mock.js';
import { mockDocRef } from '../../common/mocks/firebase-firestore.mock.js';

describe('AuthService', () => {
  let AuthService;
  let authService;
  let firebaseService;
  let mockAuth;
  let mockDb;
  let mockUserCollection;
  let mockUserDoc;
  let mockAuthStateCallback;
  let mockUser;
  let setPersistence,
    signInWithEmailAndPassword,
    signInWithPopup,
    createUserWithEmailAndPassword,
    signOut,
    sendPasswordResetEmail,
    GoogleAuthProvider,
    browserLocalPersistence,
    browserSessionPersistence;

  // README: This is a workaround to prevent console.log and console.error from being printed to the console
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  beforeEach(async () => {
    jest.resetModules();
    firebaseService = await import('src/js/services/_firebase/firebase-service.js');
    ({ AuthService } = await import('src/js/services/auth/auth-service.js'));

    // Dynamically import the Firebase Auth mocks
    ({
      setPersistence,
      signInWithEmailAndPassword,
      signInWithPopup,
      createUserWithEmailAndPassword,
      signOut,
      sendPasswordResetEmail,
      GoogleAuthProvider,
      browserLocalPersistence,
      browserSessionPersistence,
      updateProfile,
    } = await import('firebase/auth'));

    ({ deleteDoc, updateDoc, setDoc, getDoc } = await import('firebase/firestore'));

    // Create mock user
    mockUser = {
      uid: 'test-user-id',
      email: 'test@example.com',
      displayName: 'Test User',
      updateProfile: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    // Set up Firebase mock instances
    mockAuth = firebaseService.getAuthInstance();
    mockDb = firebaseService.getFirestoreInstance();
    mockUserCollection = mockDb.collection('users');
    mockUserDoc = mockUserCollection.doc(mockUser.uid);

    // Initialize auth state changed callback
    mockAuthStateCallback = null;
    mockAuth.onAuthStateChanged.mockImplementation((callback) => {
      mockAuthStateCallback = callback;
      return jest.fn(); // Return unsubscribe function
    });

    // Initialize service
    AuthService._resetInstanceForTest();
    authService = new AuthService();
    authService.initialize();
  });

  describe('Initialization', () => {
    test('should initialize properly', () => {
      expect(mockAuth.onAuthStateChanged).toHaveBeenCalled();
      expect(authService._initialized).toBe(true);
    });

    test('should register event listener for favorites', () => {
      const spy = jest.spyOn(document, 'addEventListener');
      authService._initialized = false;
      authService.initialize();
      expect(spy).toHaveBeenCalledWith('recipe-favorite-changed', expect.any(Function));
      spy.mockRestore();
    });

    test('should not reinitialize if already initialized', () => {
      const initialCallCount = mockAuth.onAuthStateChanged.mock.calls.length;
      authService.initialize();
      expect(mockAuth.onAuthStateChanged.mock.calls.length).toBe(initialCallCount);
    });

    test('should be a singleton', () => {
      const newAuthService = new AuthService();
      expect(newAuthService).toBe(authService);
    });
  });

  describe('Authentication state handling', () => {
    test('should update internal state when auth state changes', async () => {
      // Mock user roles for authenticated user
      getDoc.mockResolvedValue({
        exists: () => true,
        data: () => ({ role: 'user', favorites: [] }),
      });

      // Simulate auth state change
      await mockAuthStateCallback(mockUser);

      expect(authService._currentUser).toBe(mockUser);
      expect(authService._userData).toEqual({ role: 'user', favorites: [] });

      expect(document.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'auth-state-changed',
          detail: expect.objectContaining({
            user: mockUser,
            isAuthenticated: true,
            roles: { role: 'user', favorites: [] },
            isManager: false,
            isApproved: false,
          }),
        }),
      );
    });

    test('should update state when user logs out', async () => {
      // Set initial state as logged in
      authService._currentUser = mockUser;
      authService._userData = { role: 'user' };

      // Simulate auth state change to null (logout)
      await mockAuthStateCallback(null);

      expect(authService._currentUser).toBeNull();
      expect(authService._userData).toBeNull();

      expect(document.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'auth-state-changed',
          detail: expect.objectContaining({
            user: null,
            isAuthenticated: false,
            roles: null,
            isManager: false,
            isApproved: false,
          }),
        }),
      );
    });

    test('should notify observers when auth state changes', async () => {
      // Mark auth as resolved so addAuthObserver fires the immediate callback
      authService._authResolved = true;
      const observer = jest.fn();
      authService.addAuthObserver(observer);

      // Simulate auth state change
      getDoc.mockResolvedValue({
        exists: () => true,
        data: jest.fn().mockReturnValue({ role: 'manager' }),
      });

      await mockAuthStateCallback(mockUser);

      // The observer is called twice: first with initial state, then with updated state
      expect(observer).toHaveBeenCalledTimes(2);
      expect(observer.mock.calls[1][0]).toEqual(
        expect.objectContaining({
          user: mockUser,
          isAuthenticated: true,
          roles: { role: 'manager' },
          isManager: true,
          isApproved: true,
        }),
      );
      expect(observer.mock.calls[1][0].previousUser).toBeNull();
    });

    test('should immediately notify new observers of current state', () => {
      authService._currentUser = mockUser;
      authService._userData = { role: 'approved' };
      authService._authResolved = true;

      const observer = jest.fn();
      authService.addAuthObserver(observer);

      expect(observer).toHaveBeenCalledWith(
        expect.objectContaining({
          user: mockUser,
          isAuthenticated: true,
          roles: { role: 'approved' },
          isManager: false,
          isApproved: true,
        }),
      );
    });

    test('should remove observer when requested', async () => {
      const observer = jest.fn();
      authService.addAuthObserver(observer);

      // Clear initial call
      observer.mockClear();

      // Remove the observer
      authService.removeAuthObserver(observer);

      // Simulate auth state change
      await mockAuthStateCallback(mockUser);

      // Observer should not be called
      expect(observer).not.toHaveBeenCalled();
    });
  });

  describe('User Data Caching & Event Handling', () => {
    test('getUserData should return cached data without fetching', async () => {
      authService._currentUser = mockUser;
      const mockData = { role: 'user', favorites: ['rec1'] };
      authService._userData = mockData;

      const getDocSpy = jest.spyOn(mockUserDoc, 'get');
      getDoc.mockClear(); // Clear previous calls if any

      const result = await authService.getUserData();

      expect(result).toEqual(mockData);
      // Verify getDoc was NOT called
      expect(getDoc).not.toHaveBeenCalled();
    });

    test('getUserData with forceRefresh should fetch data', async () => {
      authService._currentUser = mockUser;
      authService._userData = { role: 'user', favorites: ['old'] };

      const newData = { role: 'user', favorites: ['new'] };
      getDoc.mockResolvedValue({
        exists: () => true,
        data: () => newData,
      });

      const result = await authService.getUserData({ forceRefresh: true });

      expect(result).toEqual(newData);
      expect(authService._userData).toEqual(newData);
    });

    test('_handleFavoriteChanged should update cached favorites', () => {
      authService._currentUser = mockUser;
      authService._userData = { role: 'user', favorites: ['rec1'] };

      // Call handler directly because document.dispatchEvent is mocked
      authService._handleFavoriteChanged({
        recipeId: 'rec2',
        isFavorite: true,
        userId: mockUser.uid,
      });

      // Verify cache updated (rec2 added)
      expect(authService._userData.favorites).toContain('rec2');
      expect(authService._userData.favorites).toContain('rec1');

      // Remove favorite
      authService._handleFavoriteChanged({
        recipeId: 'rec1',
        isFavorite: false,
        userId: mockUser.uid,
      });

      // Verify cache updated (rec1 removed)
      expect(authService._userData.favorites).not.toContain('rec1');
      expect(authService._userData.favorites).toContain('rec2');
    });

    test('_handleFavoriteChanged should ignore other users', () => {
      authService._currentUser = mockUser;
      authService._userData = { role: 'user', favorites: [] };

      // Call handler for different user
      authService._handleFavoriteChanged({
        recipeId: 'rec1',
        isFavorite: true,
        userId: 'other-user',
      });

      // Verify cache NOT updated
      expect(authService._userData.favorites).toHaveLength(0);
    });
  });

  describe('User authentication methods', () => {
    test('login should work with email and password', async () => {
      const email = 'user@example.com';
      const password = 'password123';
      const userCredential = { user: mockUser };

      setPersistence.mockResolvedValue(undefined);
      signInWithEmailAndPassword.mockResolvedValue(userCredential);

      const result = await authService.login(email, password, true);

      expect(setPersistence).toHaveBeenCalledWith(mockAuth, 'local');
      expect(signInWithEmailAndPassword).toHaveBeenCalledWith(mockAuth, email, password);
      expect(result).toBe(mockUser);
    });

    test('login should use session persistence when remember is false', async () => {
      setPersistence.mockResolvedValue(undefined);
      signInWithEmailAndPassword.mockResolvedValue({ user: mockUser });

      await authService.login('user@example.com', 'password123', false);

      expect(setPersistence).toHaveBeenCalledWith(mockAuth, 'session');
    });

    test('login should handle errors properly', async () => {
      const error = new Error('Invalid credentials');
      error.code = 'auth/wrong-password';

      signInWithEmailAndPassword.mockRejectedValue(error);

      await expect(authService.login('user@example.com', 'wrong-password')).rejects.toThrow(error);

      expect(document.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'auth-error',
          detail: expect.objectContaining({
            operation: 'login',
            code: 'auth/wrong-password',
          }),
        }),
      );
    });

    test('loginWithGoogle should work properly', async () => {
      const userCredential = { user: mockUser };
      signInWithPopup.mockResolvedValue(userCredential);

      // User doesn't exist in Firestore
      getDoc.mockResolvedValue({
        exists: () => false,
      });

      const result = await authService.loginWithGoogle();

      expect(GoogleAuthProvider).toHaveBeenCalled();
      expect(signInWithPopup).toHaveBeenCalledWith(mockAuth, expect.any(Object), 'mockResolver');
      expect(setDoc).toHaveBeenCalledWith(
        mockDocRef,
        expect.objectContaining({
          email: mockUser.email,
          fullName: mockUser.displayName,
          role: 'user',
        }),
      );
      expect(result).toBe(mockUser);
    });

    test('loginWithGoogle should not create document for existing users', async () => {
      const userCredential = { user: mockUser };
      signInWithPopup.mockResolvedValue(userCredential);

      // User exists in Firestore. The mock must shape a complete docSnap
      // since the read goes through FirestoreService.getDocument, which
      // calls docSnap.data() and reads docSnap.id.
      getDoc.mockResolvedValue({
        exists: () => true,
        data: () => ({ role: 'user' }),
        id: mockUser.uid,
      });

      await authService.loginWithGoogle();

      expect(setDoc).not.toHaveBeenCalled();
    });

    test('signup should create new user account and Firestore document', async () => {
      const email = 'newuser@example.com';
      const password = 'newpassword123';
      const fullName = 'New User';
      const userCredential = { user: mockUser };

      createUserWithEmailAndPassword.mockResolvedValue(userCredential);

      const result = await authService.signup(email, password, fullName);

      expect(createUserWithEmailAndPassword).toHaveBeenCalledWith(mockAuth, email, password);
      expect(updateProfile).toHaveBeenCalledWith(mockUser, { displayName: fullName });
      expect(setDoc).toHaveBeenCalledWith(
        mockDocRef,
        expect.objectContaining({
          email,
          fullName,
          role: 'user',
        }),
      );
      expect(result).toBe(mockUser);
    });

    test('logout should sign out current user', async () => {
      signOut.mockResolvedValue(undefined);

      await authService.logout();

      expect(signOut).toHaveBeenCalledWith(mockAuth);
    });

    test('resetPassword should send reset email', async () => {
      const email = 'user@example.com';
      sendPasswordResetEmail.mockResolvedValue(undefined);

      await authService.resetPassword(email);

      expect(sendPasswordResetEmail).toHaveBeenCalledWith(mockAuth, email);
    });
  });

  describe('User profile management', () => {
    beforeEach(() => {
      // Set up current user for profile tests
      authService._currentUser = mockUser;
    });

    test('updateProfile should update Firebase Auth and Firestore', async () => {
      const profileData = {
        displayName: 'Updated Name',
        photoURL: 'https://example.com/photo.jpg',
        favoriteFood: 'Pizza',
      };

      updateDoc.mockResolvedValue(undefined);
      // Pre-fill user data
      authService._userData = { role: 'user' };

      await authService.updateProfile(profileData);

      expect(updateProfile).toHaveBeenCalledWith(mockUser, {
        displayName: 'Updated Name',
        photoURL: 'https://example.com/photo.jpg',
      });

      expect(updateDoc).toHaveBeenCalledWith(
        mockDocRef, // First argument is the docRef, which we can check with anything
        expect.objectContaining({
          displayName: 'Updated Name',
          photoURL: 'https://example.com/photo.jpg',
          favoriteFood: 'Pizza',
          updatedAt: 'server-timestamp',
        }),
      );

      // Verify local cache updated
      expect(authService._userData.favoriteFood).toBe('Pizza');
    });

    test('updateProfile should throw error if no user is signed in', async () => {
      authService._currentUser = null;

      await expect(authService.updateProfile({ displayName: 'Test' })).rejects.toThrow(
        'No user is signed in',
      );
    });

    test('deleteAccount should delete user and Firestore document', async () => {
      mockUserDoc.delete.mockResolvedValue(undefined);

      await authService.deleteAccount();

      expect(deleteDoc).toHaveBeenCalled();
      expect(mockUser.delete).toHaveBeenCalled();
    });

    test('deleteAccount should throw error if no user is signed in', async () => {
      authService._currentUser = null;

      await expect(authService.deleteAccount()).rejects.toThrow('No user is signed in');
    });
  });

  describe('Role checking methods', () => {
    test('hasRole should check for specific role', () => {
      authService._currentUser = mockUser;

      // Test with user role
      authService._userData = { role: 'user' };
      expect(authService.hasRole('user')).toBe(true);
      expect(authService.hasRole('approved')).toBe(false);
      expect(authService.hasRole('manager')).toBe(false);

      // Test with manager role
      authService._userData = { role: 'manager' };
      expect(authService.hasRole('manager')).toBe(true);
      expect(authService.hasRole('user')).toBe(false);
    });

    test('hasRole should return false when not authenticated', () => {
      authService._currentUser = null;
      authService._userData = null;

      expect(authService.hasRole('user')).toBe(false);
    });

    test('isManager should check for manager role', () => {
      authService._currentUser = mockUser;

      // Test with user role
      authService._userData = { role: 'user' };
      expect(authService.isManager()).toBe(false);

      // Test with manager role
      authService._userData = { role: 'manager' };
      expect(authService.isManager()).toBe(true);
    });

    test('isApproved should check for approved or manager role', () => {
      authService._currentUser = mockUser;

      // Test with user role
      authService._userData = { role: 'user' };
      expect(authService.isApproved()).toBe(false);

      // Test with approved role
      authService._userData = { role: 'approved' };
      expect(authService.isApproved()).toBe(true);

      // Test with manager role
      authService._userData = { role: 'manager' };
      expect(authService.isApproved()).toBe(true);
    });
  });

  describe('Error handling', () => {
    test('should handle Firestore errors when fetching user roles', async () => {
      // Make Firestore throw an error
      mockUserDoc.get.mockRejectedValue(new Error('Firestore error'));

      // Mock console.error
      const originalConsoleError = console.error;
      console.error = jest.fn();

      // Trigger auth state change
      await mockAuthStateCallback(mockUser);

      // Verify error was logged
      expect(console.error).toHaveBeenCalledWith('Error fetching user data:', expect.any(Error));

      // Verify default role was used
      expect(authService._userData).toEqual({ role: 'user', favorites: [] });

      // Restore console.error
      console.error = originalConsoleError;
    });
  });

  describe('Non-existing user document handling', () => {
    test('should handle non-existing user document gracefully', async () => {
      // Make Firestore return non-existing document
      mockUserDoc.get.mockResolvedValue({
        exists: () => false,
      });

      // Trigger auth state change
      await mockAuthStateCallback(mockUser);

      // Should default to user role
      expect(authService._userData).toEqual({ role: 'user', favorites: [] });
    });
  });

  describe('Getter and registration methods', () => {
    test('getCurrentUser should return null when not authenticated', () => {
      authService._currentUser = null;
      expect(authService.getCurrentUser()).toBeNull();
    });

    test('getCurrentUser should return user when authenticated', () => {
      authService._currentUser = mockUser;
      expect(authService.getCurrentUser()).toBe(mockUser);
    });

    test('isAuthenticated should return false when not authenticated', () => {
      authService._currentUser = null;
      expect(authService.isAuthenticated()).toBe(false);
    });

    test('isAuthenticated should return true when authenticated', () => {
      authService._currentUser = mockUser;
      expect(authService.isAuthenticated()).toBe(true);
    });

    test('onAuthStateChanged should register callback and return unsubscribe', () => {
      const callback = jest.fn();
      const unsubscribe = authService.onAuthStateChanged(callback);
      expect(typeof unsubscribe).toBe('function');
      expect(mockAuth.onAuthStateChanged).toHaveBeenCalledWith(callback);
    });
  });

  describe('getCurrentUserRole', () => {
    test('fetches and returns the user role if not set', async () => {
      authService._currentUser = mockUser; // Set current user

      // Mock getUserData to mimic the side effect of setting _userData
      const getUserDataSpy = jest.spyOn(authService, 'getUserData').mockImplementation(async () => {
        authService._userData = { role: 'manager' };
        return { role: 'manager' };
      });

      // Clear _userData initially so it attempts fetch
      authService._userData = null;

      const role = await authService.getCurrentUserRole();
      expect(role).toBe('manager');
      expect(getUserDataSpy).toHaveBeenCalled();
    });

    test('returns the cached role if already set', async () => {
      authService._currentUser = mockUser;
      authService._userData = { role: 'approved' }; // Set cached role

      const getUserDataSpy = jest.spyOn(authService, 'getUserData');

      const role = await authService.getCurrentUserRole();
      expect(role).toBe('approved');
      expect(getUserDataSpy).not.toHaveBeenCalled();
    });

    test('returns public if no user and no roles', async () => {
      authService._currentUser = null;
      authService._userData = null;

      // Mock getUserData call inside getCurrentUserRole if it's called
      const getUserDataSpy = jest.spyOn(authService, 'getUserData').mockResolvedValue(null);

      const role = await authService.getCurrentUserRole();
      expect(role).toBe('public');
    });
  });
});
