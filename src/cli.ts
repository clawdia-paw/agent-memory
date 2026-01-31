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
import type { SourceType, MemoryCategory } from './types.js';
import { resolve } from 'path';

const DB_PATH = process.env.AGENT_MEMORY_DB ?? resolve(process.env.HOME ?? '.', '.agent-memory/memory.db');

// Ensure directory exists
import { mkdirSync } from 'fs';
mkdirSync(resolve(DB_PATH, '..'), { recursive: true });

const store = new MemoryStore(DB_PATH);
const command = process.argv[2];

async function main() {
  switch (command) {
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
    default:
      printHelp();
  }
  store.close();
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
  
  console.log('📊 Agent Memory Stats\n');
  console.log(`   Memories:        ${stats.memories}`);
  console.log(`   Entities:        ${stats.entities}`);
  console.log(`   Avg Confidence:  ${stats.avgConfidence}`);
  console.log(`   Avg Relevance:   ${stats.avgRelevance}`);
  console.log(`   Unindexed:       ${unindexed.length}`);
  
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
  const context = await session.getStartupContext();
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

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function printHelp() {
  console.log(`
🧠 Agent Memory CLI

Commands:
  import                    Import MEMORY.md and daily logs
  index                     Generate embeddings for semantic search
  recall "query"            Search memories (alias: search, q)
  entity [id]               List entities or show entity summary
  reflect                   Run reflection cycle (decay, health check)
  stats                     Show memory statistics
  add "content" [options]   Create a new memory
  verify <id>               Verify a memory against others
  contradictions            Find contradicting memories

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
