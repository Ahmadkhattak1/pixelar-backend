"use strict";
/**
 * Asset Service - Firestore
 * Handles saving and retrieving generated assets (sprites, scenes, animations)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssetService = void 0;
const db_1 = require("../lib/db");
const firestore_1 = require("firebase-admin/firestore");
class AssetService {
    /**
     * Find asset by ID
     */
    static async findById(id, userId) {
        const doc = await (0, db_1.getCollection)('assets').doc(id).get();
        if (!doc.exists)
            return null;
        const data = doc.data();
        if (userId && data.user_id !== userId)
            return null;
        return { id: doc.id, ...data };
    }
    /**
     * List assets with filters
     */
    static async list(filters) {
        let query = (0, db_1.getCollection)('assets');
        if (filters.user_id) {
            query = query.where('user_id', '==', filters.user_id);
        }
        if (filters.project_id) {
            query = query.where('project_id', '==', filters.project_id);
        }
        if (filters.asset_type) {
            query = query.where('asset_type', '==', filters.asset_type);
        }
        if (filters.status) {
            query = query.where('status', '==', filters.status);
        }
        else {
            query = query.where('status', '==', 'active');
        }
        const orderBy = filters.order_by || 'created_at';
        const order = filters.order || 'desc';
        query = query.orderBy(orderBy, order);
        const limit = filters.limit || 50;
        query = query.limit(limit);
        const snapshot = await query.get();
        return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }
    /**
     * Create a new asset
     */
    static async create(input) {
        const now = firestore_1.Timestamp.now();
        const assetData = {
            project_id: input.project_id || null,
            user_id: input.user_id,
            name: input.name || null,
            asset_type: input.asset_type,
            file_type: input.file_type,
            blob_url: input.blob_url,
            blob_path: input.blob_path || null,
            file_size: input.file_size || null,
            width: input.width || null,
            height: input.height || null,
            mime_type: input.mime_type || null,
            metadata: input.metadata || {},
            status: 'active',
            created_at: now,
            updated_at: now,
        };
        const docRef = await (0, db_1.getCollection)('assets').add(assetData);
        const doc = await docRef.get();
        const asset = { id: doc.id, ...doc.data() };
        // Auto-set project thumbnail if first asset
        if (input.project_id && input.blob_url) {
            try {
                const ProjectService = require('./project.service').ProjectService;
                const project = await ProjectService.findById(input.project_id, input.user_id);
                if (project && !project.thumbnail_url) {
                    await ProjectService.update(project.id, input.user_id, {
                        thumbnail_url: input.blob_url
                    });
                }
            }
            catch (error) {
                console.error("Failed to auto-set project thumbnail:", error);
            }
        }
        return asset;
    }
    /**
     * Create multiple assets at once (for sprite sheets, animations)
     */
    static async createMany(inputs) {
        const assets = [];
        for (const input of inputs) {
            const asset = await this.create(input);
            assets.push(asset);
        }
        return assets;
    }
    /**
     * Update asset
     */
    static async update(id, userId, updates) {
        const asset = await this.findById(id, userId);
        if (!asset)
            throw new Error('Asset not found');
        const updateData = { updated_at: firestore_1.Timestamp.now() };
        if (updates.name !== undefined)
            updateData.name = updates.name;
        if (updates.project_id !== undefined)
            updateData.project_id = updates.project_id;
        if (updates.metadata !== undefined)
            updateData.metadata = { ...asset.metadata, ...updates.metadata };
        await (0, db_1.getCollection)('assets').doc(id).update(updateData);
        const updatedAsset = await this.findById(id, userId);
        // Auto-set project thumbnail if asset is assigned to a project and project has no thumbnail
        if (updates.project_id && updatedAsset.blob_url) {
            try {
                const ProjectService = require('./project.service').ProjectService;
                const project = await ProjectService.findById(updates.project_id, userId);
                if (project && !project.thumbnail_url) {
                    await ProjectService.update(project.id, userId, {
                        thumbnail_url: updatedAsset.blob_url
                    });
                }
            }
            catch (error) {
                console.error("Failed to auto-set project thumbnail on asset update:", error);
            }
        }
        return updatedAsset;
    }
    /**
     * Delete asset (soft delete)
     */
    static async delete(id, userId) {
        const asset = await this.findById(id, userId);
        if (!asset)
            throw new Error('Asset not found');
        await (0, db_1.getCollection)('assets').doc(id).update({
            status: 'deleted',
            updated_at: firestore_1.Timestamp.now(),
        });
    }
    /**
     * Hard delete asset - removes from Firestore AND Firebase Storage
     */
    static async hardDelete(id, userId) {
        const asset = await this.findById(id, userId);
        if (!asset)
            throw new Error('Asset not found');
        // Delete file from Firebase Storage
        if (asset.blob_url) {
            try {
                // Extract the file path from the signed URL
                // URL format: https://storage.googleapis.com/bucket-name/path/to/file.png?...
                const url = new URL(asset.blob_url);
                const pathMatch = url.pathname.match(/\/[^\/]+\/(.+)/);
                if (pathMatch) {
                    const filePath = decodeURIComponent(pathMatch[1]);
                    console.log(`[Storage] Deleting file: ${filePath}`);
                    const bucket = (0, db_1.getStorageBucket)();
                    const file = bucket.file(filePath);
                    // Check if file exists before deleting
                    const [exists] = await file.exists();
                    if (exists) {
                        await file.delete();
                        console.log(`[Storage] File deleted successfully: ${filePath}`);
                    }
                    else {
                        console.log(`[Storage] File not found (already deleted?): ${filePath}`);
                    }
                }
            }
            catch (storageError) {
                console.error('[Storage] Error deleting file:', storageError);
                // Continue with Firestore deletion even if storage deletion fails
            }
        }
        // Hard delete from Firestore
        await (0, db_1.getCollection)('assets').doc(id).delete();
        console.log(`[Firestore] Asset hard deleted: ${id}`);
    }
    /**
     * Hard delete multiple assets by project
     */
    static async hardDeleteByProject(projectId, userId) {
        const assets = await this.list({
            project_id: projectId,
            user_id: userId,
            status: 'active',
            limit: 1000
        });
        // Also get soft-deleted assets
        const deletedAssets = await this.list({
            project_id: projectId,
            user_id: userId,
            status: 'deleted',
            limit: 1000
        });
        const allAssets = [...assets, ...deletedAssets];
        let deletedCount = 0;
        for (const asset of allAssets) {
            try {
                await this.hardDelete(asset.id, userId);
                deletedCount++;
            }
            catch (error) {
                console.error(`Failed to hard delete asset ${asset.id}:`, error);
            }
        }
        return deletedCount;
    }
    /**
     * Get user's recent creations
     */
    static async getRecentByUser(userId, limit = 20) {
        return this.list({
            user_id: userId,
            status: 'active',
            limit,
            order_by: 'created_at',
            order: 'desc',
        });
    }
    /**
     * Get assets by type for a user
     */
    static async getByType(userId, assetType, limit = 50) {
        return this.list({
            user_id: userId,
            asset_type: assetType,
            status: 'active',
            limit,
        });
    }
}
exports.AssetService = AssetService;
