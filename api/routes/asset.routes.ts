/**
 * Asset Routes
 * Handles asset management operations
 */

import { Router, Request, Response } from 'express';
import { verifyToken } from '../../lib/auth';
import { UserService } from '../../services/user.service';
import { AssetService } from '../../services/asset.service';
import { ProjectService } from '../../services/project.service';
import { uploadGeneratedImage } from '../../services/generation.service';

const router = Router();

// Helper to serialize Firestore timestamps to ISO strings
function serializeAsset(asset: any) {
    return {
        ...asset,
        created_at: asset.created_at?.toDate?.() ? asset.created_at.toDate().toISOString() : asset.created_at,
        updated_at: asset.updated_at?.toDate?.() ? asset.updated_at.toDate().toISOString() : asset.updated_at,
    };
}

// POST /api/assets/upload - Upload user asset (import)
router.post('/upload', async (req: Request, res: Response) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing authorization' });
        }

        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await verifyToken(token);
        if (!decodedToken) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        const user = await UserService.findByFirebaseUid(decodedToken.uid);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const { name, type, image, createProject, projectId: requestedProjectId } = req.body;

        if (!image || !image.startsWith('data:')) {
            return res.status(400).json({ error: 'Invalid image data' });
        }

        // Upload image to Firebase Storage
        const assetType = type === 'scene' ? 'scene' : 'sprite';
        const blobUrl = await uploadGeneratedImage(image, user.id, assetType);

        // Determine Project ID
        let projectId = requestedProjectId;

        // Create project if requested AND no project ID provided
        if (createProject && !projectId) {
            const project = await ProjectService.create({
                user_id: user.id,
                title: name || `Imported ${assetType}`,
                description: `Imported ${assetType} asset`,
                type: assetType,
            });
            projectId = project.id;
        }

        // Create asset record
        const asset = await AssetService.create({
            project_id: projectId,
            user_id: user.id,
            name: name || `imported_${assetType}_${Date.now()}`,
            asset_type: assetType,
            file_type: 'png',
            blob_url: blobUrl,
            metadata: {
                source: 'user_upload',
                imported_at: new Date().toISOString(),
            },
        });

        res.json({
            success: true,
            asset: serializeAsset(asset),
            projectId,
        });
    } catch (error: any) {
        console.error('Upload asset error:', error);
        res.status(500).json({ error: error.message || 'Failed to upload asset' });
    }
});

// GET /api/assets - List user's assets
router.get('/', async (req: Request, res: Response) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing authorization' });
        }

        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await verifyToken(token);
        if (!decodedToken) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        const user = await UserService.findByFirebaseUid(decodedToken.uid);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const { unassigned, asset_type, limit } = req.query;

        // Build filters
        const filters: any = {
            user_id: user.id,
            status: 'active',
            limit: limit ? parseInt(limit as string) : 50,
        };

        if (asset_type) {
            filters.asset_type = asset_type as string;
        }

        let assets = await AssetService.list(filters);

        // Filter for unassigned assets (no project_id)
        if (unassigned === 'true') {
            assets = assets.filter(a => !a.project_id);
        }

        res.json({ success: true, assets: assets.map(serializeAsset) });
    } catch (error: any) {
        console.error('List assets error:', error);
        res.status(500).json({ error: 'Failed to list assets' });
    }
});

// GET /api/assets/:id - Get single asset
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing authorization' });
        }

        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await verifyToken(token);
        if (!decodedToken) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        const user = await UserService.findByFirebaseUid(decodedToken.uid);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const { id } = req.params;
        const asset = await AssetService.findById(id, user.id);

        if (!asset) {
            return res.status(404).json({ error: 'Asset not found' });
        }

        res.json({ success: true, asset: serializeAsset(asset) });
    } catch (error: any) {
        console.error('Get asset error:', error);
        res.status(500).json({ error: 'Failed to get asset' });
    }
});

// PUT /api/assets/:id - Update asset (e.g., add to project)
router.put('/:id', async (req: Request, res: Response) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing authorization' });
        }

        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await verifyToken(token);
        if (!decodedToken) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        const user = await UserService.findByFirebaseUid(decodedToken.uid);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const { id } = req.params;
        const { name, project_id, metadata } = req.body;

        const asset = await AssetService.update(id, user.id, {
            name,
            project_id,
            metadata,
        });

        res.json({ success: true, asset: serializeAsset(asset) });
    } catch (error: any) {
        if (error.message === 'Asset not found') {
            return res.status(404).json({ error: 'Asset not found' });
        }
        console.error('Update asset error:', error);
        res.status(500).json({ error: 'Failed to update asset' });
    }
});

// DELETE /api/assets/:id - Delete asset (hard delete with storage cleanup)
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing authorization' });
        }

        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await verifyToken(token);
        if (!decodedToken) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        const user = await UserService.findByFirebaseUid(decodedToken.uid);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const { id } = req.params;

        // Use hard delete to remove from both Firestore AND Firebase Storage
        await AssetService.hardDelete(id, user.id);

        res.json({ success: true, message: 'Asset permanently deleted' });
    } catch (error: any) {
        console.error('Delete asset error:', error);
        res.status(500).json({ error: 'Failed to delete asset' });
    }
});

export default router;
