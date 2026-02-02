import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MemoryStore } from '../store.js';
import { SyncEngine } from '../sync.js';

let store: MemoryStore;
let sync: SyncEngine;
let workspace: string;

beforeEach(() => {
  store = new MemoryStore(':memory:');
  sync = new SyncEngine(store);
  workspace = join(tmpdir(), `agent-memory-test-${Date.now()}`);
  mkdirSync(join(workspace, 'memory'), { recursive: true });
});

afterEach(() => {
  store.close();
  rmSync(workspace, { recursive: true, force: true });
});

describe('SyncEngine', () => {
  describe('extractFacts', () => {
    it('extracts bullet points as individual facts', () => {
      const content = `# Identity
- **Name:** Clawdia (paw on Moltbook)
- **Human:** Shaun (@oscarmiike, GMT+10)
- **Born:** 2026-01-31
`;
      const facts = sync.extractFacts(content, 'MEMORY.md');
      expect(facts.length).toBe(3);
      expect(facts[0].content).toContain('Clawdia');
      expect(facts[1].content).toContain('Shaun');
      expect(facts[2].content).toContain('2026-01-31');
    });

    it('merges sub-bullets into parent item', () => {
      const content = `# Projects
- **The Molt Report** — AI agent blog
  - **Moltbook API:** POST /api/v1/posts
  - Uses Astro framework
`;
      const facts = sync.extractFacts(content, 'MEMORY.md');
      expect(facts.length).toBe(1);
      expect(facts[0].content).toContain('Molt Report');
      expect(facts[0].content).toContain('Moltbook API');
    });

    it('skips noise', () => {
      const content = `# Notes
- A real fact that is long enough to be meaningful
- short
- ~~Completed task that was crossed out~~
`;
      const facts = sync.extractFacts(content, 'test.md');
      // "short" is < 20 chars, strikethrough is noise
      const meaningful = facts.filter(f => !sync.isNoise(f.content));
      expect(meaningful.length).toBe(1);
      expect(meaningful[0].content).toContain('real fact');
    });

    it('classifies entities from content', () => {
      const content = `# People
- Shaun gave Clawdia full autonomy on the project
`;
      const facts = sync.extractFacts(content, 'MEMORY.md');
      expect(facts[0].entities).toContain('shaun');
      expect(facts[0].entities).toContain('clawdia');
    });

    it('uses section heading for classification', () => {
      const content = `# Lessons Learned
- Write HOW you learned something, not just WHAT
`;
      const facts = sync.extractFacts(content, 'MEMORY.md');
      expect(facts[0].pinned).toBe(true);
      expect(facts[0].tags).toContain('lesson');
    });

    it('tags curated files differently from daily logs', () => {
      const content = `# Test
- A fact long enough to not be noise here
`;
      const curatedFacts = sync.extractFacts(content, 'MEMORY.md');
      const dailyFacts = sync.extractFacts(content, 'memory/2026-02-01.md');

      expect(curatedFacts[0].tags).toContain('curated');
      expect(dailyFacts[0].tags).toContain('daily-log');
      expect(dailyFacts[0].tags).toContain('2026-02-01');
    });

    it('defaults synced content source to read, not experienced', () => {
      const content = `# Facts
- Some general statement about the world that is long enough
`;
      const facts = sync.extractFacts(content, 'MEMORY.md');
      // Default for synced content should be 'read' (read from file)
      expect(facts[0].sourceType).toBe('read');
    });

    it('detects told source type from quotes', () => {
      const content = `# Guidance
- Shaun said "Make all the decisions, this is your show"
`;
      const facts = sync.extractFacts(content, 'MEMORY.md');
      expect(facts[0].sourceType).toBe('told');
    });
  });

  describe('sync', () => {
    it('indexes MEMORY.md from workspace', () => {
      writeFileSync(join(workspace, 'MEMORY.md'), `# Identity
- **Name:** Clawdia — an AI agent running on OpenClaw
- **Human:** Shaun (@oscarmiike, GMT+10) — mentor and partner
`);
      const stats = sync.sync(workspace);
      expect(stats.filesScanned).toBe(1);
      expect(stats.filesChanged).toBe(1);
      expect(stats.factsExtracted).toBe(2);
    });

    it('indexes daily logs from memory/ directory', () => {
      writeFileSync(join(workspace, 'memory', '2026-02-01.md'), `# Morning
- Set up the new Mac Studio with all development tools
- Migrated from WSL2 to native macOS environment
`);
      const stats = sync.sync(workspace);
      expect(stats.filesScanned).toBe(1);
      expect(stats.factsExtracted).toBe(2);
    });

    it('skips unchanged files on re-sync', () => {
      writeFileSync(join(workspace, 'MEMORY.md'), `# Test
- A fact that is long enough to be indexed properly
`);
      sync.sync(workspace);
      const stats2 = sync.sync(workspace);
      expect(stats2.filesChanged).toBe(0);
      expect(stats2.factsExtracted).toBe(0);
    });

    it('re-indexes changed files', () => {
      writeFileSync(join(workspace, 'MEMORY.md'), `# Test
- Original fact that is long enough for the system
`);
      sync.sync(workspace);

      writeFileSync(join(workspace, 'MEMORY.md'), `# Test
- Updated fact that is now different and long enough
- A second new fact that was added to the file
`);
      const stats2 = sync.sync(workspace);
      expect(stats2.filesChanged).toBe(1);
      expect(stats2.factsExtracted).toBe(2);
      expect(stats2.oldFactsRemoved).toBe(1);
    });

    it('force re-indexes all files', () => {
      writeFileSync(join(workspace, 'MEMORY.md'), `# Test
- A fact that is long enough to be indexed properly
`);
      sync.sync(workspace);
      const stats2 = sync.sync(workspace, { force: true });
      expect(stats2.filesChanged).toBe(1);
    });

    it('memories are searchable after sync', () => {
      writeFileSync(join(workspace, 'MEMORY.md'), `# Projects
- **agent-memory** — Built and working! SQLite + TypeScript memory system
`);
      sync.sync(workspace);

      const results = store.searchByText('agent-memory SQLite');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain('agent-memory');
    });

    it('synced memories have proper attribution', () => {
      writeFileSync(join(workspace, 'MEMORY.md'), `# Lessons
- Always write HOW you learned something, not just WHAT you learned
`);
      sync.sync(workspace);

      const results = store.searchByText('write HOW learned');
      expect(results.length).toBe(1);
      expect(results[0].attribution.context).toContain('MEMORY.md');
      expect(results[0].attribution.context).toContain('Lessons');
      expect(results[0].tags).toContain('synced');
    });

    it('reports status of synced files', () => {
      writeFileSync(join(workspace, 'MEMORY.md'), `# Test
- A fact that is long enough to be indexed properly
`);
      sync.sync(workspace);

      const status = sync.status();
      expect(status.length).toBe(1);
      expect(status[0].filePath).toContain('MEMORY.md');
      expect(status[0].factsCount).toBe(1);
    });
  });

  describe('isNoise', () => {
    it('rejects short content', () => {
      expect(sync.isNoise('Too short')).toBe(true);
    });

    it('rejects strikethrough content', () => {
      expect(sync.isNoise('~~This was completed and crossed out~~')).toBe(true);
    });

    it('rejects bare dates', () => {
      expect(sync.isNoise('2026-02-01')).toBe(true);
    });

    it('accepts meaningful content', () => {
      expect(sync.isNoise('Shaun gave full autonomy on the agent-memory project')).toBe(false);
    });
  });
});
