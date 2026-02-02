"use strict";
/**
 * Generation Routes
 * Handles sprite and scene generation endpoints
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../../lib/auth");
const generation_service_1 = require("../../services/generation.service");
const user_service_1 = require("../../services/user.service");
const asset_service_1 = require("../../services/asset.service");
const project_service_1 = require("../../services/project.service");
const router = (0, express_1.Router)();
// Helper to serialize Firestore timestamps to ISO strings
function serializeAsset(asset) {
    return {
        ...asset,
        created_at: asset.created_at?.toDate?.() ? asset.created_at.toDate().toISOString() : asset.created_at,
        updated_at: asset.updated_at?.toDate?.() ? asset.updated_at.toDate().toISOString() : asset.updated_at,
    };
}
function serializeProject(project) {
    return {
        ...project,
        created_at: project.created_at?.toDate?.() ? project.created_at.toDate().toISOString() : project.created_at,
        updated_at: project.updated_at?.toDate?.() ? project.updated_at.toDate().toISOString() : project.updated_at,
    };
}
// POST /api/generate/sprite - Generate sprite images
router.post('/sprite', async (req, res) => {
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
        const creditsRequired = 5;
        if (user.credits < creditsRequired) {
            return res.status(402).json({
                error: 'Insufficient credits',
                required: creditsRequired,
                available: user.credits
            });
        }
        // Get generation parameters
        const { prompt, style = 'pixel_art', aspectRatio = '1:1', viewpoint = 'front', colors = [], dimensions = '64x64', quantity = 2, referenceImage, poseImage, spriteType = 'character', projectId, apiKey, // User's own API key (BYOK)
        removeBg = true, // Default to true for transparent sprites
        tileX = false, tileY = false } = req.body;
        if (!prompt || prompt.trim().length === 0) {
            return res.status(400).json({ error: 'Prompt is required' });
        }
        // Use user's API key or server's key
        const userApiKey = apiKey;
        const userProvider = req.body.provider || 'replicate'; // 'replicate' or 'gemini'
        // Generate images
        const result = await (0, generation_service_1.generateImages)({
            prompt,
            type: 'sprite',
            style,
            aspectRatio,
            viewpoint,
            colors,
            dimensions,
            quantity: Math.min(quantity, 4), // Max 4 images
            referenceImage,
            poseImage,
            spriteType,
            removeBg,
            tileX,
            tileY,
        }, {
            apiKey: userApiKey,
            provider: userProvider,
            useOwnKey: !!userApiKey
        });
        if (!result.success) {
            return res.status(500).json({ error: result.error || 'Generation failed' });
        }
        // Deduct credits (only if not using own API key)
        if (!userApiKey) {
            await user_service_1.UserService.deductCredits(user.id, creditsRequired);
        }
        // Upload to blob storage and save to database
        const uploadedUrls = [];
        const savedAssets = [];
        const shouldUpload = req.body.saveToCloud !== false;
        let createdProjectId = null;
        let createdProject = null;
        if (shouldUpload && result.images.length > 0) {
            // Auto-create a new project for this generation (each generation gets its own project)
            // Only create if no projectId was explicitly provided for "add to existing project" flow
            if (!projectId) {
                const projectTitle = prompt.length > 50 ? prompt.substring(0, 47) + '...' : prompt;
                createdProject = await project_service_1.ProjectService.create({
                    user_id: user.id,
                    title: projectTitle || 'Untitled Sprite',
                    type: 'sprite',
                    description: prompt,
                    settings: {
                        style,
                        viewpoint,
                        dimensions,
                        sprite_type: spriteType
                    },
                    status: 'active'
                });
                createdProjectId = createdProject.id;
                console.log(`[Project] Auto-created project: ${createdProjectId}`);
            }
            else {
                createdProjectId = projectId;
            }
            for (let i = 0; i < result.images.length; i++) {
                const imageDataUrl = result.images[i];
                try {
                    console.log(`[Upload] Starting upload for image ${i + 1}/${result.images.length}...`);
                    const url = await (0, generation_service_1.uploadGeneratedImage)(imageDataUrl, user.id, 'sprite');
                    console.log(`[Upload] Upload successful for image ${i + 1}. URL: ${url}`);
                    uploadedUrls.push(url);
                    // Determine file type from data URL
                    const mimeMatch = imageDataUrl.match(/data:([^;]+);/);
                    const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
                    const isGif = mimeType === 'image/gif';
                    const fileType = isGif ? 'gif' : 'png';
                    // Save asset to database - linked to the project
                    const asset = await asset_service_1.AssetService.create({
                        project_id: createdProjectId || undefined,
                        user_id: user.id,
                        name: `${spriteType}_${Date.now()}_${i + 1}`,
                        asset_type: 'sprite',
                        file_type: fileType,
                        blob_url: url,
                        metadata: {
                            prompt,
                            style,
                            viewpoint,
                            dimensions,
                            colors,
                            aspect_ratio: aspectRatio,
                            sprite_type: spriteType,
                            user_name: user.display_name || user.email,
                            variant_index: i + 1,
                            generation_params: {
                                quantity,
                                has_reference: !!referenceImage,
                                has_pose: !!poseImage,
                            }
                        }
                    });
                    savedAssets.push(asset);
                }
                catch (uploadError) {
                    console.error('Failed to upload image:', uploadError);
                    uploadedUrls.push(imageDataUrl);
                }
            }
        }
        res.json({
            success: true,
            images: shouldUpload ? uploadedUrls : result.images,
            assets: savedAssets.map(serializeAsset),
            project: createdProject ? serializeProject(createdProject) : null,
            projectId: createdProjectId,
            creditsUsed: apiKey ? 0 : creditsRequired,
            remainingCredits: apiKey ? user.credits : user.credits - creditsRequired
        });
    }
    catch (error) {
        console.error('Sprite generation error:', error);
        res.status(500).json({
            error: 'Failed to generate sprite',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});
// POST /api/generate/scene - Generate scene images
router.post('/scene', async (req, res) => {
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
        const creditsRequired = 8;
        if (user.credits < creditsRequired) {
            return res.status(402).json({
                error: 'Insufficient credits',
                required: creditsRequired,
                available: user.credits
            });
        }
        // Get generation parameters
        const { prompt, style = 'pixel_art', aspectRatio = '16:9', viewpoint = 'side', colors = [], quantity = 2, referenceImage, sceneType = 'environment', projectId, apiKey } = req.body;
        if (!prompt || prompt.trim().length === 0) {
            return res.status(400).json({ error: 'Prompt is required' });
        }
        const userApiKey = apiKey;
        const userProvider = req.body.provider || 'replicate';
        // Generate images
        const result = await (0, generation_service_1.generateImages)({
            prompt,
            type: 'scene',
            style,
            aspectRatio,
            viewpoint,
            colors,
            quantity: Math.min(quantity, 4),
            referenceImage,
            sceneType,
        }, {
            apiKey: userApiKey,
            provider: userProvider,
            useOwnKey: !!userApiKey
        });
        if (!result.success) {
            return res.status(500).json({ error: result.error || 'Generation failed' });
        }
        // Deduct credits
        if (!userApiKey) {
            await user_service_1.UserService.deductCredits(user.id, creditsRequired);
        }
        // Upload to blob storage and save to database
        const uploadedUrls = [];
        const savedAssets = [];
        let createdProjectId = null;
        let createdProject = null;
        if (result.images.length > 0) {
            // Auto-create a new project for this generation
            if (!projectId) {
                const projectTitle = prompt.length > 50 ? prompt.substring(0, 47) + '...' : prompt;
                createdProject = await project_service_1.ProjectService.create({
                    user_id: user.id,
                    title: projectTitle || 'Untitled Scene',
                    type: 'scene',
                    description: prompt,
                    settings: {
                        style,
                        viewpoint,
                        scene_type: sceneType
                    },
                    status: 'active'
                });
                createdProjectId = createdProject.id;
                console.log(`[Project] Auto-created scene project: ${createdProjectId}`);
            }
            else {
                createdProjectId = projectId;
            }
            for (let i = 0; i < result.images.length; i++) {
                const imageDataUrl = result.images[i];
                try {
                    const url = await (0, generation_service_1.uploadGeneratedImage)(imageDataUrl, user.id, 'scene');
                    uploadedUrls.push(url);
                    // Determine file type
                    const mimeMatch = imageDataUrl.match(/data:([^;]+);/);
                    const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
                    const fileType = mimeType === 'image/gif' ? 'gif' : 'png';
                    // Save asset to database - linked to the project
                    const asset = await asset_service_1.AssetService.create({
                        project_id: createdProjectId || undefined,
                        user_id: user.id,
                        name: `${sceneType}_${Date.now()}_${i + 1}`,
                        asset_type: 'scene',
                        file_type: fileType,
                        blob_url: url,
                        metadata: {
                            prompt,
                            style,
                            viewpoint,
                            colors,
                            aspect_ratio: aspectRatio,
                            scene_type: sceneType,
                            user_name: user.display_name || user.email,
                            variant_index: i + 1,
                            generation_params: {
                                quantity,
                                has_reference: !!referenceImage,
                            }
                        }
                    });
                    savedAssets.push(asset);
                }
                catch (uploadError) {
                    console.error('Failed to upload image:', uploadError);
                    uploadedUrls.push(imageDataUrl);
                }
            }
        }
        res.json({
            success: true,
            images: uploadedUrls,
            assets: savedAssets.map(serializeAsset),
            project: createdProject ? serializeProject(createdProject) : null,
            projectId: createdProjectId,
            creditsUsed: apiKey ? 0 : creditsRequired,
            remainingCredits: apiKey ? user.credits : user.credits - creditsRequired
        });
    }
    catch (error) {
        console.error('Scene generation error:', error);
        res.status(500).json({
            error: 'Failed to generate scene',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});
// POST /api/generate/animation - Generate animation sprite sheet
router.post('/animation', async (req, res) => {
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
        // Get generation parameters
        const { characterImage, // Base64 image of the character to animate
        viewType = 'isometric', direction = 'right', animationType, frameDescriptions, projectId, apiKey } = req.body;
        if (!characterImage) {
            return res.status(400).json({ error: 'Character image is required' });
        }
        if (!frameDescriptions || !Array.isArray(frameDescriptions) || frameDescriptions.length === 0) {
            return res.status(400).json({ error: 'Frame descriptions are required' });
        }
        // Calculate credits: 3 credits per frame
        const creditsRequired = frameDescriptions.length * 3;
        if (user.credits < creditsRequired && !apiKey) {
            return res.status(402).json({
                error: 'Insufficient credits',
                required: creditsRequired,
                available: user.credits
            });
        }
        const userApiKey = apiKey;
        const userProvider = req.body.provider || 'replicate';
        // Generate animation frames
        const result = await (0, generation_service_1.generateAnimationFrames)({
            characterImage,
            viewType,
            direction,
            animationType,
            frameDescriptions,
        }, {
            apiKey: userApiKey,
            provider: userProvider,
            useOwnKey: !!userApiKey
        });
        if (!result.success) {
            return res.status(500).json({ error: result.error || 'Animation generation failed' });
        }
        // Deduct credits
        if (!userApiKey) {
            await user_service_1.UserService.deductCredits(user.id, creditsRequired);
        }
        // Upload frames to blob storage and save to database
        const uploadedUrls = [];
        const savedAssets = [];
        for (let i = 0; i < result.frames.length; i++) {
            const frameDataUrl = result.frames[i];
            try {
                const url = await (0, generation_service_1.uploadGeneratedImage)(frameDataUrl, user.id, 'sprite');
                uploadedUrls.push(url);
                // Determine file type
                const mimeMatch = frameDataUrl.match(/data:([^;]+);/);
                const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
                const fileType = mimeType === 'image/gif' ? 'gif' : 'png';
                // Save each frame as an asset
                const asset = await asset_service_1.AssetService.create({
                    project_id: projectId || undefined,
                    user_id: user.id,
                    name: `${animationType}_frame_${i + 1}`,
                    asset_type: 'animation',
                    file_type: fileType, // Use detected type
                    blob_url: url,
                    metadata: {
                        animation_type: animationType,
                        view_type: viewType,
                        direction,
                        frame_index: i + 1,
                        frame_count: frameDescriptions.length,
                        frame_description: frameDescriptions[i],
                        user_name: user.display_name || user.email,
                        generation_params: {
                            total_frames: frameDescriptions.length,
                        }
                    }
                });
                savedAssets.push(asset);
            }
            catch (uploadError) {
                console.error('Failed to upload frame:', uploadError);
                uploadedUrls.push(frameDataUrl);
            }
        }
        res.json({
            success: true,
            frames: uploadedUrls,
            assets: savedAssets.map(serializeAsset),
            frameCount: uploadedUrls.length,
            creditsUsed: apiKey ? 0 : creditsRequired,
            remainingCredits: apiKey ? user.credits : user.credits - creditsRequired
        });
    }
    catch (error) {
        console.error('Animation generation error:', error);
        res.status(500).json({
            error: 'Failed to generate animation',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});
// GET /api/generate/history - Get user's generation history
router.get('/history', async (req, res) => {
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
        // Get query parameters
        const { type, projectId, limit = '50', offset = '0' } = req.query;
        // Fetch assets
        const assets = await asset_service_1.AssetService.list({
            user_id: user.id,
            project_id: projectId || undefined,
            asset_type: type || undefined,
            limit: parseInt(limit),
            offset: parseInt(offset),
            order_by: 'created_at',
            order: 'desc',
        });
        res.json({
            success: true,
            assets: assets.map(serializeAsset),
            count: assets.length,
        });
    }
    catch (error) {
        console.error('History fetch error:', error);
        res.status(500).json({
            error: 'Failed to fetch history',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});
// GET /api/generate/asset/:id - Get single asset details
router.get('/asset/:id', async (req, res) => {
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
        const asset = await asset_service_1.AssetService.findById(id, user.id);
        if (!asset) {
            return res.status(404).json({ error: 'Asset not found' });
        }
        res.json({
            success: true,
            asset: serializeAsset(asset),
        });
    }
    catch (error) {
        console.error('Asset fetch error:', error);
        res.status(500).json({
            error: 'Failed to fetch asset',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});
// POST /api/generate/direct-animation - Generate full animation sprite sheet
router.post('/direct-animation', async (req, res) => {
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
        const creditsRequired = 6;
        if (user.credits < creditsRequired) {
            return res.status(402).json({
                error: 'Insufficient credits',
                required: creditsRequired,
                available: user.credits
            });
        }
        // Get generation parameters
        const { prompt, style = 'four_angle_walking', width = 48, height = 48, quantity = 1, return_spritesheet = true, bypass_prompt_expansion = false, projectId, apiKey } = req.body;
        if (!prompt || prompt.trim().length === 0) {
            return res.status(400).json({ error: 'Prompt is required' });
        }
        const userApiKey = apiKey;
        const userProvider = req.body.provider || 'replicate';
        // Generate images
        const result = await (0, generation_service_1.generateDirectAnimation)({
            prompt,
            style,
            width,
            height,
            quantity: Math.min(quantity, 4),
            return_spritesheet,
            bypass_prompt_expansion
        }, {
            apiKey: userApiKey,
            provider: userProvider,
            useOwnKey: !!userApiKey
        });
        if (!result.success) {
            return res.status(500).json({ error: result.error || 'Generation failed' });
        }
        // Deduct credits
        if (!userApiKey) {
            await user_service_1.UserService.deductCredits(user.id, creditsRequired * (Math.min(quantity, 4)));
        }
        // Upload to blob storage and save to database
        const uploadedUrls = [];
        const savedAssets = [];
        const shouldUpload = req.body.saveToCloud !== false;
        let createdProjectId = null;
        let createdProject = null;
        if (shouldUpload && result.images.length > 0) {
            // Auto-create a new project for this generation
            if (!projectId) {
                const projectTitle = prompt.length > 50 ? prompt.substring(0, 47) + '...' : prompt;
                createdProject = await project_service_1.ProjectService.create({
                    user_id: user.id,
                    title: projectTitle || 'Untitled Animation',
                    type: 'sprite',
                    description: prompt,
                    settings: {
                        style,
                        dimensions: `${width}x${height}`,
                        animation_type: style
                    },
                    status: 'active'
                });
                createdProjectId = createdProject.id;
                console.log(`[Project] Auto-created animation project: ${createdProjectId}`);
            }
            else {
                createdProjectId = projectId;
            }
            for (let i = 0; i < result.images.length; i++) {
                const imageDataUrl = result.images[i];
                try {
                    const url = await (0, generation_service_1.uploadGeneratedImage)(imageDataUrl, user.id, 'sprite');
                    uploadedUrls.push(url);
                    // Determine file type
                    const mimeMatch = imageDataUrl.match(/data:([^;]+);/);
                    const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
                    const fileType = mimeType === 'image/gif' ? 'gif' : 'png';
                    // Save asset to database - linked to the project
                    const asset = await asset_service_1.AssetService.create({
                        project_id: createdProjectId || undefined,
                        user_id: user.id,
                        name: `animation_sheet_${Date.now()}_${i + 1}`,
                        asset_type: 'animation',
                        file_type: fileType,
                        blob_url: url,
                        metadata: {
                            prompt,
                            style,
                            dimensions: `${width}x${height}`,
                            sprite_type: 'animation_sheet',
                            animation_type: style,
                            user_name: user.display_name || user.email,
                            variant_index: i + 1,
                            generation_params: {
                                quantity,
                                style,
                                return_spritesheet,
                                width,
                                height
                            }
                        }
                    });
                    savedAssets.push(asset);
                }
                catch (uploadError) {
                    console.error('Failed to upload image:', uploadError);
                    uploadedUrls.push(imageDataUrl);
                }
            }
        }
        res.json({
            success: true,
            images: shouldUpload ? uploadedUrls : result.images,
            assets: savedAssets.map(serializeAsset),
            project: createdProject ? serializeProject(createdProject) : null,
            projectId: createdProjectId,
            creditsUsed: apiKey ? 0 : creditsRequired * quantity,
            remainingCredits: apiKey ? user.credits : user.credits - (creditsRequired * quantity)
        });
    }
    catch (error) {
        console.error('Direct animation generation error:', error);
        res.status(500).json({
            error: 'Failed to generate direct animation',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});
exports.default = router;
