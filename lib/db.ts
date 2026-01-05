/**
 * Firestore Database Connection Utility
 */

import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage, type Storage } from 'firebase-admin/storage';
import { FIRESTORE_COLLECTIONS } from '../schemas/firestore-collections';
import * as path from 'path';
import * as fs from 'fs';

let firestore: Firestore | null = null;

/**
 * Initialize Firestore
 */
function getFirestoreInstance(): Firestore {
  if (firestore) {
    return firestore;
  }

  let app: App | null = null;
  const apps = getApps();

  // Storage bucket name
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || 'pixelar-webapp.firebasestorage.app';

  if (apps.length > 0) {
    app = apps[0];
  } else {
    // Try to load from service account JSON file first
    const serviceAccountPath = path.join(__dirname, '../pixelar-webapp-firebase-adminsdk-fbsvc-03ee05ff4b.json');

    if (fs.existsSync(serviceAccountPath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
      app = initializeApp({
        credential: cert(serviceAccount),
        storageBucket,
      });
    } else {
      // Fall back to environment variables
      const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
      const projectId = process.env.FIREBASE_PROJECT_ID;

      if (!privateKey || !projectId) {
        throw new Error('Firebase credentials not configured. Either provide service account JSON file or set FIREBASE_PRIVATE_KEY and FIREBASE_PROJECT_ID');
      }

      app = initializeApp({
        credential: cert({
          projectId,
          privateKey,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
        storageBucket,
      });
    }
  }

  firestore = getFirestore(app);
  return firestore;
}

/**
 * Get Firestore instance
 */
export function getDb(): Firestore {
  return getFirestoreInstance();
}

/**
 * Get collection reference
 */
export function getCollection(collectionName: keyof typeof FIRESTORE_COLLECTIONS) {
  return getDb().collection(FIRESTORE_COLLECTIONS[collectionName]);
}

/**
 * Health check - test Firestore connection
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const db = getDb();
    await db.collection('_health').doc('check').get();
    return true;
  } catch (error) {
    console.error('Firestore health check failed:', error);
    return false;
  }
}

/**
 * Get Storage instance
 */
let storage: Storage | null = null;
export function getStorageInstance(): Storage {
  if (storage) return storage;

  // Ensure app initialized
  getFirestoreInstance();

  const app = getApps()[0];
  storage = getStorage(app);
  return storage;
}

/**
 * Get Storage Bucket
 * Defaults to default bucket if name not specified
 */
export function getStorageBucket(bucketName?: string) {
  const bucket = bucketName || process.env.FIREBASE_STORAGE_BUCKET || 'pixelar-webapp.firebasestorage.app';
  return getStorageInstance().bucket(bucket);
}

