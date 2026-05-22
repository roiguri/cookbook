// src/js/services/firestore-service.js

import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  orderBy,
  limit,
  addDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  setDoc,
} from 'firebase/firestore';
import { getFirestoreInstance } from './firebase-service.js';

/**
 * FirestoreService - Centralized Firestore Database Manager
 *
 * This service provides a unified interface for Firestore database operations,
 * abstracting the details of the Firebase Firestore SDK.
 *
 * Public Methods:
 *   - getDocument(collectionName, id): Fetch a document by ID from a collection.
 *   - queryDocuments(collectionName, queryParams): Query documents with filters, ordering, and limit.
 *   - addDocument(collectionName, data): Add a new document to a collection.
 *   - updateDocument(collectionName, id, data): Update an existing document in a collection.
 *   - deleteDocument(collectionName, id): Delete a document from a collection.
 *   - batchWrite(operations): Perform multiple writes in a batch (set, update, delete).
 *
 * Usage:
 *   Import and use FirestoreService methods for all Firestore operations in the app.
 *   Do not use Firebase Firestore SDK directly in UI or business logic layers.
 */
export class FirestoreService {
  /**
   * Fetch a document by ID from a collection.
   * @param {string} collectionName - The collection name
   * @param {string} id - The document ID
   * @returns {Promise<Object|null>} The document data or null if not found
   */
  static async getDocument(collectionName, id) {
    try {
      const db = getFirestoreInstance();
      const docRef = doc(db, collectionName, id);
      const docSnap = await getDoc(docRef);
      return docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null;
    } catch (error) {
      console.error('Error fetching document:', error);
      throw new Error('Failed to fetch document');
    }
  }

  /**
   * Query documents with filters, ordering, and limit.
   * @param {string} collectionName - The collection name
   * @param {Object} queryParams - { where: [[field, op, value], ...], orderBy: [field, direction], limit: number }
   * @returns {Promise<Array>} Array of document data
   */
  static async queryDocuments(collectionName, queryParams = {}) {
    try {
      const db = getFirestoreInstance();
      let q = collection(db, collectionName);
      const filters = [];
      if (queryParams.where) {
        for (const [field, op, value] of queryParams.where) {
          filters.push(where(field, op, value));
        }
      }
      if (queryParams.orderBy) {
        const [field, direction] = queryParams.orderBy;
        filters.push(orderBy(field, direction));
      }
      if (queryParams.limit) {
        filters.push(limit(queryParams.limit));
      }
      if (filters.length > 0) {
        q = query(q, ...filters);
      }
      const snapshot = await getDocs(q);
      return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    } catch (error) {
      console.error('Error querying documents:', error);
      throw new Error('Failed to query documents');
    }
  }

  /**
   * Generate a new document ID without saving it.
   * @param {string} collectionName - The collection name
   * @returns {string} The new document ID
   */
  static generateId(collectionName) {
    const db = getFirestoreInstance();
    return doc(collection(db, collectionName)).id;
  }

  /**
   * Set a document with a specific ID.
   * @param {string} collectionName - The collection name
   * @param {string} id - The document ID
   * @param {Object} data - The document data
   * @returns {Promise<void>}
   */
  static async setDocument(collectionName, id, data) {
    try {
      const db = getFirestoreInstance();
      const docRef = doc(db, collectionName, id);
      await setDoc(docRef, data);
    } catch (error) {
      console.error('Error setting document:', error);
      throw new Error('Failed to set document');
    }
  }

  /**
   * Add a new document to a collection.
   * @param {string} collectionName - The collection name
   * @param {Object} data - The document data
   * @returns {Promise<string>} The new document ID
   */
  static async addDocument(collectionName, data) {
    try {
      const db = getFirestoreInstance();
      const colRef = collection(db, collectionName);
      const docRef = await addDoc(colRef, data);
      return docRef.id;
    } catch (error) {
      console.error('Error adding document:', error);
      throw new Error('Failed to add document');
    }
  }

  /**
   * Update an existing document in a collection.
   * @param {string} collectionName - The collection name
   * @param {string} id - The document ID
   * @param {Object} data - The updated data
   * @returns {Promise<void>}
   */
  static async updateDocument(collectionName, id, data) {
    try {
      const db = getFirestoreInstance();
      const docRef = doc(db, collectionName, id);
      await updateDoc(docRef, data);
    } catch (error) {
      console.error('Error updating document:', error);
      throw new Error('Failed to update document');
    }
  }

  /**
   * Delete a document from a collection.
   * @param {string} collectionName - The collection name
   * @param {string} id - The document ID
   * @returns {Promise<void>}
   */
  static async deleteDocument(collectionName, id) {
    try {
      const db = getFirestoreInstance();
      const docRef = doc(db, collectionName, id);
      await deleteDoc(docRef);
    } catch (error) {
      console.error('Error deleting document:', error);
      throw new Error('Failed to delete document');
    }
  }

  /**
   * Perform multiple writes in a batch.
   * @param {Array} operations - Array of { type, collection, id, data }
   * @returns {Promise<void>}
   */
  static async batchWrite(operations) {
    try {
      const db = getFirestoreInstance();
      const batch = writeBatch(db);
      for (const op of operations) {
        const docRef = doc(db, op.collection, op.id);
        if (op.type === 'set') {
          batch.set(docRef, op.data, op.options);
        } else if (op.type === 'update') {
          batch.update(docRef, op.data);
        } else if (op.type === 'delete') {
          batch.delete(docRef);
        }
      }
      await batch.commit();
    } catch (error) {
      console.error('Error performing batch write:', error);
      throw new Error('Failed to perform batch write');
    }
  }
}

// Optionally, export a singleton instance
export const firestoreService = FirestoreService;
