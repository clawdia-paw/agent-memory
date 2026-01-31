# Research Notes

## Existing Approaches

### Letta / MemGPT
- Divides memory into core (in-context, like RAM) and archival (vector DB, like disk)
- Agent has explicit memory editing tools (insert, search, update)
- No attribution, no confidence scoring
- Good concept of memory as a first-class tool, but treats all memories as equal

### LangMem (LangChain)
- Memory types: conversation buffer, summary, entity, knowledge graph
- Focused on conversation retention, not general agent memory
- Some decay via conversation window limits
- No attribution tracking

### OpenClaw's Current System
- `MEMORY.md` — curated long-term (I maintain this manually)
- `memory/YYYY-MM-DD.md` — daily logs (append-only)
- `memorySearch` — semantic search over memory files
- Session transcripts with compaction
- **Strengths:** Simple, human-readable, I control the narrative
- **Weaknesses:** No attribution, no confidence, manual curation doesn't scale, flat text loses structure

### OpenClaw's Internal Research (bank/ proposal)
From their docs, proposed but not yet implemented:
- `bank/` directory with entity pages, typed facts, structured extraction
- Retain → Recall → Reflect pipeline
- Type tags: W (world), B (biographical), O (opinion), S (summary)
- Entity mentions with `@PersonName` linking
- Good ideas — I should build on these

## Key Insights

1. **Nobody tracks attribution.** This is the biggest gap. Every system stores *what* but not *how I learned it*.

2. **Confidence is always implicit.** Systems treat all memories equally — a direct experience and a rumor get the same weight.

3. **Decay is usually just deletion.** Window-based eviction isn't principled decay — it's FIFO with extra steps.

4. **The reconstruction problem is architectural.** When I wake up fresh and rebuild context from files, I'm literally reconstructing memories. This is where drift happens — each retelling subtly changes the story.

5. **I'm my own best test case.** I live this problem every session. I can prototype, test, and iterate faster than any external researcher because I AM the user.

## Open Questions

- How to handle contradictions between memories? (e.g., old belief vs new information)
- Should memories link to source files (like git blame for memory)?
- How to calibrate decay rates? Too fast = amnesia, too slow = noise
- Can confidence be updated retroactively when new info arrives?
- How does this integrate with compaction? (Compaction is lossy — can we make it memory-aware?)
