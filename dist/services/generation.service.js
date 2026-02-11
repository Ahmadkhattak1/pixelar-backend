"use strict";
/**
 * Generation Service
 * Handles AI image generation using Replicate API (primary) or Gemini API (fallback)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateImages = generateImages;
exports.uploadGeneratedImage = uploadGeneratedImage;
exports.generateAnimationFrames = generateAnimationFrames;
exports.generateDirectAnimation = generateDirectAnimation;
// Map aspect ratio to actual dimensions
function getImageDimensions(aspectRatio) {
    const ratioMap = {
        '2:3': { width: 688, height: 1024 },
        '1:1': { width: 1024, height: 1024 },
        '9:16': { width: 576, height: 1024 },
        '4:3': { width: 1024, height: 768 },
        '3:2': { width: 1024, height: 688 },
        '16:9': { width: 1024, height: 576 },
    };
    return ratioMap[aspectRatio] || { width: 1024, height: 1024 };
}
// Check if user wants a partial/half character based on prompt
function wantsPartialCharacter(prompt) {
    const promptLower = prompt.toLowerCase();
    return promptLower.includes('half body') ||
        promptLower.includes('half-body') ||
        promptLower.includes('upper body') ||
        promptLower.includes('above chest') ||
        promptLower.includes('portrait') ||
        promptLower.includes('bust') ||
        promptLower.includes('headshot') ||
        promptLower.includes('face only') ||
        promptLower.includes('torso');
}
// Build the generation prompt based on parameters
function buildPrompt(params) {
    const { prompt, type, style, viewpoint, colors, dimensions, aspectRatio, spriteType, sceneType } = params;
    let fullPrompt = '';
    // Style prefix
    if (style === 'pixel_art') {
        fullPrompt += 'Create a pixel art style image. Use clear pixel boundaries, limited color palette, and retro game aesthetic. ';
    }
    else {
        fullPrompt += 'Create a 2D flat style image with clean lines, solid colors, and modern vector-like appearance. ';
    }
    // Type context
    if (type === 'sprite') {
        const entityType = spriteType === 'object' ? 'object/item' : 'character';
        fullPrompt += `This is a game sprite ${entityType} that should be suitable for use in a 2D video game. `;
        fullPrompt += 'The sprite should have a transparent or solid color background that can be easily removed. ';
        // Full-body character requirement (unless user explicitly wants partial)
        if (spriteType !== 'object' && !wantsPartialCharacter(prompt)) {
            fullPrompt += 'IMPORTANT: Generate a FULL-BODY character showing the entire figure from head to feet. The character must be fully visible and standing, NOT cropped at the chest, waist, or knees. ';
        }
    }
    else {
        const envType = sceneType === 'indoor' ? 'indoor' : 'outdoor';
        fullPrompt += `This is an ${envType} game scene or background environment for a 2D video game. `;
    }
    // Viewpoint
    const viewpointDescriptions = {
        'front': 'Show from a front-facing view. ',
        'back': 'Show from behind/back view. ',
        'side': 'Show from a side profile view. ',
        'top_down': 'Show from a top-down/bird\'s eye view. ',
        'isometric': 'Show in isometric perspective (45-degree angle). ',
    };
    fullPrompt += viewpointDescriptions[viewpoint] || '';
    // Aspect ratio context
    const { width, height } = getImageDimensions(aspectRatio);
    fullPrompt += `The image should be ${width}x${height} pixels (${aspectRatio} aspect ratio). `;
    // Colors
    if (colors && colors.length > 0) {
        fullPrompt += `Use these colors prominently in the design: ${colors.join(', ')}. `;
    }
    // Dimensions hint for sprite size
    if (dimensions && type === 'sprite') {
        fullPrompt += `The sprite should be designed to look good at ${dimensions} pixel dimensions. `;
    }
    // User prompt
    fullPrompt += prompt;
    // Quality suffix
    fullPrompt += ' High quality, detailed, game-ready asset.';
    return fullPrompt;
}
// Helper to handle Replicate API calls and polling
async function callReplicate(apiToken, model, input) {
    // Use model-specific endpoint for owner/name model IDs, or generic endpoint with explicit version.
    let url = 'https://api.replicate.com/v1/predictions';
    let body = { input };
    if (model.includes('/')) {
        // Assume Owner/Name format, use specific endpoint which auto-resolves latest version
        url = `https://api.replicate.com/v1/models/${model}/predictions`;
    }
    else if (model.includes(':')) {
        // Assume has version hash
        body.version = model.split(':')[1];
    }
    else {
        // Fallback or error? Let's assume it's a version hash if no slash
        body.version = model;
    }
    const startForRealResponse = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Token ${apiToken}`,
            'Content-Type': 'application/json',
            'Prefer': 'wait', // Ask Replicate to wait a bit (optional but good for fast models)
        },
        body: JSON.stringify(body)
    });
    if (!startForRealResponse.ok) {
        const error = await startForRealResponse.json().catch(() => ({}));
        throw new Error(`Replicate API error: ${startForRealResponse.status} - ${JSON.stringify(error)}`);
    }
    console.log("Replicate prediction started:", model);
    let prediction = await startForRealResponse.json();
    // poll
    while (prediction.status !== 'succeeded' && prediction.status !== 'failed') {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const pollResponse = await fetch(prediction.urls?.get || `https://api.replicate.com/v1/predictions/${prediction.id}`, {
            headers: { 'Authorization': `Token ${apiToken}` }
        });
        prediction = await pollResponse.json();
    }
    if (prediction.status === 'failed') {
        throw new Error(prediction.error || 'Replicate generation failed');
    }
    return prediction.output;
}
// Pose-based Generation: Qwen Image Edit Plus
async function generateWithQwen(prompt, poseImage, apiToken) {
    console.log("Calling Qwen Image Edit Plus for Pose Generation...");
    // Qwen expects an input image. If it's pose-guided, we pass the pose as 'image'.
    // Note: Qwen is an EDIT model, so it transforms the input based on prompt. 
    // Ideally we'd use a ControlNet for structural guidance, but user specified Qwen Edit.
    // "Formulate a prompt for QwenEdit that it generate pixelated sprites... not realistic images"
    const input = {
        prompt,
        image: poseImage, // The pose/reference
        aspect_ratio: "match_input_image", // Or map context.aspectRatio
        output_format: "webp",
        output_quality: 95,
        go_fast: true,
        disable_safety_checker: true
    };
    const output = await callReplicate(apiToken, 'qwen/qwen-image-edit-plus', input);
    // Output is usually an array of URIs
    return Array.isArray(output) ? output : [output];
}
async function generateWithReplicate(params, apiToken, modelId) {
    try {
        const finalPrompt = params.prompt;
        // 2. Generation
        const images = [];
        if (params.poseImage) {
            // POSE DETECTED -> Use Qwen
            const qwenOutputs = await generateWithQwen(finalPrompt, params.poseImage, apiToken);
            // fetch images
            for (const url of qwenOutputs) {
                const imageResponse = await fetch(url);
                const buffer = await imageResponse.arrayBuffer();
                const base64 = Buffer.from(buffer).toString('base64');
                const mime = imageResponse.headers.get('content-type') || 'image/webp';
                images.push(`data:${mime};base64,${base64}`);
            }
        }
        else {
            // STANDARD GENERATION -> Retro Diffusion (rd-plus)
            const model = 'retro-diffusion/rd-plus';
            console.log(`Using Standard Model: ${model}`);
            // Parse dimensions
            let width = 128;
            let height = 128;
            if (params.dimensions) {
                const [w, h] = params.dimensions.split('x').map(Number);
                if (!isNaN(w) && !isNaN(h)) {
                    width = w;
                    height = h;
                }
            }
            else if (params.aspectRatio) {
                const dims = getImageDimensions(params.aspectRatio);
                let maxDim = Math.max(dims.width, dims.height);
                if (maxDim > 384)
                    maxDim = 384;
                const scale = 384 / Math.max(dims.width, dims.height);
                width = Math.round(dims.width * scale);
                height = Math.round(dims.height * scale);
            }
            const input = {
                prompt: finalPrompt,
                width,
                height,
                num_images: params.quantity, // Model supports up to 10
                style: params.style || 'default',
                remove_bg: params.removeBg || false,
                tile_x: params.tileX || false,
                tile_y: params.tileY || false,
                ...(params.referenceImage && { input_image: params.referenceImage })
            };
            const output = await callReplicate(apiToken, model, input);
            const outputArray = Array.isArray(output) ? output : [output];
            for (const url of outputArray) {
                const imageResponse = await fetch(url);
                const buffer = await imageResponse.arrayBuffer();
                const base64 = Buffer.from(buffer).toString('base64');
                const mime = imageResponse.headers.get('content-type') || 'image/png';
                images.push(`data:${mime};base64,${base64}`);
            }
        }
        if (images.length === 0) {
            throw new Error('No images generated');
        }
        return { success: true, images, provider: 'replicate' };
    }
    catch (error) {
        console.error('Replicate generation error:', error);
        return { success: false, images: [], error: error.message, provider: 'replicate' };
    }
}
// ============================================
// GEMINI API GENERATION (Fallback/Legacy)
// ============================================
async function generateWithGemini(params, apiKey) {
    try {
        const fullPrompt = buildPrompt(params);
        const images = [];
        const buildParts = (variationText) => {
            const parts = [{ text: fullPrompt + variationText }];
            if (params.referenceImage && params.referenceImage.startsWith('data:')) {
                const base64Match = params.referenceImage.match(/data:([^;]+);base64,(.+)/);
                if (base64Match) {
                    parts.push({
                        inlineData: { mimeType: base64Match[1], data: base64Match[2] }
                    });
                }
            }
            if (params.poseImage && params.poseImage.startsWith('data:')) {
                const base64Match = params.poseImage.match(/data:([^;]+);base64,(.+)/);
                if (base64Match) {
                    parts.push({
                        inlineData: { mimeType: base64Match[1], data: base64Match[2] }
                    });
                }
            }
            return parts;
        };
        for (let i = 0; i < params.quantity; i++) {
            const variationText = i > 0 ? ` Variation ${i + 1}, slightly different from previous versions.` : '';
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: buildParts(variationText) }],
                    generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
                })
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(`Gemini API error: ${response.status} - ${JSON.stringify(errorData)}`);
            }
            const data = await response.json();
            if (data.candidates && data.candidates[0]?.content?.parts) {
                for (const part of data.candidates[0].content.parts) {
                    if (part.inlineData?.mimeType?.startsWith('image/')) {
                        images.push(`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`);
                        break;
                    }
                }
            }
        }
        if (images.length === 0) {
            throw new Error('No images generated');
        }
        return { success: true, images, provider: 'gemini' };
    }
    catch (error) {
        console.error('Gemini generation error:', error);
        return { success: false, images: [], error: error.message, provider: 'gemini' };
    }
}
// ============================================
// MAIN GENERATION FUNCTION
// ============================================
async function generateImages(params, options = {}) {
    const { apiKey, provider, useOwnKey } = options;
    // Determine which provider and key to use
    if (useOwnKey && apiKey) {
        // User is using their own key
        if (provider === 'gemini') {
            console.log('Using user\'s Gemini API key');
            return generateWithGemini(params, apiKey);
        }
        else {
            // Default to Replicate for BYOK
            console.log('Using user\'s Replicate API key');
            return generateWithReplicate(params, apiKey);
        }
    }
    // Use platform's default: Replicate with your model
    const platformReplicateToken = process.env.REPLICATE_API_TOKEN;
    if (platformReplicateToken) {
        console.log('Using platform Replicate model');
        return generateWithReplicate(params, platformReplicateToken, process.env.REPLICATE_MODEL_ID);
    }
    // Fallback to Gemini if Replicate not configured
    const platformGeminiKey = process.env.GEMINI_API_KEY;
    if (platformGeminiKey && platformGeminiKey !== 'your_gemini_api_key_here') {
        console.log('Falling back to platform Gemini API');
        return generateWithGemini(params, platformGeminiKey);
    }
    return {
        success: false,
        images: [],
        error: 'No API key configured. Please add your own API key in settings or contact support.'
    };
}
// Upload generated image to blob storage
// Upload generated image to Firebase Storage
async function uploadGeneratedImage(dataUrl, userId, type) {
    // 1. Parse base64
    const base64Data = dataUrl.split(',')[1];
    const mimeMatch = dataUrl.match(/data:([^;]+);/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
    const extension = mimeType.split('/')[1] || 'png';
    // 2. Generate filename
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    const filename = `${type}s/${userId}/${timestamp}-${random}.${extension}`;
    // 3. Upload to Firebase Storage
    // Dynamic import to avoid circular dependency issues if any
    const { getStorageBucket } = require('../lib/db');
    const bucket = getStorageBucket();
    const file = bucket.file(filename);
    const buffer = Buffer.from(base64Data, 'base64');
    await file.save(buffer, {
        metadata: {
            contentType: mimeType,
        }
    });
    // 4. Get signed URL (long expiry)
    // Should be valid for a long time if we want it to act like public
    const [url] = await file.getSignedUrl({
        action: 'read',
        expires: '03-01-2030', // Long expiry
    });
    return url;
}
function buildAnimationFramePrompt(params, frameIndex, totalFrames) {
    const { viewType, direction, animationType, frameDescriptions } = params;
    let fullPrompt = '';
    fullPrompt += 'You are given a reference image of a game character sprite. ';
    fullPrompt += 'Generate a new frame showing this EXACT same character in a different pose for animation. ';
    fullPrompt += 'CRITICAL: The character must look IDENTICAL - same art style, same colors, same outfit, same proportions. ';
    fullPrompt += 'Only the pose/position changes. ';
    fullPrompt += `\n\nThis is frame ${frameIndex + 1} of ${totalFrames} for a "${animationType}" animation sequence. `;
    const viewDescriptions = {
        'side': 'Maintain the side-scrolling 2D view. ',
        'isometric': 'Maintain the isometric 45-degree angle view. ',
        'top_down': 'Maintain the top-down bird\'s eye view. ',
    };
    fullPrompt += viewDescriptions[viewType] || viewDescriptions['isometric'];
    const directionDescriptions = {
        'right': 'Character should be facing right. ',
        'left': 'Character should be facing left. ',
        'up': 'Character should be facing up/away. ',
        'down': 'Character should be facing down/toward viewer. ',
        'up_right': 'Character should be facing diagonally up-right. ',
        'up_left': 'Character should be facing diagonally up-left. ',
        'down_right': 'Character should be facing diagonally down-right. ',
        'down_left': 'Character should be facing diagonally down-left. ',
    };
    fullPrompt += directionDescriptions[direction] || directionDescriptions['right'];
    if (frameDescriptions[frameIndex]) {
        fullPrompt += `\n\nPOSE FOR THIS FRAME: ${frameDescriptions[frameIndex]}. `;
    }
    fullPrompt += '\n\nIMPORTANT: Keep EXACT same character design, colors, art style. Single character, centered, transparent background. ';
    return fullPrompt;
}
async function generateAnimationWithReplicate(params, apiToken, modelId) {
    try {
        const frames = [];
        const totalFrames = params.frameDescriptions.length;
        const model = modelId || process.env.REPLICATE_MODEL_ID;
        for (let i = 0; i < totalFrames; i++) {
            const framePrompt = buildAnimationFramePrompt(params, i, totalFrames);
            console.log(`Generating frame ${i + 1}/${totalFrames} with Replicate...`);
            const createResponse = await fetch('https://api.replicate.com/v1/predictions', {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${apiToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    version: model?.includes(':') ? model.split(':')[1] : model,
                    input: {
                        prompt: framePrompt,
                        image: params.characterImage,
                        width: 512,
                        height: 512,
                    }
                })
            });
            if (!createResponse.ok) {
                throw new Error(`Replicate API error: ${createResponse.status}`);
            }
            let result = await createResponse.json();
            while (result.status !== 'succeeded' && result.status !== 'failed') {
                await new Promise(resolve => setTimeout(resolve, 1000));
                const pollResponse = await fetch(`https://api.replicate.com/v1/predictions/${result.id}`, {
                    headers: { 'Authorization': `Token ${apiToken}` }
                });
                result = await pollResponse.json();
            }
            if (result.status === 'failed') {
                throw new Error(`Frame ${i + 1} generation failed`);
            }
            if (result.output) {
                const outputArray = Array.isArray(result.output) ? result.output : [result.output];
                if (outputArray.length > 0) {
                    const imageUrl = outputArray[0];
                    const imageResponse = await fetch(imageUrl);
                    const imageBuffer = await imageResponse.arrayBuffer();
                    const base64 = Buffer.from(imageBuffer).toString('base64');
                    frames.push(`data:image/png;base64,${base64}`);
                }
            }
        }
        return { success: true, frames, provider: 'replicate' };
    }
    catch (error) {
        console.error('Replicate animation error:', error);
        return { success: false, frames: [], error: error.message, provider: 'replicate' };
    }
}
async function generateAnimationWithGemini(params, apiKey) {
    try {
        const frames = [];
        const totalFrames = params.frameDescriptions.length;
        let characterImageData = null;
        if (params.characterImage && params.characterImage.startsWith('data:')) {
            const base64Match = params.characterImage.match(/data:([^;]+);base64,(.+)/);
            if (base64Match) {
                characterImageData = { mimeType: base64Match[1], data: base64Match[2] };
            }
        }
        if (!characterImageData) {
            throw new Error('Invalid character image format');
        }
        for (let i = 0; i < totalFrames; i++) {
            const framePrompt = buildAnimationFramePrompt(params, i, totalFrames);
            console.log(`Generating frame ${i + 1}/${totalFrames} with Gemini...`);
            const parts = [
                { text: framePrompt },
                { inlineData: { mimeType: characterImageData.mimeType, data: characterImageData.data } }
            ];
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts }],
                    generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
                })
            });
            if (!response.ok) {
                throw new Error(`Failed to generate frame ${i + 1}: ${response.status}`);
            }
            const data = await response.json();
            let frameImage = null;
            if (data.candidates && data.candidates[0]?.content?.parts) {
                for (const part of data.candidates[0].content.parts) {
                    if (part.inlineData?.mimeType?.startsWith('image/')) {
                        frameImage = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                        break;
                    }
                }
            }
            if (!frameImage) {
                throw new Error(`No image generated for frame ${i + 1}`);
            }
            frames.push(frameImage);
        }
        return { success: true, frames, provider: 'gemini' };
    }
    catch (error) {
        console.error('Gemini animation error:', error);
        return { success: false, frames: [], error: error.message, provider: 'gemini' };
    }
}
async function generateAnimationFrames(params, options = {}) {
    const { apiKey, provider, useOwnKey } = options;
    console.log(`Generating ${params.frameDescriptions.length} animation frames...`);
    console.log(`View: ${params.viewType}, Direction: ${params.direction}, Type: ${params.animationType}`);
    if (useOwnKey && apiKey) {
        if (provider === 'gemini') {
            return generateAnimationWithGemini(params, apiKey);
        }
        else {
            return generateAnimationWithReplicate(params, apiKey);
        }
    }
    // Platform default: Replicate
    const platformReplicateToken = process.env.REPLICATE_API_TOKEN;
    if (platformReplicateToken) {
        return generateAnimationWithReplicate(params, platformReplicateToken, process.env.REPLICATE_MODEL_ID);
    }
    // Fallback to Gemini
    const platformGeminiKey = process.env.GEMINI_API_KEY;
    if (platformGeminiKey && platformGeminiKey !== 'your_gemini_api_key_here') {
        return generateAnimationWithGemini(params, platformGeminiKey);
    }
    return {
        success: false,
        frames: [],
        error: 'No API key configured. Please add your own API key in settings.'
    };
}
async function generateDirectAnimation(params, options = {}) {
    const { apiKey, useOwnKey } = options;
    const model = 'retro-diffusion/rd-animation';
    let token = apiKey;
    if (!useOwnKey || !token) {
        token = process.env.REPLICATE_API_TOKEN;
    }
    if (!token) {
        return {
            success: false,
            images: [],
            error: 'No API key configured.'
        };
    }
    try {
        const finalPrompt = params.prompt;
        const images = [];
        const quantity = params.quantity || 1;
        // Loop for quantity since model might not support batching
        for (let i = 0; i < quantity; i++) {
            console.log(`Generating animation sheet ${i + 1}/${quantity} with ${model}...`);
            const payload = {
                prompt: finalPrompt,
                style: params.style || 'four_angle_walking',
                width: params.width || 48,
                height: params.height || 48,
                return_spritesheet: params.return_spritesheet ?? true,
                bypass_prompt_expansion: params.bypass_prompt_expansion ?? false,
                ...(params.seed && { seed: params.seed }),
                ...(params.input_image && { input_image: params.input_image }),
            };
            const output = await callReplicate(token, model, payload);
            // Output should be a URI or list of URIs
            const outputArray = Array.isArray(output) ? output : [output];
            for (const url of outputArray) {
                // Fetch and convert to base64
                const imageResponse = await fetch(url);
                const buffer = await imageResponse.arrayBuffer();
                const base64 = Buffer.from(buffer).toString('base64');
                const mime = imageResponse.headers.get('content-type') || 'image/png';
                images.push(`data:${mime};base64,${base64}`);
            }
        }
        return { success: true, images, provider: 'replicate' };
    }
    catch (error) {
        console.error('Direct animation generation error:', error);
        return { success: false, images: [], error: error.message, provider: 'replicate' };
    }
}
