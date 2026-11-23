import { buildDeviceRecord } from '@cookbook/core/push-devices';
import {
  deleteDocument,
  getDocument,
  listDocuments,
  serverTimestamp,
  setDocument,
  updateDocument,
} from '../_firebase/firestore-adapter';
import { deleteStorageFile } from '../_firebase/storage-adapter';
import { captureError } from '../logger';
import type { UserProfileDoc } from './session-service';

export type { UserProfileDoc };

export const UserService = {
  async get(uid: string): Promise<UserProfileDoc | null> {
    return getDocument<UserProfileDoc>('users', uid);
  },

  async listAll(): Promise<UserProfileDoc[]> {
    return listDocuments<UserProfileDoc>('users');
  },

  /**
   * INV-P0-02: Client signup ALWAYS creates users/{uid} with hardcoded role: 'user'.
   */
  async create(
    uid: string,
    {
      fullName,
      email,
      avatarUrl = null,
    }: { fullName: string; email: string; avatarUrl?: string | null },
  ): Promise<void> {
    await setDocument(
      'users',
      {
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        role: 'user',
        bio: '',
        avatarUrl,
        avatarConfig: null,
        favorites: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: false },
      uid,
    );
  },

  /**
   * Updates non-role profile fields on users/{uid}. Strips `role` to enforce INV-P0-02.
   */
  async update(uid: string, fields: Partial<Omit<UserProfileDoc, 'id' | 'role'>>): Promise<void> {
    const safe: Record<string, any> = { ...fields };
    delete safe.role;
    delete safe.id;
    safe.updatedAt = serverTimestamp();
    await updateDocument('users', safe, uid);
  },

  /**
   * Manager-only role update (enforced by firestore.rules).
   */
  async updateRole(uid: string, role: 'user' | 'approved' | 'manager'): Promise<void> {
    await updateDocument(
      'users',
      {
        role,
        updatedAt: serverTimestamp(),
      },
      uid,
    );
  },

  async delete(uid: string): Promise<void> {
    await deleteDocument('users', uid);
  },

  async deleteAvatar(uid: string): Promise<void> {
    try {
      await deleteStorageFile(`user-avatars/${uid}.png`);
    } catch (err) {
      captureError(err, { service: 'user', op: 'deleteAvatar', uid });
    }
  },

  async deleteActiveMeal(uid: string): Promise<void> {
    try {
      await deleteDocument('active_meals', uid);
    } catch {
      // May not exist
    }
  },

  /**
   * 3-arg signature matching Slice 11 & Web UserService.registerDevice(uid, deviceId, device).
   */
  async registerDevice(
    uid: string,
    deviceId: string,
    device: { token: string; platform: 'web' | 'android' | 'ios'; ua?: string },
  ): Promise<void> {
    const record = buildDeviceRecord({
      token: device.token,
      platform: device.platform,
      updatedAt: serverTimestamp(),
      ...(device.ua ? { ua: device.ua } : {}),
    });
    await setDocument('users', record, { merge: false }, uid, 'devices', deviceId);
  },

  async unregisterDevice(uid: string, deviceId: string): Promise<void> {
    try {
      await deleteDocument('users', uid, 'devices', deviceId);
    } catch {
      // Already removed
    }
  },

  async listDevices(uid: string) {
    return listDocuments<{ token: string; platform: string; updatedAt: any }>(
      `users/${uid}/devices`,
    );
  },

  async deleteAllDevices(uid: string): Promise<void> {
    try {
      const devices = await this.listDevices(uid);
      await Promise.all(devices.map((d) => this.unregisterDevice(uid, d.id)));
    } catch {
      // Best-effort cleanup on account delete
    }
  },
};
