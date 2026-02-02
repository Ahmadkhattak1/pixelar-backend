"use strict";
/**
 * Firestore Database Connection Utility
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = getDb;
exports.getCollection = getCollection;
exports.healthCheck = healthCheck;
exports.getStorageInstance = getStorageInstance;
exports.getStorageBucket = getStorageBucket;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const storage_1 = require("firebase-admin/storage");
const firestore_collections_1 = require("../schemas/firestore-collections");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
let firestore = null;
/**
 * Initialize Firestore
 */
function getFirestoreInstance() {
    if (firestore) {
        return firestore;
    }
    let app = null;
    const apps = (0, app_1.getApps)();
    // Storage bucket name
    const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || 'pixelar-webapp.firebasestorage.app';
    if (apps.length > 0) {
        app = apps[0];
    }
    else {
        // Try to load from service account JSON file first
        const serviceAccountPath = path.join(__dirname, '../pixelar-webapp-firebase-adminsdk-fbsvc-03ee05ff4b.json');
        if (fs.existsSync(serviceAccountPath)) {
            const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
            app = (0, app_1.initializeApp)({
                credential: (0, app_1.cert)(serviceAccount),
                storageBucket,
            });
        }
        else {
            // Fall back to environment variables
            const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
            const projectId = process.env.FIREBASE_PROJECT_ID;
            if (!privateKey || !projectId) {
                throw new Error('Firebase credentials not configured. Either provide service account JSON file or set FIREBASE_PRIVATE_KEY and FIREBASE_PROJECT_ID');
            }
            app = (0, app_1.initializeApp)({
                credential: (0, app_1.cert)({
                    projectId,
                    privateKey,
                    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                }),
                storageBucket,
            });
        }
    }
    firestore = (0, firestore_1.getFirestore)(app);
    return firestore;
}
/**
 * Get Firestore instance
 */
function getDb() {
    return getFirestoreInstance();
}
/**
 * Get collection reference
 */
function getCollection(collectionName) {
    return getDb().collection(firestore_collections_1.FIRESTORE_COLLECTIONS[collectionName]);
}
/**
 * Health check - test Firestore connection
 */
async function healthCheck() {
    try {
        const db = getDb();
        await db.collection('_health').doc('check').get();
        return true;
    }
    catch (error) {
        console.error('Firestore health check failed:', error);
        return false;
    }
}
/**
 * Get Storage instance
 */
let storage = null;
function getStorageInstance() {
    if (storage)
        return storage;
    // Ensure app initialized
    getFirestoreInstance();
    const app = (0, app_1.getApps)()[0];
    storage = (0, storage_1.getStorage)(app);
    return storage;
}
/**
 * Get Storage Bucket
 * Defaults to default bucket if name not specified
 */
function getStorageBucket(bucketName) {
    const bucket = bucketName || process.env.FIREBASE_STORAGE_BUCKET || 'pixelar-webapp.firebasestorage.app';
    return getStorageInstance().bucket(bucket);
}
