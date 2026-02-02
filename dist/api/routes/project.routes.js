"use strict";
/**
 * Project Routes
 * Handles project CRUD operations
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../../lib/auth");
const user_service_1 = require("../../services/user.service");
const project_service_1 = require("../../services/project.service");
const asset_service_1 = require("../../services/asset.service");
const router = (0, express_1.Router)();
// Helper to serialize Firestore timestamps to ISO strings
function serializeProject(project) {
    return {
        ...project,
        created_at: project.created_at?.toDate?.() ? project.created_at.toDate().toISOString() : project.created_at,
        updated_at: project.updated_at?.toDate?.() ? project.updated_at.toDate().toISOString() : project.updated_at,
    };
}
function serializeAsset(asset) {
    return {
        ...asset,
        created_at: asset.created_at?.toDate?.() ? asset.created_at.toDate().toISOString() : asset.created_at,
        updated_at: asset.updated_at?.toDate?.() ? asset.updated_at.toDate().toISOString() : asset.updated_at,
    };
}
// GET /api/projects - List user's projects
router.get('/', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing authorization' });
        }
        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await (0, auth_1.verifyToken)(token);
        if (!decodedToken) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        const user = await user_service_1.UserService.findByFirebaseUid(decodedToken.uid);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        const { type, status, limit = '50' } = req.query;
        const projects = await project_service_1.ProjectService.list({
            user_id: user.id,
            type: type,
            status: status || 'active',
            limit: parseInt(limit),
        });
        res.json({ success: true, projects: projects.map(serializeProject) });
    }
    catch (error) {
        console.error('List projects error:', error);
        res.status(500).json({ error: 'Failed to list projects' });
    }
});
// GET /api/projects/:id - Get project details with assets
router.get('/:id', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing authorization' });
        }
        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await (0, auth_1.verifyToken)(token);
        if (!decodedToken) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        const user = await user_service_1.UserService.findByFirebaseUid(decodedToken.uid);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        const { id } = req.params;
        const project = await project_service_1.ProjectService.findByIdWithStats(id, user.id);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }
        // Get assets for this project
        const assets = await asset_service_1.AssetService.list({
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
    }
    catch (error) {
        console.error('Get project error:', error);
        res.status(500).json({ error: 'Failed to get project' });
    }
});
// POST /api/projects - Create new project
router.post('/', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing authorization' });
        }
        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await (0, auth_1.verifyToken)(token);
        if (!decodedToken) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        const user = await user_service_1.UserService.findByFirebaseUid(decodedToken.uid);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        const { title, type, description, color, settings } = req.body;
        if (!title || !type) {
            return res.status(400).json({ error: 'Title and type are required' });
        }
        const project = await project_service_1.ProjectService.create({
            user_id: user.id,
            title,
            type,
            description,
            color,
            settings,
            status: 'active',
        });
        res.json({ success: true, project: serializeProject(project) });
    }
    catch (error) {
        console.error('Create project error:', error);
        res.status(500).json({ error: 'Failed to create project' });
    }
});
// PUT /api/projects/:id - Update project
router.put('/:id', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing authorization' });
        }
        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await (0, auth_1.verifyToken)(token);
        if (!decodedToken) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        const user = await user_service_1.UserService.findByFirebaseUid(decodedToken.uid);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        const { id } = req.params;
        const { title, description, color, settings, status } = req.body;
        const project = await project_service_1.ProjectService.update(id, user.id, {
            title,
            description,
            color,
            settings,
            status,
        });
        res.json({ success: true, project: serializeProject(project) });
    }
    catch (error) {
        console.error('Update project error:', error);
        res.status(500).json({ error: 'Failed to update project' });
    }
});
// DELETE /api/projects/:id - Delete project (hard delete with all assets cleanup)
router.delete('/:id', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing authorization' });
        }
        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await (0, auth_1.verifyToken)(token);
        if (!decodedToken) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        const user = await user_service_1.UserService.findByFirebaseUid(decodedToken.uid);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        const { id } = req.params;
        // Use hard delete to remove project AND all its assets from Firestore and Storage
        const result = await project_service_1.ProjectService.hardDelete(id, user.id);
        res.json({
            success: true,
            message: 'Project and all assets permanently deleted',
            assetsDeleted: result.assetsDeleted
        });
    }
    catch (error) {
        console.error('Delete project error:', error);
        res.status(500).json({ error: 'Failed to delete project' });
    }
});
exports.default = router;
