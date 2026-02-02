"use strict";
/**
 * Spritesheet Routes
 * Handles spritesheet generation endpoints
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../../lib/auth");
const spritesheet_service_1 = require("../../services/spritesheet.service");
const user_service_1 = require("../../services/user.service");
const asset_service_1 = require("../../services/asset.service");
const project_service_1 = require("../../services/project.service");
const router = (0, express_1.Router)();
// Helper to serialize Firestore timestamps
function serializeAsset(asset) {
    return {
        ...asset,
        created_at: asset.created_at?.toDate?.() ? asset.created_at.toDate().toISOString() : asset.created_at,
        updated_at: asset.updated_at?.toDate?.() ? asset.updated_at.toDate().toISOString() : asset.updated_at,
    };
}
// GET /api/spritesheet/presets - Get available animation presets
router.get('/presets', async (req, res) => {
    try {
        const presets = (0, spritesheet_service_1.getAnimationPresets)();
        res.json({
            success: true,
            presets
        });
    }
    catch (error) {
        console.error('Failed to fetch presets:', error);
        res.status(500).json({
            error: 'Failed to fetch animation presets',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});
// POST /api/spritesheet/generate - Generate spritesheet from asset
router.post('/generate', async (req, res) => {
    try {
        // Verify authentication
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing or invalid authorization header' });
        }
        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await (0, auth_1.verifyToken)(token);
        if (!decodedToken) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        // Get user and check credits
        const user = await user_service_1.UserService.findByFirebaseUid(decodedToken.uid);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        const { assetId, projectId, animationPresetId, customPrompt, customWidth, customHeight, apiKey } = req.body;
        if (!assetId) {
            return res.status(400).json({ error: 'Asset ID is required' });
        }
        if (!animationPresetId) {
            return res.status(400).json({ error: 'Animation preset ID is required' });
        }
        // Verify asset exists and belongs to user
        const asset = await asset_service_1.AssetService.findById(assetId, user.id);
        if (!asset) {
            return res.status(404).json({ error: 'Asset not found' });
        }
        // Verify preset exists
        const preset = (0, spritesheet_service_1.getAnimationPreset)(animationPresetId);
        if (!preset) {
            return res.status(400).json({ error: 'Invalid animation preset' });
        }
        // Calculate credits: 10 credits per spritesheet generation
        const creditsRequired = 10;
        if (user.credits < creditsRequired && !apiKey) {
            return res.status(402).json({
                error: 'Insufficient credits',
                required: creditsRequired,
                available: user.credits
            });
        }
        // Get API token
        const replicateToken = apiKey || process.env.REPLICATE_API_TOKEN;
        if (!replicateToken) {
            return res.status(500).json({ error: 'No API token configured' });
        }
        // Generate spritesheet
        const result = await (0, spritesheet_service_1.generateSpritesheet)({
            characterImageUrl: asset.blob_url,
            animationPresetId,
            customPrompt,
            customWidth,
            customHeight
        }, replicateToken);
        if (!result.success) {
            return res.status(500).json({ error: result.error || 'Spritesheet generation failed' });
        }
        // Deduct credits
        if (!apiKey) {
            await user_service_1.UserService.deductCredits(user.id, creditsRequired);
        }
        // Upload spritesheet to storage
        const uploadedUrl = await (0, spritesheet_service_1.uploadSpritesheet)(result.spritesheetUrl, user.id, projectId || asset.project_id, preset.name);
        // Save as new asset
        const spritesheetAsset = await asset_service_1.AssetService.create({
            project_id: projectId || asset.project_id,
            user_id: user.id,
            name: `${asset.name || 'sprite'}_${preset.name}`,
            asset_type: 'sprite',
            file_type: 'png',
            blob_url: uploadedUrl,
            blob_path: uploadedUrl,
            metadata: {
                source_asset_id: assetId,
                animation_preset: preset.id,
                animation_name: preset.name,
                frame_count: result.frameCount,
                frame_width: result.frameWidth,
                frame_height: result.frameHeight,
                layout: result.layout,
                ...(customPrompt && { custom_prompt: customPrompt }),
                is_spritesheet: true,
                generation_params: {
                    preset_id: animationPresetId,
                    width: result.frameWidth,
                    height: result.frameHeight
                }
            }
        });
        res.json({
            success: true,
            spritesheet: serializeAsset(spritesheetAsset),
            frameCount: result.frameCount,
            frameWidth: result.frameWidth,
            frameHeight: result.frameHeight,
            layout: result.layout,
            creditsUsed: apiKey ? 0 : creditsRequired,
            remainingCredits: apiKey ? user.credits : user.credits - creditsRequired
        });
    }
    catch (error) {
        console.error('Spritesheet generation error:', error);
        res.status(500).json({
            error: 'Failed to generate spritesheet',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});
// GET /api/spritesheet/project/:projectId - List all spritesheets for a project
router.get('/project/:projectId', async (req, res) => {
    try {
        // Verify authentication
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing or invalid authorization header' });
        }
        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await (0, auth_1.verifyToken)(token);
        if (!decodedToken) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        // Get user
        const user = await user_service_1.UserService.findByFirebaseUid(decodedToken.uid);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        const { projectId } = req.params;
        // Verify project belongs to user
        const project = await project_service_1.ProjectService.findById(projectId, user.id);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }
        // Fetch all assets for this project
        const assets = await asset_service_1.AssetService.list({
            project_id: projectId,
            user_id: user.id,
            order_by: 'created_at',
            order: 'desc'
        });
        // Filter for spritesheets (assets with is_spritesheet metadata)
        const spritesheets = assets.filter(asset => asset.metadata?.is_spritesheet === true);
        res.json({
            success: true,
            spritesheets: spritesheets.map(serializeAsset),
            count: spritesheets.length
        });
    }
    catch (error) {
        console.error('Failed to fetch spritesheets:', error);
        res.status(500).json({
            error: 'Failed to fetch spritesheets',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});
// DELETE /api/spritesheet/:id - Delete a spritesheet
router.delete('/:id', async (req, res) => {
    try {
        // Verify authentication
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing or invalid authorization header' });
        }
        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await (0, auth_1.verifyToken)(token);
        if (!decodedToken) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        // Get user
        const user = await user_service_1.UserService.findByFirebaseUid(decodedToken.uid);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        const { id } = req.params;
        // Verify asset exists and belongs to user
        const asset = await asset_service_1.AssetService.findById(id, user.id);
        if (!asset) {
            return res.status(404).json({ error: 'Spritesheet not found' });
        }
        // Delete the asset
        await asset_service_1.AssetService.delete(id, user.id);
        res.json({
            success: true,
            message: 'Spritesheet deleted successfully'
        });
    }
    catch (error) {
        console.error('Failed to delete spritesheet:', error);
        res.status(500).json({
            error: 'Failed to delete spritesheet',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});
exports.default = router;
