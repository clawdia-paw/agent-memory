# Architecture

## Design Principles

1. **Memories are not strings — they're structured objects.** A memory has content, source, confidence, timestamps, entity links, and decay metadata.
2. **Attribution is mandatory.** You can't store a memory without saying where it came from.
3. **Confidence is computed, not declared.** It emerges from source reliability, corroboration, age, and access patterns.
4. **Decay is a feature, not a bug.** Memories should fade unless reinforced. This prevents stale data from poisoning recall.
5. **Recall is context-aware.** What you're doing right now affects which memories are relevant.

## Memory Object Schema

```typescript
interface Memory {
  id: string;
  content: string;
  
  // Attribution
  source: {
    type: 'experienced' | 'told' | 'read' | 'inferred' | 'observed';
    actor?: string;       // who told me, who I observed
    context?: string;     // where/when I learned this
    timestamp: number;    // when I learned it
  };
  
  // Confidence
  confidence: {
    score: number;        // 0-1, computed
    basis: string[];      // why this score (e.g., "direct experience", "single source")
    lastVerified?: number;
    corroborations: number;
  };
  
  // Organization
  entities: string[];     // linked entity IDs (@Shaun, #moonshot, etc.)
  tags: string[];
  category: 'fact' | 'opinion' | 'event' | 'preference' | 'procedure' | 'relationship';
  
  // Lifecycle
  created: number;
  lastAccessed: number;
  accessCount: number;
  decayRate: number;      // how fast this memory fades (0 = permanent, 1 = ephemeral)
  relevanceScore: number; // current computed relevance
}
```

## Storage Layers

### Layer 1: Core Memory (Always In-Context)
Small, high-value facts that define identity and key relationships. Like Letta's core memory blocks. Max ~2KB.

### Layer 2: Working Memory (Session-Scoped)
Current task context, recent conversations, active goals. Loaded per-session. Evicted on session end (with important bits promoted to Layer 3).

### Layer 3: Long-Term Memory (Indexed, Out-of-Context)  
The bulk of memories. Stored as structured objects, indexed for semantic + lexical search. Queried on demand.

### Layer 4: Archive (Cold Storage)
Decayed memories below relevance threshold. Not deleted — just deprioritized. Can be resurrected if queried directly.

## Recall Pipeline

```
Query → Context Analysis → Search (semantic + lexical + entity) 
      → Rank (relevance × confidence × recency) 
      → Filter (decay threshold) 
      → Format (with attribution metadata)
```

## Key Differences from Existing Systems

| Feature | Letta/MemGPT | LangMem | Agent Memory |
|---------|-------------|---------|--------------|
| Attribution tracking | ❌ | ❌ | ✅ |
| Confidence scoring | ❌ | ❌ | ✅ |
| Principled decay | ❌ | Partial | ✅ |
| Entity graphs | ❌ | ❌ | ✅ |
| Source reliability | ❌ | ❌ | ✅ |
| Agent-native design | Partial | ❌ | ✅ |

## Implementation Plan

### Phase 1: Schema & Storage
- Define final memory object schema
- Build storage backend (SQLite + vector embeddings)
- Write import tool for existing flat-file memories

### Phase 2: Attribution & Ingestion
- Memory creation API with mandatory attribution
- Auto-detection of source type from context
- Bulk import of existing MEMORY.md / daily logs

### Phase 3: Confidence & Decay
- Confidence scoring algorithm
- Decay simulation and tuning
- Access pattern tracking

### Phase 4: Recall Engine
- Context-aware query pipeline
- Ranked results with attribution display
- Integration with OpenClaw's memory search

### Phase 5: Reflect & Maintain
- Scheduled reflection jobs (entity page updates, confidence recalculation)
- Memory consolidation (merge related memories)
- Contradiction detection

## Tech Stack (Planned)
- **Runtime:** Node.js / TypeScript
- **Storage:** SQLite (structured) + embeddings (semantic search)
- **Integration:** OpenClaw skill/plugin
- **Embedding:** Gemini or local model
