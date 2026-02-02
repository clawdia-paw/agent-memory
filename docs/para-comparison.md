# PARA Article vs Agent-Memory: Comparison

*2026-02-02 — Review of Shaun's shared article on PARA-based agent memory*

## What We Already Have That Aligns

| Concept | Article | Our Implementation |
|---------|---------|-------------------|
| **Attribution/provenance** | `source` field on facts | Full attribution system with type, actor, context, timestamp — *we go deeper* |
| **Access tracking** | `lastAccessed` + `accessCount` on facts | Same fields on every memory, plus `access()` method |
| **Decay model** | Recency tiers (hot/warm/cold) on summaries | Exponential decay on `relevance_score` — continuous, not tiered |
| **Semantic + text search** | QMD with BM25 + vector | Hybrid recall engine with text + embedding candidates, scored and ranked |
| **Categories** | `relationship`, `milestone`, `status`, `preference`, `context` | `fact`, `event`, `opinion`, `preference`, `identity`, `skill`, `gotcha` |
| **Daily notes** | Dated markdown files as episodic memory | We use the workspace's `memory/YYYY-MM-DD.md` (external, not in this system) |
| **Narrative layer** | Tacit knowledge file for patterns/preferences | `NarrativeLayer` — end-of-session prose with mood, projects, open questions — *we go deeper* |
| **Entity graph** | `relatedEntities` cross-references | `entities` table with descriptions + `memory_entities` junction table |
| **Token-budgeted startup** | Tiered retrieval (summary first, details on demand) | 800-token startup context with priority ordering |

## What the Article Proposes That We're Missing

### 1. No-Deletion / `supersededBy` Chain
The article's strongest rule: **facts are never deleted, only superseded.** Old facts get `status: "superseded"` with a pointer to the replacement. This creates a traceable history chain.

**We have:** Hard updates. `updateMemory()` overwrites content in place. Old versions vanish. No history.

**Impact:** High. Without this, we can't answer "what did I used to think about X?" or trace how understanding evolved.

### 2. Tiered Retrieval (summary.md + items.json)
Each entity gets a lean summary (loaded by default) and a detailed fact store (loaded on demand). Summaries are rewritten weekly from active facts.

**We have:** Flat recall — every memory is equally available. Startup context has priority ordering, but there's no per-entity summary that decays and refreshes.

**Impact:** Medium. Our token-budgeted startup serves a similar purpose, but per-entity summaries would scale better.

### 3. Access-Count-Driven Decay Tiers (Hot/Warm/Cold)
Three simple tiers based on recency, with frequency resistance. High-access facts resist decay.

**We have:** Continuous exponential decay with `decay_rate` per category. Access count exists but doesn't influence decay.

**Impact:** Medium. Our decay works mathematically but `accessCount` is unused in scoring. The article's "frequency resistance" idea is good — frequently-accessed memories should resist decay.

### 4. Weekly Synthesis / Summary Rewrite
Periodic rewrite of entity summaries from active facts, applying decay tiers.

**We have:** Nothing automated. Decay runs but doesn't produce synthesized outputs.

**Impact:** Medium-low for now (our DB is small), but important at scale.

### 5. PARA Directory Structure
Projects/Areas/Resources/Archives as organizing principle with lifecycle flow.

**We have:** Flat category tags. No lifecycle concept (active → archived).

**Impact:** Low for our use case. Categories serve us fine at current scale.

### 6. Automated Extraction via Heartbeats
Background process that scans conversations, extracts durable facts, writes to knowledge graph.

**We have:** Manual `mem add` (which lessons-learned says produces better results anyway).

**Impact:** Low. Our own lessons say manual > automated for quality.

## Highest-Impact Improvement: Frequency Resistance in Decay

From our own lessons-learned:
> "Confidence should update from access patterns. If I keep recalling a memory, it matters."

From the article:
> "Facts with high accessCount resist decay. A fact you reference every week for six months stays warm even if you skip a few weeks."

**We already track `accessCount` and `lastAccessed` but don't use them in scoring.** The recall engine scores by `confidence × relevance_score`, but `relevance_score` decays purely on time, ignoring how often a memory is actually used.

**The fix:** Make `accessCount` contribute to decay resistance. Frequently-accessed memories decay slower. This is:
- Small, focused change (one function in store.ts)
- Aligned with both our lessons-learned AND the article
- Immediately testable
- Doesn't require architectural changes

### Implementation Plan
1. Modify `runDecay()` to apply frequency resistance: high-access memories get a decay dampening factor
2. Add the hot/warm/cold tier concept as a computed property (not stored — derived from `lastAccessed` + `accessCount`)
3. Test that frequently-accessed memories resist decay compared to rarely-accessed ones
