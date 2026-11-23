import {
  Timestamp,
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  collectionGroup,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type QueryConstraint,
} from 'firebase/firestore';
import { ensureFirebaseReady, getFirebaseDb } from './firebase-app';

export { Timestamp, arrayRemove, arrayUnion, deleteField, limit, orderBy, serverTimestamp, where };
export type { QueryConstraint };

export function docRef(path: string, ...segments: string[]) {
  ensureFirebaseReady();
  return doc(getFirebaseDb(), path, ...segments);
}

export function colRef(path: string, ...segments: string[]) {
  ensureFirebaseReady();
  return collection(getFirebaseDb(), path, ...segments);
}

export function colGroupRef(collectionId: string) {
  ensureFirebaseReady();
  return collectionGroup(getFirebaseDb(), collectionId);
}

export async function getDocument<T = Record<string, any>>(
  path: string,
  ...segments: string[]
): Promise<(T & { id: string }) | null> {
  const snap = await getDoc(docRef(path, ...segments));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as T) };
}

export async function listDocuments<T = Record<string, any>>(
  collectionPath: string,
  constraints: QueryConstraint[] = [],
): Promise<Array<T & { id: string }>> {
  const q = query(colRef(collectionPath), ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) }));
}

export async function listCollectionGroup<T = Record<string, any>>(
  collectionId: string,
  constraints: QueryConstraint[] = [],
): Promise<Array<T & { id: string; _path: string; _parentId: string | null }>> {
  const q = query(colGroupRef(collectionId), ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({
    id: d.id,
    _path: d.ref.path,
    _parentId: d.ref.parent.parent?.id || null,
    ...(d.data() as T),
  }));
}

export async function setDocument(
  path: string,
  data: Record<string, any>,
  options?: { merge?: boolean },
  ...segments: string[]
) {
  return setDoc(docRef(path, ...segments), data, options || {});
}

export async function addDocument(collectionPath: string, data: Record<string, any>) {
  return addDoc(colRef(collectionPath), data);
}

export async function updateDocument(
  path: string,
  data: Record<string, any>,
  ...segments: string[]
) {
  return updateDoc(docRef(path, ...segments), data);
}

export async function deleteDocument(path: string, ...segments: string[]) {
  return deleteDoc(docRef(path, ...segments));
}

export function subscribeDocument<T = Record<string, any>>(
  path: string,
  onData: (data: (T & { id: string }) | null) => void,
  onError?: (err: Error) => void,
  ...segments: string[]
): () => void {
  return onSnapshot(
    docRef(path, ...segments),
    (snap) => {
      onData(snap.exists() ? { id: snap.id, ...(snap.data() as T) } : null);
    },
    onError,
  );
}

export function subscribeCollection<T = Record<string, any>>(
  collectionPath: string,
  constraints: QueryConstraint[],
  onData: (items: Array<T & { id: string }>) => void,
  onError?: (err: Error) => void,
): () => void {
  const q = query(colRef(collectionPath), ...constraints);
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) })));
    },
    onError,
  );
}

export function createWriteBatch() {
  ensureFirebaseReady();
  return writeBatch(getFirebaseDb());
}

export function generateDocId(collectionPath: string): string {
  return doc(colRef(collectionPath)).id;
}
