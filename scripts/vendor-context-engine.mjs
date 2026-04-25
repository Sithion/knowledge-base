#!/usr/bin/env node
/**
 * vendor-context-engine.mjs
 *
 * Copies the Context Engine source (`.ai/` scaffold + scripts/ + requirements-context.txt)
 * from the upstream ai-projects repo into `templates/context-engine/`, refreshes
 * `templates/context-engine/VERSION` with the upstream git SHA, and stages all
 * changes via `git add` so re-vendoring is one command + one `git commit`.
 *
 * Source resolution:
 *   1. CONTEXT_ENGINE_SOURCE env var (treated as either ai-projects root or ai-tooling)
 *   2. ~/AcuityTech/ai-projects/ai-tooling
 *   3. ~/AcuityTech/ai-projects (looks for ai-tooling subfolder)
 *
 * Flags:
 *   --dry-run    Print what would be copied without writing or staging
 *   --no-stage   Skip `git add`
 *   --help
 *
 * Idempotent: re-running with no upstream change is a no-op (staged tree is
 * byte-identical, git add is a no-op).
 */

import { existsSync, readdirSync, statSync, mkdirSync, copyFileSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const NO_STAGE = args.has('--no-stage');
const HELP = args.has('--help') || args.has('-h');

if (HELP) {
  console.log(`Usage: node scripts/vendor-context-engine.mjs [--dry-run] [--no-stage]

Copies Context Engine source into templates/context-engine/ and updates VERSION.
Source: $CONTEXT_ENGINE_SOURCE (default: ~/AcuityTech/ai-projects/ai-tooling).
`);
  process.exit(0);
}

const REPO_ROOT = resolve(new URL('..', import.meta.url).pathname);
const TARGET_DIR = join(REPO_ROOT, 'templates', 'context-engine');

function resolveSource() {
  const candidates = [];
  if (process.env.CONTEXT_ENGINE_SOURCE) {
    const p = resolve(process.env.CONTEXT_ENGINE_SOURCE);
    candidates.push(p);
    candidates.push(join(p, 'ai-tooling'));
  }
  candidates.push(join(homedir(), 'AcuityTech', 'ai-projects', 'ai-tooling'));
  candidates.push(join(homedir(), 'AcuityTech', 'ai-projects'));
  for (const c of candidates) {
    if (existsSync(join(c, '.ai')) && existsSync(join(c, 'scripts'))) {
      return c;
    }
    const sub = join(c, 'ai-tooling');
    if (existsSync(join(sub, '.ai')) && existsSync(join(sub, 'scripts'))) {
      return sub;
    }
  }
  console.error('[vendor] could not locate Context Engine source. Tried:');
  for (const c of candidates) console.error(`  - ${c}`);
  console.error('Set CONTEXT_ENGINE_SOURCE to override.');
  process.exit(1);
}

const SOURCE = resolveSource();
console.log(`[vendor] source: ${SOURCE}`);
console.log(`[vendor] target: ${TARGET_DIR}`);
if (DRY_RUN) console.log('[vendor] DRY RUN — no files will be modified');

// ── Files / dirs to vendor ──────────────────────────────────────
// Vendored-owned: install/upgrade replaces these.
// We copy the entire .ai/ tree minus user-owned content and caches.
const PATHS = [
  // Top-level files
  'requirements-context.txt',
  'AGENTS.md',
  'summarize.config.toml.example',

  // Scripts
  'scripts/setup_context_engine.sh',
  'scripts/bootstrap_real_repo.sh',
  'scripts/refresh_sb_context.sh',
  'scripts/verify_context_engine.sh',
  'scripts/run_sample_task.sh',

  // .ai infrastructure (vendored-owned)
  '.ai/index/build_index.py',
  '.ai/index/config.py',
  '.ai/index/dependency_graph.py',
  '.ai/index/retrieve.py',
  '.ai/index/summarize.py',
  '.ai/mcp/server.py',

  // .ai templates / starter content (mergeable / starter)
  '.ai/agents/role_policies.yaml',
  '.ai/agents/routing.yaml',
  '.ai/agents/llm_agents_map.yaml',
  '.ai/agents/context_policy.md',
  '.ai/context/architecture.md',
  '.ai/context/coding_standards.md',
  '.ai/context/domain_model.md',
  '.ai/context/api_contracts.md',
  '.ai/context/sb-derived.gitignore.template',
  '.ai/summaries/repo_summary.md',
  '.ai/summaries/module_template.md',
  '.ai/memory/decisions.log',
  '.ai/memory/bugs.log',
  '.ai/memory/patterns.log',
];

function copyOne(rel) {
  const src = join(SOURCE, rel);
  if (!existsSync(src)) return { rel, skipped: 'missing-in-source' };
  const dst = join(TARGET_DIR, rel);
  if (DRY_RUN) return { rel, copied: true, dryRun: true };
  mkdirSync(dirname(dst), { recursive: true });
  const stat = statSync(src);
  if (stat.isDirectory()) {
    return { rel, skipped: 'is-directory' };
  }
  copyFileSync(src, dst);
  return { rel, copied: true };
}

// Wipe the target tree first (excluding VERSION, which we rewrite) so deletions upstream propagate.
if (!DRY_RUN && existsSync(TARGET_DIR)) {
  for (const entry of readdirSync(TARGET_DIR)) {
    if (entry === 'VERSION' || entry === 'MANIFEST.json') continue;
    rmSync(join(TARGET_DIR, entry), { recursive: true, force: true });
  }
}

mkdirSync(TARGET_DIR, { recursive: true });

const results = PATHS.map(copyOne);
const copied = results.filter(r => r.copied);
const missing = results.filter(r => r.skipped === 'missing-in-source');

console.log(`[vendor] copied ${copied.length} files`);
if (missing.length) {
  console.log(`[vendor] WARN: ${missing.length} declared paths missing in source:`);
  for (const m of missing) console.log(`  - ${m.rel}`);
}

// ── Manifest ────────────────────────────────────────────────────
const manifest = {
  generatedAt: new Date().toISOString(),
  source: SOURCE,
  vendoredOwned: PATHS,
  // Files inside <repoPath>/.ai/ that the bundle treats as user-owned and never overwrites:
  userOwnedPatterns: [
    '.ai/memory/decisions.log',
    '.ai/index/.last-build',
    '.ai/.last-build',
    '.ai/.no-context-engine',
    '.ai/.context-engine-version',
    '.ai/sb-project-link',
    '.ai/context/sb-derived/**',
  ],
};

if (!DRY_RUN) {
  writeFileSync(join(TARGET_DIR, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
}

// ── VERSION ─────────────────────────────────────────────────────
let upstreamSha = '';
try {
  // Walk up to find ai-projects git repo (since ai-tooling may live inside it).
  upstreamSha = execSync(`git -C "${SOURCE}" rev-parse HEAD`, { encoding: 'utf8' }).trim();
} catch {
  try {
    upstreamSha = execSync(`git -C "${dirname(SOURCE)}" rev-parse HEAD`, { encoding: 'utf8' }).trim();
  } catch {
    console.error('[vendor] could not determine upstream git SHA');
    process.exit(2);
  }
}

const versionContent = `${upstreamSha}\n`;
if (!DRY_RUN) {
  writeFileSync(join(TARGET_DIR, 'VERSION'), versionContent);
}
console.log(`[vendor] VERSION = ${upstreamSha}`);

// ── git add ─────────────────────────────────────────────────────
if (!DRY_RUN && !NO_STAGE) {
  try {
    execSync(`git -C "${REPO_ROOT}" add templates/context-engine`, { stdio: 'inherit' });
    console.log('[vendor] staged templates/context-engine');
  } catch (e) {
    console.error('[vendor] git add failed:', e.message);
  }
}

console.log('[vendor] done');
