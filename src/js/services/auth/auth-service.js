/**
 * AuthService - Centralized Authentication Manager
 *
 * This service provides a unified interface for authentication and user management,
 * abstracting Firebase Auth and Firestore details.
 *
 * Public Methods:
 *   - initialize(): Initializes the service and sets up the authentication state listener.
 *   - getCurrentUser(): Returns the current authenticated user (or null if not authenticated).
 *   - isAuthenticated(): Returns true if a user is currently authenticated.
 *   - getUserData(): Returns the full user document data (cached).
 *   - login(email, password, remember = false): Logs in a user with email and password. Optionally persists the session.
 *   - loginWithGoogle(): Logs in a user using Google authentication.
 *   - signup(email, password, fullName): Registers a new user with email, password, and full name.
 *   - logout(): Logs out the current user.
 *   - resetPassword(email): Sends a password reset email to the specified address.
 *   - updateProfile(profileData): Updates the current user's profile (display name, photo, etc).
 *   - deleteAccount(): Deletes the current user's account and associated Firestore document.
 *   - hasRole(role): Checks if the current user has a specific role.
 *   - isManager(): Checks if the current user has the 'manager' role.
 *   - isApproved(): Checks if the current user is 'approved' or a 'manager'.
 *   - onAuthStateChanged(callback): Registers a callback for authentication state changes.
 *   - addAuthObserver(observer): Adds an observer function for auth state changes.
 *   - removeAuthObserver(observer): Removes a previously added auth observer.
 *   - getCurrentUserRole(): Gets the current user's role.
 *   - waitForAuth(timeout): Waits for authentication to initialize, returns authenticated user or null.
 *   - getCurrentAvatarUrl(): Returns the current user's avatar URL.
 */
import { getAuthInstance, getFirestoreInstance } from '../_firebase/firebase-service.js';
import { serverTimestamp, doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  browserPopupRedirectResolver,
  EmailAuthProvider,
  GoogleAuthProvider,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
  updatePassword,
  reauthenticateWithCredential,
  linkWithPopup,
  unlink,
} from 'firebase/auth';

class AuthService {
  /**
   * Constructor initializes the service
   */
  constructor() {
    this._initialized = false;
    this._authResolved = false; // Tracks if the initial auth state (including roles) is fully loaded
    this._currentUser = null;
    this._userData = null; // Full user document data
    this._currentAvatarUrl = null;
    this._observers = [];
    this._unsubscribeFromAuth = null;
    this._authResolveCallbacks = []; // Callbacks waiting for initial resolution

    // Create singleton reference
    if (AuthService.instance) {
      return AuthService.instance;
    }

    AuthService.instance = this;
  }

  /**
   * Initialize the auth service
   * Sets up Firebase Auth listener and initializes state
   */
  initialize() {
    if (this._initialized) return;

    // Set up auth state listener
    const auth = getAuthInstance();
    this._unsubscribeFromAuth = auth.onAuthStateChanged(async (user) => {
      const prevUser = this._currentUser;
      this._currentUser = user;

      if (user) {
        // Fetch full user data once
        await this.getUserData({ forceRefresh: true });
      } else {
        this._userData = null;
        this._currentAvatarUrl = null;
      }

      // Notify observers of the auth state change
      this._notifyObservers({
        user: this._currentUser,
        isAuthenticated: !!this._currentUser,
        roles: this._userData,
        avatarUrl: this._currentAvatarUrl,
        isManager: this._userData?.role === 'manager',
        isApproved: this._userData?.role === 'approved' || this._userData?.role === 'manager',
        previousUser: prevUser,
      });

      // Dispatch custom event for components to listen to
      this._dispatchAuthEvent({
        user: this._currentUser,
        isAuthenticated: !!this._currentUser,
        roles: this._userData,
        avatarUrl: this._currentAvatarUrl,
        isManager: this._userData?.role === 'manager',
        isApproved: this._userData?.role === 'approved' || this._userData?.role === 'manager',
        previousUser: prevUser,
      });

      // Mark auth as fully resolved and notify any pending waitForAuth callers
      if (!this._authResolved) {
        this._authResolved = true;
        this._authResolveCallbacks.forEach((cb) => cb(this._currentUser));
        this._authResolveCallbacks = [];
      }
    });

    // Listen for favorite changes to keep cache fresh
    document.addEventListener('recipe-favorite-changed', (event) => {
      this._handleFavoriteChanged(event.detail);
    });

    this._initialized = true;
  }

  /**
   * Handle favorite changed event to update local cache
   * @private
   * @param {Object} detail - Event detail { recipeId, isFavorite, userId }
   */
  _handleFavoriteChanged({ recipeId, isFavorite, userId }) {
    // Only update if it's the current user
    if (!this._currentUser || this._currentUser.uid !== userId) return;
    if (!this._userData) return;

    // Initialize favorites array if missing
    if (!this._userData.favorites) {
      this._userData.favorites = [];
    }

    const favorites = new Set(this._userData.favorites);

    if (isFavorite) {
      favorites.add(recipeId);
    } else {
      favorites.delete(recipeId);
    }

    // Update local cache
    this._userData.favorites = Array.from(favorites);
  }

  /**
   * Get the full user document data
   * @param {Object} options - Options
   * @param {boolean} options.forceRefresh - Whether to force a fetch from Firestore
   * @returns {Promise<Object>} The user document data
   */
  async getUserData({ forceRefresh = false } = {}) {
    if (!this._currentUser) return null;

    // Return cached data if available and not forced
    if (!forceRefresh && this._userData) {
      return this._userData;
    }

    try {
      const db = getFirestoreInstance();
      const userDocRef = doc(db, 'users', this._currentUser.uid);
      const docSnap = await getDoc(userDocRef);

      if (docSnap.exists()) {
        this._userData = docSnap.data();
      } else {
        // If document doesn't exist, use default structure
        this._userData = { role: 'user', favorites: [] };
      }

      // Update derived properties
      this._currentAvatarUrl = this._userData.avatarUrl || this._currentUser.photoURL || null;

      return this._userData;
    } catch (error) {
      console.error('Error fetching user data:', error);
      // Fallback to minimal data if fetch fails
      if (!this._userData) {
        this._userData = { role: 'user', favorites: [] };
      }
      return this._userData;
    }
  }

  /**
   * Get the current authenticated user
   * @returns {Object|null} Firebase user object or null if not authenticated
   */
  getCurrentUser() {
    return this._currentUser;
  }

  /**
   * Check if a user is currently authenticated
   * @returns {boolean} True if user is authenticated
   */
  isAuthenticated() {
    return !!this._currentUser;
  }

  /**
   * Get the current user's avatar URL
   * @returns {string|null} Current avatar URL or null if not available
   */
  getCurrentAvatarUrl() {
    return this._currentAvatarUrl;
  }

  /**
   * Login with email and password
   * @param {string} email - User's email address
   * @param {string} password - User's password
   * @param {boolean} [remember=false] - Whether to persist the session
   * @returns {Promise<Object>} Promise resolving to user object
   */
  async login(email, password, remember = false) {
    try {
      const auth = getAuthInstance();
      // Set persistence based on remember preference
      const persistence = remember ? browserLocalPersistence : browserSessionPersistence;
      await setPersistence(auth, persistence);
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      return userCredential.user;
    } catch (error) {
      this._handleAuthError('login', error);
      throw error;
    }
  }

  /**
   * Login with Google
   * @returns {Promise<Object>} Promise resolving to user object
   */
  async loginWithGoogle() {
    try {
      const auth = getAuthInstance();
      const provider = new GoogleAuthProvider();
      const userCredential = await signInWithPopup(auth, provider, browserPopupRedirectResolver);
      const user = userCredential.user;

      // Check if user document exists in Firestore
      const db = getFirestoreInstance();
      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);

      // If user doesn't exist in Firestore, create a new document
      if (!userDoc.exists()) {
        await setDoc(userDocRef, {
          email: user.email,
          fullName: user.displayName,
          role: 'user',
          createdAt: serverTimestamp(),
        });
      }

      return user;
    } catch (error) {
      this._handleAuthError('google-login', error);
      throw error;
    }
  }

  /**
   * Sign up a new user with email and password
   * @param {string} email - User's email address
   * @param {string} password - User's password
   * @param {string} fullName - User's full name
   * @returns {Promise<Object>} Promise resolving to user object
   */
  async signup(email, password, fullName) {
    try {
      const auth = getAuthInstance();
      const db = getFirestoreInstance();
      // Create user in Firebase Auth
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // Update user profile (modular API)
      await updateProfile(user, { displayName: fullName });

      // Create user document in Firestore
      const userDocRef = doc(db, 'users', user.uid);
      await setDoc(userDocRef, {
        email: email,
        fullName: fullName,
        role: 'user',
        createdAt: serverTimestamp(),
      });

      return user;
    } catch (error) {
      this._handleAuthError('signup', error);
      throw error;
    }
  }

  /**
   * Log out the current user
   * @returns {Promise<void>}
   */
  async logout() {
    try {
      // Best-effort: remove this device's push token before signing out, while
      // we still hold auth (Firestore rules require it). Dynamic import keeps
      // this an optional dependency — non-notification code paths never load it.
      if (this._currentUser) {
        try {
          const { default: notificationService } = await import('../users/notification-service.js');
          await notificationService.unregisterCurrentDevice(this._currentUser.uid);
        } catch (error) {
          console.warn('Failed to unregister push token on logout:', error);
        }
      }
      const auth = getAuthInstance();
      await signOut(auth);
    } catch (error) {
      this._handleAuthError('logout', error);
      throw error;
    }
  }

  /**
   * Send password reset email
   * @param {string} email - User's email address
   * @returns {Promise<void>}
   */
  async resetPassword(email) {
    try {
      const auth = getAuthInstance();
      await sendPasswordResetEmail(auth, email);
    } catch (error) {
      this._handleAuthError('reset-password', error);
      throw error;
    }
  }

  /**
   * Update user profile
   * @param {Object} profileData - Profile data to update
   * @returns {Promise<Object>} Promise resolving to updated user
   */
  async updateProfile(profileData) {
    try {
      const user = this.getCurrentUser();
      if (!user) throw new Error('No user is signed in');
      const db = getFirestoreInstance();
      // Update auth profile if displayName or photoURL provided
      if (profileData.displayName || profileData.photoURL) {
        await updateProfile(user, {
          displayName: profileData.displayName || user.displayName,
          photoURL: profileData.photoURL || user.photoURL,
        });
      }
      // Update user document in Firestore
      const userDocRef = doc(db, 'users', user.uid);
      await updateDoc(userDocRef, {
        ...profileData,
        updatedAt: serverTimestamp(),
      });

      // Update local cache manually since we just updated the doc
      if (this._userData) {
        this._userData = { ...this._userData, ...profileData };
        // Don't overwrite existing fields that aren't in profileData
      } else {
        await this.getUserData({ forceRefresh: true });
      }

      // Update cached avatar URL if it was changed
      if (profileData.avatarUrl !== undefined) {
        this._currentAvatarUrl = profileData.avatarUrl;
        if (this._userData) this._userData.avatarUrl = profileData.avatarUrl;
      }

      // Dispatch profile updated event
      const event = new CustomEvent('profile-updated', {
        detail: {
          user: user,
          updatedFields: Object.keys(profileData),
        },
        bubbles: true,
        composed: true,
      });
      document.dispatchEvent(event);
      return user;
    } catch (error) {
      this._handleAuthError('update-profile', error);
      throw error;
    }
  }

  /**
   * Delete user account
   * @returns {Promise<void>}
   */
  async deleteAccount() {
    try {
      const user = this.getCurrentUser();
      if (!user) throw new Error('No user is signed in');
      const db = getFirestoreInstance();
      // Delete user document from Firestore
      const userDocRef = doc(db, 'users', user.uid);
      await deleteDoc(userDocRef);
      // Delete user from Firebase Auth
      await user.delete();
    } catch (error) {
      this._handleAuthError('delete-account', error);
      throw error;
    }
  }

  async updatePassword(currentPassword, newPassword) {
    const user = this.getCurrentUser();
    if (!user) throw new Error('No user is signed in');
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPassword);
  }

  async linkWithGoogle() {
    const user = this.getCurrentUser();
    if (!user) throw new Error('No user is signed in');
    return await linkWithPopup(user, new GoogleAuthProvider(), browserPopupRedirectResolver);
  }

  async unlinkProvider(providerId) {
    const user = this.getCurrentUser();
    if (!user) throw new Error('No user is signed in');
    return await unlink(user, providerId);
  }

  /**
   * Check if current user has a specific role
   * @param {string} role - Role to check (user, approved, manager)
   * @returns {boolean} True if user has the role
   */
  hasRole(role) {
    if (!this._currentUser || !this._userData) return false;
    return this._userData.role === role;
  }

  /**
   * Check if current user has manager role
   * @returns {boolean} True if user is a manager
   */
  isManager() {
    return this.hasRole('manager');
  }

  /**
   * Check if current user has approved role
   * @returns {boolean} True if user is approved or manager
   */
  isApproved() {
    return this.hasRole('approved') || this.hasRole('manager');
  }

  /**
   * Listen for auth state changes
   * @param {Function} callback - Function to call when auth state changes
   * @returns {Function} Unsubscribe function
   */
  onAuthStateChanged(callback) {
    const auth = getAuthInstance();
    return auth.onAuthStateChanged(callback);
  }

  /**
   * Add auth state observer
   * @param {Function} observer - Function to call when auth state changes
   */
  addAuthObserver(observer) {
    if (typeof observer !== 'function') {
      console.error('Observer must be a function');
      return;
    }

    this._observers.push(observer);

    // Call the observer immediately with current state if auth is fully resolved
    if (this._authResolved) {
      observer({
        user: this._currentUser,
        isAuthenticated: !!this._currentUser,
        roles: this._userData,
        isManager: this._userData?.role === 'manager',
        isApproved: this._userData?.role === 'approved' || this._userData?.role === 'manager',
      });
    }
  }

  /**
   * Remove auth state observer
   * @param {Function} observer - Observer function to remove
   */
  removeAuthObserver(observer) {
    const index = this._observers.indexOf(observer);
    if (index !== -1) {
      this._observers.splice(index, 1);
    }
  }

  /**
   * Get the current user's role
   * @returns {string} The current user's role
   */
  async getCurrentUserRole() {
    if (this._userData) {
      return this._userData.role;
    }
    if (!this._currentUser) return 'public';

    // Use getUserData instead of private _fetchUserRoles
    await this.getUserData();
    return this._userData?.role || 'public';
  }

  /**
   * Wait for authentication to initialize
   * Useful for page components that need to ensure auth state is ready
   * @param {number} timeout - Maximum time to wait in milliseconds (default: 5000)
   * @returns {Promise<Object|null>} Promise resolving to authenticated user or null
   */
  async waitForAuth(timeout = 5000) {
    return new Promise((resolve) => {
      // If already fully resolved (including roles), return immediately
      if (this._authResolved) {
        resolve(this.getCurrentUser());
        return;
      }

      // Wait for auth state to fully initialize (including fetching user data)
      let timeoutId;

      const resolveCallback = (user) => {
        clearTimeout(timeoutId);
        resolve(user);
      };

      this._authResolveCallbacks.push(resolveCallback);

      // Timeout fallback
      timeoutId = setTimeout(() => {
        const index = this._authResolveCallbacks.indexOf(resolveCallback);
        if (index > -1) {
          this._authResolveCallbacks.splice(index, 1);
        }
        resolve(null);
      }, timeout);
    });
  }

  /* ===== PRIVATE METHODS ===== */

  /**
   * Fetch user roles from Firestore
   * @private
   * @param {Object} user - Firebase user object
   * @returns {Promise<Object>} Promise resolving to user roles
   * @deprecated Use getUserData() instead
   */
  async _fetchUserRoles(user) {
    if (this._currentUser && user.uid === this._currentUser.uid) {
      return this.getUserData();
    }
    // Fallback for direct calls with different user (shouldn't happen often)
    try {
      const db = getFirestoreInstance();
      const userDocRef = doc(db, 'users', user.uid);
      const docSnap = await getDoc(userDocRef);
      if (docSnap.exists()) {
        return docSnap.data();
      }
      return { role: 'user' };
    } catch (error) {
      console.error('Error fetching user roles:', error);
      return { role: 'user' };
    }
  }

  /**
   * Fetch user avatar URL from Firestore with fallback to Firebase Auth
   * @private
   * @param {Object} user - Firebase user object
   * @returns {Promise<string|null>} Promise resolving to avatar URL or null
   * @deprecated Use getUserData() instead
   */
  async _fetchAvatarUrl(user) {
    if (this._currentUser && user.uid === this._currentUser.uid) {
      const data = await this.getUserData();
      return data?.avatarUrl || user.photoURL || null;
    }
    // Fallback
    try {
      const db = getFirestoreInstance();
      const userDocRef = doc(db, 'users', user.uid);
      const docSnap = await getDoc(userDocRef);
      if (docSnap.exists()) {
        const userData = docSnap.data();
        return userData.avatarUrl || user.photoURL || null;
      }
      return user.photoURL || null;
    } catch (error) {
      console.warn('Error fetching avatar URL from Firestore, using photoURL:', error);
      return user.photoURL || null;
    }
  }

  /**
   * Notify all observers of auth state changes
   * @private
   * @param {Object} authState - Current auth state
   */
  _notifyObservers(authState) {
    this._observers.forEach((observer) => {
      try {
        observer(authState);
      } catch (error) {
        console.error('Error in auth observer:', error);
      }
    });
  }

  /**
   * Dispatch auth state changed event
   * @private
   * @param {Object} detail - Event detail object
   */
  _dispatchAuthEvent(detail) {
    this._dispatchEvent('auth-state-changed', detail);
  }

  /**
   * Dispatch custom event
   * @private
   * @param {string} name - Event name
   * @param {Object} detail - Event detail object
   */
  _dispatchEvent(name, detail) {
    const event = new CustomEvent(name, {
      detail: detail,
      bubbles: true,
      composed: true,
    });
    document.dispatchEvent(event);
  }

  /**
   * Handle authentication errors
   * @private
   * @param {string} operation - Operation that caused the error
   * @param {Error} error - Error object
   */
  _handleAuthError(operation, error) {
    console.error(`Auth error during ${operation}:`, error);

    // Dispatch auth error event
    this._dispatchEvent('auth-error', {
      operation: operation,
      code: error.code,
      message: error.message,
      error: error,
    });
  }

  // For testing purposes only
  static _resetInstanceForTest() {
    AuthService.instance = null;
  }
}

// Ensure there's only one instance (singleton pattern)
AuthService.instance = null;

// Create and export the singleton instance
const authService = new AuthService();

// Export both the class and the singleton instance
export { AuthService, authService as default };
