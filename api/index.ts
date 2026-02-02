/**
 * Backend API Server
 * Can be deployed to Firebase Cloud Run or Firebase Functions
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import generationRoutes from './routes/generation.routes';
import projectRoutes from './routes/project.routes';
import assetRoutes from './routes/asset.routes';
import spritesheetRoutes from './routes/spritesheet.routes';

const app: Express = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/generate', generationRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/spritesheet', spritesheetRoutes);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err: any, req: Request, res: Response, next: any) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server (only if not in serverless environment)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Backend API server running on port ${PORT}`);
  });
}

export default app;


