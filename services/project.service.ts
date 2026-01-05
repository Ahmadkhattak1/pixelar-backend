/**
 * Project Service - Firestore
 */

import { getCollection } from '../lib/db';
import type { 
  Project, 
  CreateProjectInput, 
  UpdateProjectInput,
  ProjectQueryFilters 
} from '../types/database.types';
import { Timestamp } from 'firebase-admin/firestore';

export class ProjectService {
  /**
   * Find project by ID
   */
  static async findById(id: string, userId?: string): Promise<Project | null> {
    const doc = await getCollection('projects').doc(id).get();
    if (!doc.exists) return null;
    
    const data = doc.data() as any;
    if (userId && data.user_id !== userId) return null;
    
    return { id: doc.id, ...data } as Project;
  }

  /**
   * List projects with filters
   */
  static async list(filters: ProjectQueryFilters): Promise<Project[]> {
    let query = getCollection('projects') as any;

    if (filters.user_id) {
      query = query.where('user_id', '==', filters.user_id);
    }

    if (filters.type) {
      query = query.where('type', '==', filters.type);
    }

    if (filters.status) {
      query = query.where('status', '==', filters.status);
    } else {
      query = query.where('status', '!=', 'deleted');
    }

    const orderBy = filters.order_by || 'created_at';
    const order = filters.order || 'desc';
    query = query.orderBy(orderBy, order);

    const limit = filters.limit || 50;
    query = query.limit(limit);

    if (filters.offset) {
      const offsetSnapshot = await query.limit(filters.offset).get();
      if (!offsetSnapshot.empty) {
        const lastDoc = offsetSnapshot.docs[offsetSnapshot.docs.length - 1];
        query = query.startAfter(lastDoc);
      }
    }

    const snapshot = await query.get();
    let projects = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as Project));

    // Client-side search (Firestore doesn't support ILIKE)
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      projects = projects.filter((p: Project) => 
        p.title?.toLowerCase().includes(searchLower) ||
        p.description?.toLowerCase().includes(searchLower)
      );
    }

    return projects;
  }

  /**
   * Count projects with filters
   */
  static async count(filters: ProjectQueryFilters): Promise<number> {
    const projects = await this.list({ ...filters, limit: 1000 });
    return projects.length;
  }

  /**
   * Create a new project
   */
  static async create(input: CreateProjectInput): Promise<Project> {
    const now = Timestamp.now();
    const projectData = {
      user_id: input.user_id,
      title: input.title,
      type: input.type,
      description: input.description || null,
      color: input.color || null,
      thumbnail_url: input.thumbnail_url || null,
      settings: input.settings || {},
      status: input.status || 'draft',
      created_at: now,
      updated_at: now,
    };

    const docRef = await getCollection('projects').add(projectData);
    const doc = await docRef.get();
    return { id: doc.id, ...doc.data() } as Project;
  }

  /**
   * Update project
   */
  static async update(id: string, userId: string, input: UpdateProjectInput): Promise<Project> {
    const project = await this.findById(id, userId);
    if (!project) throw new Error('Project not found');

    const updates: any = { updated_at: Timestamp.now() };

    if (input.title !== undefined) updates.title = input.title;
    if (input.description !== undefined) updates.description = input.description;
    if (input.color !== undefined) updates.color = input.color;
    if (input.thumbnail_url !== undefined) updates.thumbnail_url = input.thumbnail_url;
    if (input.settings !== undefined) updates.settings = input.settings;
    if (input.status !== undefined) updates.status = input.status;

    await getCollection('projects').doc(id).update(updates);
    return this.findById(id, userId) as Promise<Project>;
  }

  /**
   * Delete project (soft delete)
   */
  static async delete(id: string, userId: string): Promise<void> {
    await this.update(id, userId, { status: 'deleted' });
  }

  /**
   * Hard delete project - removes project AND all its assets from Firestore and Firebase Storage
   */
  static async hardDelete(id: string, userId: string): Promise<{ assetsDeleted: number }> {
    const project = await this.findById(id, userId);
    if (!project) throw new Error('Project not found');

    // First, hard delete all assets in this project
    const AssetService = require('./asset.service').AssetService;
    const assetsDeleted = await AssetService.hardDeleteByProject(id, userId);
    console.log(`[Project] Deleted ${assetsDeleted} assets from project ${id}`);

    // Then delete the project document from Firestore
    await getCollection('projects').doc(id).delete();
    console.log(`[Firestore] Project hard deleted: ${id}`);

    return { assetsDeleted };
  }

  /**
   * Get project with assets count
   */
  static async findByIdWithStats(id: string, userId: string): Promise<any> {
    const project = await this.findById(id, userId);
    if (!project) return null;

    const assetsSnapshot = await getCollection('assets')
      .where('project_id', '==', id)
      .where('status', '==', 'active')
      .get();

    return {
      ...project,
      assets_count: assetsSnapshot.size,
    };
  }
}

