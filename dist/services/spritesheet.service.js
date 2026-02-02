"use strict";
/**
 * Spritesheet Generation Service
 * Handles spritesheet generation using retro-diffusion/rd-animation model
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ANIMATION_PRESETS = void 0;
exports.generateSpritesheet = generateSpritesheet;
exports.uploadSpritesheet = uploadSpritesheet;
exports.getAnimationPresets = getAnimationPresets;
exports.getAnimationPreset = getAnimationPreset;
exports.ANIMATION_PRESETS = [
    {
        id: 'four_angle_walking',
        name: '4-Direction Walking',
        description: 'Consistent 4-direction, 4-frame walking animation for humanoid characters',
        style: 'four_angle_walking',
        width: 48,
        height: 48,
        frameCount: 16, // 4 directions × 4 frames
        recommended: true
    },
    {
        id: 'walking_and_idle',
        name: 'Walking & Idle',
        description: 'Consistent 4-direction walking and idle animations',
        style: 'walking_and_idle',
        width: 48,
        height: 48,
        frameCount: 24, // More frames for walk + idle
        recommended: true
    },
    {
        id: 'small_sprites',
        name: 'Small Sprite Actions',
        description: '4-direction 32x32 sprites with various actions (walking, arm movement, looking, surprised, laying down)',
        style: 'small_sprites',
        width: 32,
        height: 32,
        frameCount: 16,
        recommended: false
    },
    {
        id: 'vfx',
        name: 'Visual Effects',
        description: 'Visual effects animations (24x24 to 96x96)',
        style: 'vfx',
        width: 64,
        height: 64,
        frameCount: 8,
        recommended: false
    }
];
// Helper to call Replicate API
async function callReplicateAnimation(apiToken, input) {
    const url = 'https://api.replicate.com/v1/models/retro-diffusion/rd-animation/predictions';
    const startResponse = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Token ${apiToken}`,
            'Content-Type': 'application/json',
            'Prefer': 'wait',
        },
        body: JSON.stringify({ input })
    });
    if (!startResponse.ok) {
        const error = await startResponse.json().catch(() => ({}));
        throw new Error(`Replicate API error: ${startResponse.status} - ${JSON.stringify(error)}`);
    }
    console.log("Replicate rd-animation prediction started");
    let prediction = await startResponse.json();
    // Poll for completion
    while (prediction.status !== 'succeeded' && prediction.status !== 'failed') {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const pollResponse = await fetch(prediction.urls?.get || `https://api.replicate.com/v1/predictions/${prediction.id}`, {
            headers: { 'Authorization': `Token ${apiToken}` }
        });
        prediction = await pollResponse.json();
    }
    if (prediction.status === 'failed') {
        throw new Error(prediction.error || 'Animation generation failed');
    }
    return prediction.output;
}
/**
 * Generate a spritesheet using retro-diffusion/rd-animation
 */
async function generateSpritesheet(params, apiToken) {
    try {
        // Find the preset
        const preset = exports.ANIMATION_PRESETS.find(p => p.id === params.animationPresetId);
        if (!preset) {
            throw new Error(`Invalid animation preset: ${params.animationPresetId}`);
        }
        // Prepare input for rd-animation model
        const width = params.customWidth || preset.width;
        const height = params.customHeight || preset.height;
        // Build prompt
        let prompt = params.customPrompt || '';
        if (!prompt) {
            // Generate a default prompt based on preset
            prompt = `pixel art character sprite, ${preset.name.toLowerCase()}`;
        }
        const input = {
            prompt: prompt,
            style: preset.style,
            width: width,
            height: height,
            input_image: params.characterImageUrl, // Reference character
            return_spritesheet: true, // Request spritesheet PNG instead of GIF
            seed: Math.floor(Math.random() * 1000000)
        };
        console.log('Generating spritesheet with input:', { ...input, input_image: '[IMAGE_DATA]' });
        // Call Replicate
        const output = await callReplicateAnimation(apiToken, input);
        // Output should be a URL to the spritesheet PNG
        let spritesheetUrl = '';
        if (Array.isArray(output)) {
            spritesheetUrl = output[0];
        }
        else if (typeof output === 'string') {
            spritesheetUrl = output;
        }
        else {
            throw new Error('Unexpected output format from rd-animation');
        }
        // Determine layout based on preset
        const layout = preset.frameCount > 8 ? 'grid' : 'horizontal';
        return {
            success: true,
            spritesheetUrl,
            frameCount: preset.frameCount,
            frameWidth: width,
            frameHeight: height,
            layout
        };
    }
    catch (error) {
        console.error('Spritesheet generation error:', error);
        return {
            success: false,
            frameCount: 0,
            frameWidth: 0,
            frameHeight: 0,
            layout: 'horizontal',
            error: error.message
        };
    }
}
/**
 * Upload spritesheet to storage
 */
async function uploadSpritesheet(spritesheetUrl, userId, projectId, animationName) {
    // Fetch the spritesheet from Replicate
    const response = await fetch(spritesheetUrl);
    const buffer = await response.arrayBuffer();
    // Generate filename
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    const filename = `animations/${userId}/${projectId}/${timestamp}-${random}-${animationName}.png`;
    // Upload to Firebase Storage
    const { getStorageBucket } = require('../lib/db');
    const bucket = getStorageBucket();
    const file = bucket.file(filename);
    await file.save(Buffer.from(buffer), {
        metadata: {
            contentType: 'image/png',
        }
    });
    // Get signed URL
    const [url] = await file.getSignedUrl({
        action: 'read',
        expires: '03-01-2030',
    });
    return url;
}
/**
 * Get available animation presets
 */
function getAnimationPresets() {
    return exports.ANIMATION_PRESETS;
}
/**
 * Get a specific animation preset by ID
 */
function getAnimationPreset(id) {
    return exports.ANIMATION_PRESETS.find(p => p.id === id);
}
