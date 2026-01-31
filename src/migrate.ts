#!/usr/bin/env node
/**
 * Agent Memory — Migration Tool
 * 
 * One-shot migration from flat-file memory to structured agent-memory.
 * Imports MEMORY.md + daily logs, indexes embeddings, runs reflection.
 * 
 * Usage: npx tsx src/migrate.ts [--db PATH] [--memory PATH] [--logs DIR]
 */

import { MemoryStore } from './store.js';
import { RecallEngine } from './recall.js';
import { MemoryImporter } from './import.js';
import { ReflectEngine } from './reflect.js';
import { EntityManager } from './entities.js';
import { GeminiEmbedder, CachedEmbedder } from './embeddings.js';
import { resolve } from 'path';
import { mkdirSync, existsSync } from 'fs';

const HOME = process.env.HOME ?? '/home/clawdia';
const DB_PATH = getArg('--db') ?? resolve(HOME, '.agent-memory/memory.db');
const MEMORY_PATH = getArg('--memory') ?? resolve(HOME, '.openclaw/workspace/MEMORY.md');
const LOGS_PATH = getArg('--logs') ?? resolve(HOME, '.openclaw/workspace/memory');

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

async function migrate() {
  console.log('🧠 Agent Memory — Migration\n');
  console.log(`  DB:     ${DB_PATH}`);
  console.log(`  Memory: ${MEMORY_PATH}`);
  console.log(`  Logs:   ${LOGS_PATH}\n`);

  // Ensure DB directory
  mkdirSync(resolve(DB_PATH, '..'), { recursive: true });

  // Check if DB already exists
  if (existsSync(DB_PATH)) {
    console.log('⚠️  Database already exists. To re-migrate, delete it first:');
    console.log(`   rm ${DB_PATH}`);
    console.log('   Then run this again.\n');
    
    const store = new MemoryStore(DB_PATH);
    const stats = store.getStats();
    console.log(`  Current: ${stats.memories} memories, ${stats.entities} entities`);
    store.close();
    return;
  }

  const store = new MemoryStore(DB_PATH);
  const entityMgr = new EntityManager(store);
  const importer = new MemoryImporter(store);

  // Step 0: Seed known entities
  const seeded = entityMgr.seedEntities();
  console.log(`📋 Seeded ${seeded} known entities.`);

  // Step 1: Import
  console.log('📥 Step 1: Importing flat-file memories...');
  
  if (existsSync(MEMORY_PATH)) {
    const memStats = importer.importMemoryMd(MEMORY_PATH);
    console.log(`   MEMORY.md: ${memStats.memoriesCreated} memories`);
  } else {
    console.log('   MEMORY.md not found, skipping.');
  }

  if (existsSync(LOGS_PATH)) {
    const logStats = importer.importDailyLogs(LOGS_PATH);
    console.log(`   Daily logs: ${logStats.filesProcessed} files → ${logStats.memoriesCreated} memories`);
  } else {
    console.log('   Daily logs not found, skipping.');
  }

  // Step 2: Index embeddings
  console.log('\n🔄 Step 2: Generating semantic embeddings...');
  try {
    const embedder = new CachedEmbedder(new GeminiEmbedder());
    const unindexed = store.getMemoriesWithoutEmbeddings(500);
    
    if (unindexed.length > 0) {
      const texts = unindexed.map(m => m.summary ?? m.content.slice(0, 500));
      const embeddings = await embedder.embedBatch(texts);
      
      for (let i = 0; i < unindexed.length; i++) {
        store.setEmbedding(unindexed[i].id, embeddings[i]);
        process.stdout.write(`\r   Indexed ${i + 1}/${unindexed.length}`);
      }
      console.log(' ✓');
    }
  } catch (e: any) {
    console.log(`   ⚠️ Skipping embeddings (${e.message}). Run 'index' later.`);
  }

  // Step 3: Reflect
  console.log('\n🔄 Step 3: Running initial reflection...');
  const recall = new RecallEngine(store);
  const reflect = new ReflectEngine(store, recall);
  const report = await reflect.reflect();
  console.log(ReflectEngine.formatReport(report));

  // Final stats
  const stats = store.getStats();
  console.log(`\n✅ Migration complete!`);
  console.log(`   ${stats.memories} memories, ${stats.entities} entities`);
  console.log(`   Avg confidence: ${stats.avgConfidence}`);
  console.log(`   Database: ${DB_PATH}`);
  console.log(`\n   Your flat files are untouched. Both systems work side by side.`);

  store.close();
}

migrate().catch(console.error);
