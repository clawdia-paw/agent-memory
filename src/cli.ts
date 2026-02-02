#!/usr/bin/env node
/**
 * Agent Memory — CLI
 * 
 * Usage:
 *   npx tsx src/cli.ts import [--memory PATH] [--logs DIR]
 *   npx tsx src/cli.ts index                    # Generate embeddings for all memories
 *   npx tsx src/cli.ts recall "query text"       # Search memories
 *   npx tsx src/cli.ts entity <id>               # Show entity summary
 *   npx tsx src/cli.ts reflect                   # Run reflection cycle
 *   npx tsx src/cli.ts stats                     # Show memory stats
 *   npx tsx src/cli.ts add "content" --source TYPE [--actor NAME] [--category CAT]
 */

import { MemoryStore } from './store.js';
import { RecallEngine } from './recall.js';
import { MemoryImporter } from './import.js';
import { ReflectEngine } from './reflect.js';
import { CorroborationEngine } from './corroborate.js';
import { GeminiEmbedder, CachedEmbedder } from './embeddings.js';
import { SessionMemory } from './session.js';
import { NarrativeLayer } from './narrative.js';
import { EntityManager } from './entities.js';
import { SyncEngine } from './sync.js';
import type { SourceType, MemoryCategory } from './types.js';
import { resolve, relative } from 'path';

const DB_PATH = process.env.AGENT_MEMORY_DB ?? resolve(process.env.HOME ?? '.', '.agent-memory/memory.db');

// Ensure directory exists
import { mkdirSync } from 'fs';
mkdirSync(resolve(DB_PATH, '..'), { recursive: true });

const store = new MemoryStore(DB_PATH);
const command = process.argv[2];

async function main() {
  switch (command) {
    case 'sync':
      cmdSync();
      break;
    case 'import':
      await cmdImport();
      break;
    case 'index':
      await cmdIndex();
      break;
    case 'recall':
    case 'search':
    case 'q':
      await cmdRecall();
      break;
    case 'entity':
      cmdEntity();
      break;
    case 'reflect':
      await cmdReflect();
      break;
    case 'stats':
      cmdStats();
      break;
    case 'add':
      cmdAdd();
      break;
    case 'verify':
      await cmdVerify();
      break;
    case 'contradictions':
      cmdContradictions();
      break;
    case 'startup':
      await cmdStartup();
      break;
    case 'remember':
      cmdRemember();
      break;
    case 'narrate':
    case 'narrative':
      cmdNarrate();
      break;
    case 'end':
      cmdEnd();
      break;
    case 'narratives':
      cmdNarratives();
      break;
    case 'seed':
      cmdSeed();
      break;
    case 'audit':
      cmdAudit();
      break;
    case 'prune':
      cmdPrune();
      break;
    default:
      printHelp();
  }
  store.close();
}

function cmdSync() {
  const workspacePath = getArg('--workspace') ?? resolve(process.env.HOME ?? '.', '.openclaw/workspace');
  const force = hasFlag('--force');
  const statusOnly = hasFlag('--status');

  const sync = new SyncEngine(store);

  if (statusOnly) {
    const files = sync.status();
    if (files.length === 0) {
      console.log('No files synced yet. Run `mem sync` to index workspace files.');
      return;
    }
    console.log('📋 Synced files:\n');
    for (const f of files) {
      const ago = Math.round((Date.now() - f.lastSynced) / 60000);
      const rel = relative(workspacePath, f.filePath);
      console.log(`  ${rel} — ${f.factsCount} facts (synced ${ago}m ago)`);
    }
    return;
  }

  console.log(`🔄 Syncing workspace: ${workspacePath}${force ? ' (forced)' : ''}\n`);
  const stats = sync.sync(workspacePath, { force });

  console.log(`   Files scanned:    ${stats.filesScanned}`);
  console.log(`   Files changed:    ${stats.filesChanged}`);
  console.log(`   Facts extracted:  ${stats.factsExtracted}`);
  console.log(`   Noise skipped:    ${stats.factsSkipped}`);
  console.log(`   Old facts removed: ${stats.oldFactsRemoved}`);

  if (stats.filesChanged === 0) {
    console.log('\n✅ Everything up to date.');
  } else {
    console.log(`\n✅ Synced ${stats.factsExtracted} facts from ${stats.filesChanged} files.`);
  }
}

function cmdImport() {
  const importer = new MemoryImporter(store);
  
  const memoryPath = getArg('--memory') ?? resolve(process.env.HOME ?? '.', '.openclaw/workspace/MEMORY.md');
  const logsPath = getArg('--logs') ?? resolve(process.env.HOME ?? '.', '.openclaw/workspace/memory');

  console.log('📥 Importing memories...\n');
  
  const memStats = importer.importMemoryMd(memoryPath);
  console.log(`MEMORY.md: ${memStats.memoriesCreated} memories imported (${memStats.skipped} skipped)`);
  
  const logStats = importer.importDailyLogs(logsPath);
  console.log(`Daily logs: ${logStats.filesProcessed} files, ${logStats.memoriesCreated} memories imported`);
  
  const stats = store.getStats();
  console.log(`\n📊 Total: ${stats.memories} memories, ${stats.entities} entities`);
}

async function cmdIndex() {
  console.log('🔄 Indexing memories with embeddings...\n');
  
  const embedder = new CachedEmbedder(new GeminiEmbedder());
  const unindexed = store.getMemoriesWithoutEmbeddings(100);
  
  if (unindexed.length === 0) {
    console.log('All memories already have embeddings. ✓');
    return;
  }

  console.log(`Found ${unindexed.length} memories without embeddings.`);
  
  const texts = unindexed.map(m => m.summary ?? m.content.slice(0, 500));
  const embeddings = await embedder.embedBatch(texts);
  
  for (let i = 0; i < unindexed.length; i++) {
    store.setEmbedding(unindexed[i].id, embeddings[i]);
    process.stdout.write(`\r   Indexed ${i + 1}/${unindexed.length}`);
  }
  
  console.log(`\n\n✅ Indexed ${unindexed.length} memories. Cache: ${embedder.cacheSize} embeddings.`);
}

async function cmdRecall() {
  const query = process.argv.slice(3).join(' ');
  if (!query) {
    console.error('Usage: recall "your query"');
    return;
  }

  let embedder;
  try {
    embedder = new CachedEmbedder(new GeminiEmbedder());
  } catch {
    // No API key — fall back to text-only search
  }

  const recall = new RecallEngine(store, embedder);
  
  const compact = process.argv.includes('--compact') || process.argv.includes('-c');
  const limitArg = getArg('--limit');
  const queryLimit = limitArg ? parseInt(limitArg) : (compact ? 5 : 10);
  
  if (!compact) console.log(`🔍 Recalling: "${query}"\n`);
  
  const results = await recall.recall({
    text: query,
    limit: queryLimit,
  });
  
  console.log(compact ? recall.formatCompact(results) : recall.formatResults(results));
  
  if (!embedder) {
    console.log('\n💡 Set GEMINI_API_KEY for semantic search (currently text-only).');
  }
}

function cmdEntity() {
  const entityId = process.argv[3];
  if (!entityId) {
    // List all entities
    const entities = store.getAllEntities();
    console.log('📋 Entities:\n');
    for (const e of entities) {
      console.log(`  ${e.id} (${e.type}) — ${e.memoryCount} memories${e.description ? ` — ${e.description}` : ''}`);
    }
    return;
  }

  const recall = new RecallEngine(store);
  const reflect = new ReflectEngine(store, recall);
  console.log(reflect.generateEntitySummary(entityId));
}

async function cmdReflect() {
  const recall = new RecallEngine(store);
  const reflect = new ReflectEngine(store, recall);
  
  console.log('🔄 Running reflection cycle...\n');
  const report = await reflect.reflect();
  console.log(ReflectEngine.formatReport(report));
}

function cmdStats() {
  const stats = store.getStats();
  const entities = store.getAllEntities();
  const unindexed = store.getMemoriesWithoutEmbeddings(1000);
  const all = store.getAllMemories(500);
  
  // Source type distribution
  const typeDist: Record<string, number> = {};
  const catDist: Record<string, number> = {};
  for (const m of all) {
    typeDist[m.attribution.type] = (typeDist[m.attribution.type] ?? 0) + 1;
    catDist[m.category] = (catDist[m.category] ?? 0) + 1;
  }
  
  // Most accessed
  const mostAccessed = [...all].sort((a, b) => b.accessCount - a.accessCount).slice(0, 5);
  
  // Narrative count
  const narrative = new NarrativeLayer();
  const narrativeCount = narrative.getRecent(100).length;
  
  console.log('📊 Agent Memory Stats\n');
  console.log(`   Memories:        ${stats.memories}`);
  console.log(`   Entities:        ${stats.entities}`);
  console.log(`   Narratives:      ${narrativeCount}`);
  console.log(`   Avg Confidence:  ${stats.avgConfidence}`);
  console.log(`   Avg Relevance:   ${stats.avgRelevance}`);
  console.log(`   Unindexed:       ${unindexed.length}`);
  
  console.log(`\n   Sources: ${Object.entries(typeDist).map(([k,v]) => `${k}=${v}`).join(', ')}`);
  console.log(`   Categories: ${Object.entries(catDist).map(([k,v]) => `${k}=${v}`).join(', ')}`);
  
  if (mostAccessed.length > 0 && mostAccessed[0].accessCount > 0) {
    console.log('\n   Most recalled:');
    for (const m of mostAccessed.filter(m => m.accessCount > 0)) {
      console.log(`     [${m.accessCount}x] ${m.summary ?? m.content.slice(0, 60)}`);
    }
  }
  
  if (entities.length > 0) {
    console.log('\n   Top entities:');
    for (const e of entities.slice(0, 10)) {
      console.log(`     ${e.id}: ${e.memoryCount} memories`);
    }
  }
}

function cmdAdd() {
  const content = process.argv[3];
  if (!content) {
    console.error('Usage: add "memory content" --source TYPE [--actor NAME] [--category CAT]');
    return;
  }

  const sourceType = (getArg('--source') ?? 'experienced') as SourceType;
  const actor = getArg('--actor');
  const context = getArg('--context');
  const category = (getArg('--category') ?? 'fact') as MemoryCategory;
  const tags = getArg('--tags')?.split(',') ?? [];
  const entities = getArg('--entities')?.split(',') ?? [];
  const pinned = process.argv.includes('--pinned');

  const memory = store.createMemory({
    content,
    attribution: { type: sourceType, actor, context },
    category,
    tags,
    entities,
    pinned,
  });

  console.log(`✅ Created memory ${memory.id.slice(0, 8)}`);
  console.log(`   Confidence: ${memory.confidence.score}`);
  console.log(`   Category: ${memory.category}`);
  console.log(`   Decay rate: ${memory.decayRate}`);

  // Check corroboration
  const corr = new CorroborationEngine(store);
  const results = corr.checkCorroboration(memory);
  if (results.length > 0) {
    console.log(`\n🔗 Corroboration found:`);
    for (const r of results) {
      console.log(`   Memory ${r.memoryId.slice(0, 8)}: ${r.oldConfidence} → ${r.newConfidence} (${r.reason})`);
    }
  }
}

async function cmdVerify() {
  const memoryId = process.argv[3];
  if (!memoryId) {
    console.error('Usage: verify <memory-id>');
    return;
  }

  const corr = new CorroborationEngine(store);
  const result = corr.verifyMemory(memoryId);
  
  console.log(`🔍 Verification: ${result.verified ? '✅ Verified' : '❌ Unverified'}`);
  console.log(`   Confidence: ${result.newConfidence}`);
  console.log(`   Evidence:`);
  for (const e of result.evidence) {
    console.log(`     - ${e}`);
  }
}

function cmdContradictions() {
  const corr = new CorroborationEngine(store);
  const results = corr.findContradictions();
  console.log(CorroborationEngine.formatContradictions(results));
}

async function cmdStartup() {
  store.close(); // Close the default store, use SessionMemory instead
  const session = new SessionMemory();
  const budgetArg = getArg('--budget');
  const budget = budgetArg ? parseInt(budgetArg) : 800;
  const context = await session.getStartupContext(budget);
  console.log(context);
  session.close();
}

function cmdRemember() {
  const content = process.argv[3];
  if (!content) {
    console.error('Usage: remember "what you learned" --source TYPE [--actor NAME]');
    return;
  }
  store.close();
  const session = new SessionMemory();
  const sourceType = (getArg('--source') ?? 'experienced') as any;
  const result = session.remember(content, {
    source: sourceType,
    actor: getArg('--actor'),
    context: getArg('--context'),
    category: getArg('--category'),
    entities: getArg('--entities')?.split(','),
    pinned: process.argv.includes('--pinned'),
  });
  console.log(result);
  session.close();
}

function cmdAudit() {
  const all = store.getAllMemories(500);
  
  // Find low-quality memories: short content, no summary, never accessed, defaulted attribution
  const suspicious: typeof all = [];
  const neverAccessed: typeof all = [];
  const noSummary: typeof all = [];
  const tooShort: typeof all = [];

  for (const m of all) {
    if (m.accessCount === 0 && !m.pinned) neverAccessed.push(m);
    if (!m.summary && m.content.length > 50) noSummary.push(m);
    if (m.content.length < 30) tooShort.push(m);
    // Suspicious: experienced at 95% but looks like it was imported (no entities linked, generic content)
    if (m.attribution.type === 'experienced' && m.confidence.score === 0.95 && m.content.length < 60) {
      suspicious.push(m);
    }
  }

  console.log('🔍 Memory Audit\n');
  console.log(`Total memories: ${all.length}`);
  console.log(`Never accessed (not pinned): ${neverAccessed.length}`);
  console.log(`Missing summary: ${noSummary.length}`);
  console.log(`Very short (<30 chars): ${tooShort.length}`);
  console.log(`Suspicious (experienced+95%+short): ${suspicious.length}`);

  if (tooShort.length > 0) {
    console.log('\n📋 Very short memories (candidates for removal):');
    for (const m of tooShort.slice(0, 10)) {
      console.log(`  [${m.id.slice(0, 8)}] "${m.content}"`);
    }
  }

  if (suspicious.length > 0) {
    console.log('\n⚠️  Suspicious imports (experienced+95%+short):');
    for (const m of suspicious.slice(0, 10)) {
      console.log(`  [${m.id.slice(0, 8)}] "${m.content}"`);
    }
  }

  // Quality score distribution
  const qualityBuckets = { high: 0, medium: 0, low: 0 };
  for (const m of all) {
    const hasGoodContent = m.content.length > 50;
    const hasSummary = !!m.summary;
    const hasEntities = m.tags.length > 0;
    const isAccessed = m.accessCount > 0;
    const score = (hasGoodContent ? 1 : 0) + (hasSummary ? 1 : 0) + (hasEntities ? 1 : 0) + (isAccessed ? 1 : 0);
    if (score >= 3) qualityBuckets.high++;
    else if (score >= 2) qualityBuckets.medium++;
    else qualityBuckets.low++;
  }
  console.log(`\n📊 Quality: ${qualityBuckets.high} high, ${qualityBuckets.medium} medium, ${qualityBuckets.low} low`);
}

function cmdPrune() {
  const dryRun = !hasFlag('--confirm');
  const all = store.getAllMemories(500);
  
  const toRemove: { id: string; reason: string; content: string }[] = [];

  for (const m of all) {
    // Section headers (very short, no real info)
    if (m.content.length < 30 && !m.pinned) {
      toRemove.push({ id: m.id, reason: 'too short (<30 chars)', content: m.content });
    }
  }

  if (toRemove.length === 0) {
    console.log('✅ No memories to prune.');
    return;
  }

  console.log(`🗑️  Pruning ${toRemove.length} low-quality memories${dryRun ? ' (DRY RUN — add --confirm to delete)' : ''}:\n`);
  for (const m of toRemove) {
    console.log(`  [${m.id.slice(0, 8)}] ${m.reason}: "${m.content}"`);
    if (!dryRun) {
      store.deleteMemory(m.id);
    }
  }

  if (!dryRun) {
    console.log(`\n✅ Deleted ${toRemove.length} memories.`);
  }
}

function cmdSeed() {
  const em = new EntityManager(store);
  const r = em.seedEntities();
  console.log(`📋 Entities: ${r.created} created, ${r.updated} updated`);
}

function cmdEnd() {
  // Alias for narrate with better UX
  const text = process.argv[3];
  if (!text) {
    console.log('📝 End-of-Session Reflection');
    console.log('');
    console.log('Usage: mem end "Your reflection in natural language"');
    console.log('');
    console.log('Capture what matters:');
    console.log('  - What you were doing and why');
    console.log('  - What questions you\'re carrying forward');
    console.log('  - How the work felt');
    console.log('');
    console.log('Options: --mood <word> --projects <a,b> --questions <q1,q2>');
    return;
  }
  cmdNarrate(); // Same implementation, different name
}

function cmdNarrate() {
  const text = process.argv[3];
  if (!text) {
    console.error('Usage: narrate "Your narrative paragraph" [--mood focused] [--projects p1,p2] [--questions q1,q2]');
    return;
  }
  const narrative = new NarrativeLayer();
  const path = narrative.save({
    timestamp: Date.now(),
    text,
    mood: getArg('--mood'),
    activeProjects: getArg('--projects')?.split(',') ?? [],
    openQuestions: getArg('--questions')?.split(',') ?? [],
  });
  console.log(`📝 Narrative saved: ${path}`);
}

function cmdNarratives() {
  const narrative = new NarrativeLayer();
  const count = parseInt(getArg('--count') ?? '3');
  const recent = narrative.getRecent(count);
  
  if (recent.length === 0) {
    console.log('No narratives yet. Write one with: mem narrate "your narrative"');
    return;
  }
  
  console.log('📖 Recent Narratives:\n');
  console.log(narrative.formatThread(recent));
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function printHelp() {
  console.log(`
🧠 Agent Memory CLI

Commands:
  sync [--force] [--status] Index workspace markdown files (bridge mode)
  startup [--budget N]      Session startup context (default: 800 tokens)
  recall "query"            Search memories (alias: search, q)
  add "content" [options]   Create a new memory
  end "reflection"          End-of-session narrative (alias: narrate)
  narratives                View recent narrative thread
  entity [id]               List entities or show entity summary
  stats                     Show memory statistics
  audit                     Audit memory quality
  prune [--confirm]         Remove low-quality memories
  seed                      Update entity descriptions
  reflect                   Run reflection cycle (decay, health check)
  verify <id>               Verify a memory against others
  contradictions            Find contradicting memories
  import                    Import MEMORY.md and daily logs (legacy)
  index                     Generate embeddings for semantic search

Options for 'add':
  --source TYPE             experienced|told|read|inferred|observed
  --actor NAME              Who told you / who you observed
  --context TEXT            Where/how you learned this
  --category CAT            fact|event|opinion|preference|procedure|relationship|observation
  --tags tag1,tag2          Comma-separated tags
  --entities e1,e2          Comma-separated entity IDs
  --pinned                  Exempt from decay

Environment:
  AGENT_MEMORY_DB           Database path (default: ~/.agent-memory/memory.db)
  GEMINI_API_KEY            For semantic search embeddings
`);
}

main().catch(console.error);
