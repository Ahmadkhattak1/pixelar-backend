/**
 * Database Type Definitions
 * These types match the PostgreSQL schema defined in database.sql
 */

import { UUID } from 'crypto';

// ============================================
// USER TYPES
// ============================================

export type PlanType = 'free' | 'pro' | 'enterprise';
export type AuthProvider = 'google' | 'email' | 'github';

export interface User {
  id: string; // UUID
  firebase_uid: string;
  email: string;
  email_verified: boolean;
  display_name: string | null;
  avatar_url: string | null;
  provider: AuthProvider;
  plan_type: PlanType;
  credits: number;
  credits_used: number;
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
}

export interface CreateUserInput {
  firebase_uid: string;
  email: string;
  email_verified?: boolean;
  display_name?: string;
  avatar_url?: string;
  provider?: AuthProvider;
  plan_type?: PlanType;
  credits?: number;
}

export interface UpdateUserInput {
  display_name?: string | null;
  avatar_url?: string | null;
  email_verified?: boolean;
  plan_type?: PlanType;
  credits?: number;
  credits_used?: number;
  last_login_at?: Date;
}

// ============================================
// PROJECT TYPES
// ============================================

export type ProjectType = 'sprite' | 'scene';
export type ProjectStatus = 'draft' | 'active' | 'archived' | 'deleted';

export interface ProjectSettings {
  style?: string;
  viewpoint?: 'front' | 'back' | 'side' | 'top_down' | 'isometric';
  dimensions?: string; // e.g., "64x64", "128x128"
  sprite_type?: 'character' | 'object'; // For sprite projects only
  resolution?: string; // For scene projects
  [key: string]: any; // Allow additional settings
}

export interface Project {
  id: string; // UUID
  user_id: string; // UUID
  title: string;
  type: ProjectType;
  description: string | null;
  color: string | null; // Hex color
  thumbnail_url: string | null;
  settings: ProjectSettings;
  status: ProjectStatus;
  created_at: Date;
  updated_at: Date;
}

export interface CreateProjectInput {
  user_id: string;
  title: string;
  type: ProjectType;
  description?: string;
  color?: string;
  thumbnail_url?: string;
  settings?: ProjectSettings;
  status?: ProjectStatus;
}

export interface UpdateProjectInput {
  title?: string;
  description?: string;
  color?: string;
  thumbnail_url?: string;
  settings?: ProjectSettings;
  status?: ProjectStatus;
}

// ============================================
// ASSET TYPES
// ============================================

export type AssetType = 'sprite' | 'scene' | 'reference_image' | 'pose_image' | 'variant' | 'export';
export type AssetStatus = 'active' | 'deleted' | 'processing';
export type FileType = 'png' | 'jpg' | 'jpeg' | 'webp' | 'gif' | 'json' | 'zip';

export interface AssetMetadata {
  prompt?: string;
  colors?: string[]; // Hex color array
  generation_params?: Record<string, any>;
  variant_index?: number; // For scene variants
  pose_data?: {
    joints: Array<{
      name: string;
      position: [number, number, number];
      rotation: [number, number, number];
    }>;
  };
  export_format?: 'unity' | 'godot' | 'unreal';
  [key: string]: any; // Allow additional metadata
}

export interface Asset {
  id: string; // UUID
  project_id: string; // UUID
  user_id: string; // UUID
  name: string | null;
  asset_type: AssetType;
  file_type: FileType;
  blob_url: string; // Full Vercel Blob URL
  blob_path: string; // Path in Vercel Blob
  blob_id: string | null; // Vercel Blob ID
  file_size: number | null; // Bytes
  width: number | null;
  height: number | null;
  mime_type: string | null;
  metadata: AssetMetadata;
  status: AssetStatus;
  created_at: Date;
  updated_at: Date;
}

export interface CreateAssetInput {
  project_id: string;
  user_id: string;
  name?: string;
  asset_type: AssetType;
  file_type: FileType;
  blob_url: string;
  blob_path: string;
  blob_id?: string;
  file_size?: number;
  width?: number;
  height?: number;
  mime_type?: string;
  metadata?: AssetMetadata;
  status?: AssetStatus;
}

export interface UpdateAssetInput {
  name?: string;
  blob_url?: string;
  metadata?: AssetMetadata;
  status?: AssetStatus;
}

// ============================================
// GENERATION JOB TYPES
// ============================================

export type JobType = 'sprite_generation' | 'scene_generation' | 'variant_generation';
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface GenerationInputParams {
  prompt: string;
  reference_image_url?: string;
  colors?: string[];
  style?: 'pixel_art' | '2d_flat';
  viewpoint?: 'front' | 'back' | 'side' | 'top_down' | 'isometric';
  dimensions?: string;
  pose_image_url?: string; // For character sprites
  sprite_type?: 'character' | 'object';
  resolution?: string; // For scenes
  [key: string]: any; // Allow additional params
}

export interface GenerationJob {
  id: string; // UUID
  user_id: string; // UUID
  project_id: string | null; // UUID
  job_type: JobType;
  status: JobStatus;
  input_params: GenerationInputParams;
  output_assets: string[]; // Array of asset IDs
  error_message: string | null;
  credits_cost: number;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

export interface CreateGenerationJobInput {
  user_id: string;
  project_id?: string;
  job_type: JobType;
  input_params: GenerationInputParams;
  credits_cost?: number;
  status?: JobStatus;
}

export interface UpdateGenerationJobInput {
  status?: JobStatus;
  output_assets?: string[];
  error_message?: string;
  started_at?: Date;
  completed_at?: Date;
}

// ============================================
// CREDITS TRANSACTION TYPES
// ============================================

export type TransactionType = 'purchase' | 'usage' | 'refund' | 'bonus' | 'expiration';

export interface CreditsTransaction {
  id: string; // UUID
  user_id: string; // UUID
  transaction_type: TransactionType;
  amount: number; // Positive for additions, negative for deductions
  generation_job_id: string | null; // UUID
  description: string | null;
  balance_after: number;
  created_at: Date;
}

export interface CreateCreditsTransactionInput {
  user_id: string;
  transaction_type: TransactionType;
  amount: number;
  generation_job_id?: string;
  description?: string;
  balance_after: number;
}

// ============================================
// VIEW TYPES
// ============================================

export interface UserProjectSummary {
  user_id: string;
  email: string;
  display_name: string | null;
  plan_type: PlanType;
  credits: number;
  total_projects: number;
  sprite_projects: number;
  scene_projects: number;
  total_assets: number;
  total_credits_used: number;
}

// ============================================
// QUERY TYPES
// ============================================

export interface ProjectQueryFilters {
  user_id?: string;
  type?: ProjectType;
  status?: ProjectStatus;
  search?: string; // Search in title/description
  limit?: number;
  offset?: number;
  order_by?: 'created_at' | 'updated_at' | 'title';
  order?: 'asc' | 'desc';
}

export interface AssetQueryFilters {
  project_id?: string;
  user_id?: string;
  asset_type?: AssetType;
  status?: AssetStatus;
  limit?: number;
  offset?: number;
  order_by?: 'created_at' | 'updated_at';
  order?: 'asc' | 'desc';
}

export interface GenerationJobQueryFilters {
  user_id?: string;
  project_id?: string;
  job_type?: JobType;
  status?: JobStatus;
  limit?: number;
  offset?: number;
  order_by?: 'created_at' | 'completed_at';
  order?: 'asc' | 'desc';
}

// ============================================
// RESPONSE TYPES
// ============================================

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

export interface ApiError {
  error: string;
  message: string;
  code?: string;
  details?: Record<string, any>;
}

// ============================================
// UTILITY TYPES
// ============================================

export type DatabaseRecord<T> = T & {
  created_at: Date;
  updated_at: Date;
};

export type PartialRecord<T> = Partial<T> & {
  id: string;
};
