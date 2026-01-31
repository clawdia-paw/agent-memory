/**
 * Agent Memory — Core Type Definitions
 * 
 * Every memory is a structured object with attribution, confidence,
 * and lifecycle metadata. No anonymous memories allowed.
 */

// === Source Attribution ===

export type SourceType = 
  | 'experienced'   // I did this / was there
  | 'told'          // Someone told me directly
  | 'read'          // I read it (article, doc, file)
  | 'inferred'      // I concluded this from other information
  | 'observed';     // I watched/noticed this happening

export interface Attribution {
  type: SourceType;
  actor?: string;        // Who told me / who I observed (entity ID or name)
  context?: string;      // Where/how I learned this (conversation, article URL, file path)
  timestamp: number;     // When I learned it (epoch ms)
  sessionId?: string;    // Which session this was learned in
}

// === Confidence ===

export interface Confidence {
  score: number;         // 0.0 - 1.0, computed
  basis: string[];       // Human-readable reasons for this score
  lastVerified?: number; // Last time this was confirmed/corroborated
  corroborations: number; // How many independent sources support this
  contradictions: number; // How many sources contradict this
}

// === Memory Categories ===

export type MemoryCategory = 
  | 'fact'          // Objective truth (API endpoints, dates, configs)
  | 'event'         // Something that happened
  | 'opinion'       // Subjective belief or preference
  | 'preference'    // User/agent preference
  | 'procedure'     // How to do something
  | 'relationship'  // Connection between entities
  | 'observation';  // Something noticed, not yet categorized

// === The Memory Object ===

export interface Memory {
  id: string;
  content: string;       // The actual memory content (natural language)
  summary?: string;      // Short version for listing/scanning
  
  // Attribution (mandatory)
  attribution: Attribution;
  
  // Confidence (computed)
  confidence: Confidence;
  
  // Organization
  entities: string[];    // Linked entity IDs (e.g., "shaun", "moonshot", "mantis")
  tags: string[];        // Freeform tags
  category: MemoryCategory;
  
  // Lifecycle
  created: number;       // When this memory object was created (epoch ms)
  updated: number;       // Last modified
  lastAccessed: number;  // Last time this was recalled
  accessCount: number;   // How many times recalled
  
  // Decay
  decayRate: number;     // 0.0 = permanent, 1.0 = ephemeral. Default ~0.3
  relevanceScore: number; // Current computed relevance (decays over time)
  pinned: boolean;       // If true, exempt from decay
  
  // Embedding (for semantic search)
  embedding?: number[];  // Vector embedding of content
}

// === Entity (First-Class Object) ===

export interface Entity {
  id: string;            // Lowercase slug (e.g., "shaun", "moonshot")
  name: string;          // Display name
  type: 'person' | 'project' | 'place' | 'concept' | 'organization' | 'agent';
  description?: string;
  aliases: string[];     // Alternative names
  metadata: Record<string, string>; // Flexible key-value pairs
  created: number;
  updated: number;
  memoryCount: number;   // How many memories reference this entity
}

// === Query & Recall ===

export interface RecallQuery {
  text: string;          // Natural language query
  context?: string;      // What I'm currently doing (helps rank relevance)
  entities?: string[];   // Filter to specific entities
  categories?: MemoryCategory[];
  tags?: string[];
  minConfidence?: number; // Minimum confidence threshold (default 0.3)
  minRelevance?: number;  // Minimum relevance after decay (default 0.1)
  limit?: number;         // Max results (default 10)
  includeDecayed?: boolean; // Search cold storage too
}

export interface RecallResult {
  memory: Memory;
  matchScore: number;    // How well this matched the query
  finalScore: number;    // matchScore × confidence × relevance (what we rank by)
}

// === Memory Creation (Input) ===

export interface CreateMemoryInput {
  content: string;
  summary?: string;
  attribution: {
    type: SourceType;
    actor?: string;
    context?: string;
  };
  entities?: string[];
  tags?: string[];
  category: MemoryCategory;
  decayRate?: number;    // Default: computed from category
  pinned?: boolean;      // Default: false
}

// === Confidence Calculation Defaults ===

export const SOURCE_BASE_CONFIDENCE: Record<SourceType, number> = {
  experienced: 0.9,   // I was there — high confidence
  observed: 0.8,      // I saw it happen — slightly less (observation bias)
  told: 0.6,          // Someone told me — depends on who
  read: 0.5,          // I read it — depends on source quality
  inferred: 0.4,      // I concluded this — most fragile
};

export const CATEGORY_DEFAULT_DECAY: Record<MemoryCategory, number> = {
  fact: 0.1,           // Facts decay slowly
  procedure: 0.15,     // Procedures are fairly stable
  relationship: 0.2,   // Relationships evolve
  preference: 0.25,    // Preferences change
  event: 0.3,          // Events fade naturally
  opinion: 0.35,       // Opinions are the most volatile
  observation: 0.4,    // Observations are ephemeral unless promoted
};
