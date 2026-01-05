/**
 * Project Routes
 * Handles project CRUD operations
 */

import { Router, Request, Response } from 'express';
import { verifyToken } from '../../lib/auth';
import { UserService } from '../../services/user.service';
import { ProjectService } from '../../services/project.service';
import { AssetService } from '../../services/asset.service';

const router = Router();

// Helper to serialize Firestore timestamps to ISO strings
function serializeProject(project: any) {
    return {
        ...project,
        created_at: project.created_at?.toDate?.() ? project.created_at.toDate().toISOString() : project.created_at,
        updated_at: project.updated_at?.toDate?.() ? project.updated_at.toDate().toISOString() : project.updated_at,
    };
}

function serializeAsset(asset: any) {
    return {
        ...asset,
        created_at: asset.created_at?.toDate?.() ? asset.created_at.toDate().toISOString() : asset.created_at,
        updated_at: asset.updated_at?.toDate?.() ? asset.updated_at.toDate().toISOString() : asset.updated_at,
    };
}

// GET /api/projects - List user's projects
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

        const { type, status, limit = '50' } = req.query;

        const projects = await ProjectService.list({
            user_id: user.id,
            type: type as 'sprite' | 'scene' | undefined,
            status: (status as 'draft' | 'active' | 'archived' | 'deleted') || 'active',
            limit: parseInt(limit as string),
        });

        res.json({ success: true, projects: projects.map(serializeProject) });
    } catch (error: any) {
        console.error('List projects error:', error);
        res.status(500).json({ error: 'Failed to list projects' });
    }
});

// GET /api/projects/:id - Get project details with assets
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
        const project = await ProjectService.findByIdWithStats(id, user.id);

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Get assets for this project
        const assets = await AssetService.list({
            project_id: id,
            user_id: user.id,
            status: 'active',
            limit: 100,
        });

        res.json({
            success: true,
            project: serializeProject(project),
            assets: assets.map(serializeAsset),
        });
    } catch (error: any) {
        console.error('Get project error:', error);
        res.status(500).json({ error: 'Failed to get project' });
    }
});

// POST /api/projects - Create new project
router.post('/', async (req: Request, res: Response) => {
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

        const { title, type, description, color, settings } = req.body;

        if (!title || !type) {
            return res.status(400).json({ error: 'Title and type are required' });
        }

        const project = await ProjectService.create({
            user_id: user.id,
            title,
            type,
            description,
            color,
            settings,
            status: 'active',
        });

        res.json({ success: true, project: serializeProject(project) });
    } catch (error: any) {
        console.error('Create project error:', error);
        res.status(500).json({ error: 'Failed to create project' });
    }
});

// PUT /api/projects/:id - Update project
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
        const { title, description, color, settings, status } = req.body;

        const project = await ProjectService.update(id, user.id, {
            title,
            description,
            color,
            settings,
            status,
        });

        res.json({ success: true, project: serializeProject(project) });
    } catch (error: any) {
        console.error('Update project error:', error);
        res.status(500).json({ error: 'Failed to update project' });
    }
});

// DELETE /api/projects/:id - Delete project (hard delete with all assets cleanup)
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

        // Use hard delete to remove project AND all its assets from Firestore and Storage
        const result = await ProjectService.hardDelete(id, user.id);

        res.json({
            success: true,
            message: 'Project and all assets permanently deleted',
            assetsDeleted: result.assetsDeleted
        });
    } catch (error: any) {
        console.error('Delete project error:', error);
        res.status(500).json({ error: 'Failed to delete project' });
    }
});

export default router;
