/**
 * Agent Memory — SQLite Storage Layer
 * 
 * Persistent storage for memories and entities using better-sqlite3.
 * Handles schema creation, CRUD, and basic querying.
 * Semantic search via embeddings is separate (recall.ts).
 */

import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import {
  Memory,
  Entity,
  CreateMemoryInput,
  Confidence,
  SOURCE_BASE_CONFIDENCE,
  CATEGORY_DEFAULT_DECAY,
} from './types.js';

export class MemoryStore {
  private db: Database.Database;

  constructor(dbPath: string = 'memory.db') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  // === Schema ===

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        summary TEXT,
        
        -- Attribution (stored as JSON)
        attribution TEXT NOT NULL,
        
        -- Confidence (stored as JSON)  
        confidence TEXT NOT NULL,
        
        -- Organization
        category TEXT NOT NULL,
        tags TEXT DEFAULT '[]',
        
        -- Lifecycle
        created INTEGER NOT NULL,
        updated INTEGER NOT NULL,
        last_accessed INTEGER NOT NULL,
        access_count INTEGER DEFAULT 0,
        
        -- Decay
        decay_rate REAL DEFAULT 0.3,
        relevance_score REAL DEFAULT 1.0,
        pinned INTEGER DEFAULT 0,
        
        -- Embedding (stored as blob for efficiency)
        embedding BLOB
      );

      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT,
        aliases TEXT DEFAULT '[]',
        metadata TEXT DEFAULT '{}',
        created INTEGER NOT NULL,
        updated INTEGER NOT NULL,
        memory_count INTEGER DEFAULT 0
      );

      -- Junction table for memory <-> entity relationships
      CREATE TABLE IF NOT EXISTS memory_entities (
        memory_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        PRIMARY KEY (memory_id, entity_id),
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
        FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
      );

      -- Indexes for common queries
      CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
      CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created);
      CREATE INDEX IF NOT EXISTS idx_memories_relevance ON memories(relevance_score);
      CREATE INDEX IF NOT EXISTS idx_memories_confidence ON memories(confidence);
      CREATE INDEX IF NOT EXISTS idx_memory_entities_entity ON memory_entities(entity_id);
      CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
    `);
  }

  // === Memory CRUD ===

  createMemory(input: CreateMemoryInput): Memory {
    const now = Date.now();
    const id = uuid();
    
    const attribution = {
      ...input.attribution,
      timestamp: now,
    };

    const confidence = this.computeInitialConfidence(input);
    const decayRate = input.decayRate ?? CATEGORY_DEFAULT_DECAY[input.category];

    const memory: Memory = {
      id,
      content: input.content,
      summary: input.summary,
      attribution,
      confidence,
      entities: input.entities ?? [],
      tags: input.tags ?? [],
      category: input.category,
      created: now,
      updated: now,
      lastAccessed: now,
      accessCount: 0,
      decayRate,
      relevanceScore: 1.0,
      pinned: input.pinned ?? false,
    };

    const stmt = this.db.prepare(`
      INSERT INTO memories (id, content, summary, attribution, confidence, category, tags,
        created, updated, last_accessed, access_count, decay_rate, relevance_score, pinned)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      memory.id,
      memory.content,
      memory.summary ?? null,
      JSON.stringify(memory.attribution),
      JSON.stringify(memory.confidence),
      memory.category,
      JSON.stringify(memory.tags),
      memory.created,
      memory.updated,
      memory.lastAccessed,
      memory.accessCount,
      memory.decayRate,
      memory.relevanceScore,
      memory.pinned ? 1 : 0,
    );

    // Link entities
    if (input.entities?.length) {
      this.linkEntities(memory.id, input.entities);
    }

    return memory;
  }

  getMemory(id: string): Memory | null {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as any;
    if (!row) return null;
    
    // Update access tracking
    this.db.prepare(
      'UPDATE memories SET last_accessed = ?, access_count = access_count + 1 WHERE id = ?'
    ).run(Date.now(), id);
    
    return this.rowToMemory(row);
  }

  updateMemory(id: string, updates: Partial<Pick<Memory, 'content' | 'summary' | 'tags' | 'category' | 'pinned' | 'decayRate'>>): Memory | null {
    const existing = this.getMemory(id);
    if (!existing) return null;

    const now = Date.now();
    const fields: string[] = ['updated = ?'];
    const values: any[] = [now];

    if (updates.content !== undefined) {
      fields.push('content = ?');
      values.push(updates.content);
    }
    if (updates.summary !== undefined) {
      fields.push('summary = ?');
      values.push(updates.summary);
    }
    if (updates.tags !== undefined) {
      fields.push('tags = ?');
      values.push(JSON.stringify(updates.tags));
    }
    if (updates.category !== undefined) {
      fields.push('category = ?');
      values.push(updates.category);
    }
    if (updates.pinned !== undefined) {
      fields.push('pinned = ?');
      values.push(updates.pinned ? 1 : 0);
    }
    if (updates.decayRate !== undefined) {
      fields.push('decay_rate = ?');
      values.push(updates.decayRate);
    }

    values.push(id);
    this.db.prepare(`UPDATE memories SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    
    return this.getMemory(id);
  }

  deleteMemory(id: string): boolean {
    const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // === Entity CRUD ===

  createEntity(input: { id: string; name: string; type: Entity['type']; description?: string; aliases?: string[] }): Entity {
    const now = Date.now();
    const entity: Entity = {
      id: input.id,
      name: input.name,
      type: input.type,
      description: input.description,
      aliases: input.aliases ?? [],
      metadata: {},
      created: now,
      updated: now,
      memoryCount: 0,
    };

    this.db.prepare(`
      INSERT OR IGNORE INTO entities (id, name, type, description, aliases, metadata, created, updated, memory_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entity.id, entity.name, entity.type, entity.description ?? null,
      JSON.stringify(entity.aliases), JSON.stringify(entity.metadata),
      entity.created, entity.updated, 0
    );

    return entity;
  }

  getEntity(id: string): Entity | null {
    const row = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToEntity(row);
  }

  getEntityMemories(entityId: string, limit: number = 20): Memory[] {
    const rows = this.db.prepare(`
      SELECT m.* FROM memories m
      JOIN memory_entities me ON m.id = me.memory_id
      WHERE me.entity_id = ?
      ORDER BY m.relevance_score DESC, m.created DESC
      LIMIT ?
    `).all(entityId, limit) as any[];
    
    return rows.map(r => this.rowToMemory(r));
  }

  // === Querying ===

  searchByText(text: string, limit: number = 10): Memory[] {
    // Basic text search — semantic search will be layered on top
    const rows = this.db.prepare(`
      SELECT * FROM memories 
      WHERE content LIKE ? OR summary LIKE ?
      ORDER BY relevance_score DESC, created DESC
      LIMIT ?
    `).all(`%${text}%`, `%${text}%`, limit) as any[];
    
    return rows.map(r => this.rowToMemory(r));
  }

  searchByCategory(category: string, limit: number = 20): Memory[] {
    const rows = this.db.prepare(`
      SELECT * FROM memories WHERE category = ?
      ORDER BY relevance_score DESC, created DESC
      LIMIT ?
    `).all(category, limit) as any[];
    
    return rows.map(r => this.rowToMemory(r));
  }

  getAllMemories(limit: number = 100): Memory[] {
    const rows = this.db.prepare(`
      SELECT * FROM memories
      ORDER BY created DESC
      LIMIT ?
    `).all(limit) as any[];
    
    return rows.map(r => this.rowToMemory(r));
  }

  getAllEntities(): Entity[] {
    const rows = this.db.prepare('SELECT * FROM entities ORDER BY memory_count DESC').all() as any[];
    return rows.map(r => this.rowToEntity(r));
  }

  // === Decay ===

  applyDecay(): { updated: number; archived: number } {
    const now = Date.now();
    const ONE_DAY = 86400000;
    
    // Get all non-pinned memories
    const memories = this.db.prepare(
      'SELECT id, relevance_score, decay_rate, last_accessed, pinned FROM memories WHERE pinned = 0'
    ).all() as any[];

    let updated = 0;
    let archived = 0;
    const updateStmt = this.db.prepare(
      'UPDATE memories SET relevance_score = ? WHERE id = ?'
    );

    const transaction = this.db.transaction(() => {
      for (const mem of memories) {
        const daysSinceAccess = (now - mem.last_accessed) / ONE_DAY;
        // Exponential decay: relevance = e^(-decayRate * days)
        const newRelevance = Math.exp(-mem.decay_rate * daysSinceAccess * 0.01);
        const clamped = Math.max(0, Math.min(1, newRelevance));
        
        if (clamped !== mem.relevance_score) {
          updateStmt.run(clamped, mem.id);
          updated++;
          if (clamped < 0.05) archived++;
        }
      }
    });

    transaction();
    return { updated, archived };
  }

  // === Stats ===

  getStats(): { memories: number; entities: number; avgConfidence: number; avgRelevance: number } {
    const memCount = (this.db.prepare('SELECT COUNT(*) as c FROM memories').get() as any).c;
    const entCount = (this.db.prepare('SELECT COUNT(*) as c FROM entities').get() as any).c;
    const avgConf = (this.db.prepare(
      "SELECT AVG(json_extract(confidence, '$.score')) as avg FROM memories"
    ).get() as any)?.avg ?? 0;
    const avgRel = (this.db.prepare(
      'SELECT AVG(relevance_score) as avg FROM memories'
    ).get() as any)?.avg ?? 0;

    return {
      memories: memCount,
      entities: entCount,
      avgConfidence: Math.round(avgConf * 100) / 100,
      avgRelevance: Math.round(avgRel * 100) / 100,
    };
  }

  // === Internal Helpers ===

  private computeInitialConfidence(input: CreateMemoryInput): Confidence {
    const baseScore = SOURCE_BASE_CONFIDENCE[input.attribution.type];
    const basis: string[] = [`${input.attribution.type} source (base: ${baseScore})`];

    // Boost if actor is known/trusted
    let score = baseScore;
    if (input.attribution.actor) {
      basis.push(`from: ${input.attribution.actor}`);
    }
    if (input.attribution.context) {
      score += 0.05; // Having context is a small boost
      basis.push('has source context');
    }

    return {
      score: Math.min(1, Math.round(score * 100) / 100),
      basis,
      corroborations: 0,
      contradictions: 0,
    };
  }

  private linkEntities(memoryId: string, entityIds: string[]): void {
    const stmt = this.db.prepare(
      'INSERT OR IGNORE INTO memory_entities (memory_id, entity_id) VALUES (?, ?)'
    );
    const updateCount = this.db.prepare(
      'UPDATE entities SET memory_count = memory_count + 1 WHERE id = ?'
    );
    
    for (const entityId of entityIds) {
      // Auto-create entity if it doesn't exist
      this.db.prepare(`
        INSERT OR IGNORE INTO entities (id, name, type, aliases, metadata, created, updated, memory_count)
        VALUES (?, ?, 'concept', '[]', '{}', ?, ?, 0)
      `).run(entityId, entityId, Date.now(), Date.now());
      
      stmt.run(memoryId, entityId);
      updateCount.run(entityId);
    }
  }

  private rowToMemory(row: any): Memory {
    const entityRows = this.db.prepare(
      'SELECT entity_id FROM memory_entities WHERE memory_id = ?'
    ).all(row.id) as any[];

    return {
      id: row.id,
      content: row.content,
      summary: row.summary,
      attribution: JSON.parse(row.attribution),
      confidence: JSON.parse(row.confidence),
      entities: entityRows.map(e => e.entity_id),
      tags: JSON.parse(row.tags),
      category: row.category,
      created: row.created,
      updated: row.updated,
      lastAccessed: row.last_accessed,
      accessCount: row.access_count,
      decayRate: row.decay_rate,
      relevanceScore: row.relevance_score,
      pinned: row.pinned === 1,
    };
  }

  private rowToEntity(row: any): Entity {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      description: row.description,
      aliases: JSON.parse(row.aliases),
      metadata: JSON.parse(row.metadata),
      created: row.created,
      updated: row.updated,
      memoryCount: row.memory_count,
    };
  }

  close(): void {
    this.db.close();
  }
}
