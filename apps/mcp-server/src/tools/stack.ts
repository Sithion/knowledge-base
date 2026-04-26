/**
 * Stack tools — Context Engine bundle lifecycle.
 *
 * Implements the `stack.init`, `stack.upgrade`, and `stack.status` MCP tools
 * defined in `openspec/changes/ai-stack-poc-cognistore/specs/context-engine-bundle/spec.md`.
 *
 * The vendored Context Engine snapshot lives under `templates/context-engine/`
 * at the cognistore repo root (relative to the running mcp-server bundle).
 * `findTemplatesDir()` resolves it for both dev (tsx) and packaged (dist) runs.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export interface StackInitOptions {
  repoPath: string;
  sbProject?: string;
  /** Override templates dir (used by tests). */
  templatesDir?: string;
  /** Skip the venv setup script — used by tests when Python is unavailable. */
  skipVenv?: boolean;
}

export interface StackUpgradeOptions {
  repoPath: string;
  templatesDir?: string;
}

export interface StackStatusOptions {
  repoPath: string;
  templatesDir?: string;
}

export interface StackInitResult {
  initialized: boolean;
  alreadyBootstrapped?: boolean;
  version: string;
  sbDerived?: boolean;
  copiedPaths?: string[];
  errors: string[];
  warnings?: string[];
}

export interface StackUpgradeResult {
  upgraded: boolean;
  fromVersion: string | null;
  toVersion: string;
  filesUpdated?: string[];
  reason?: string;
}

export interface StackStatusResult {
  installed: boolean;
  drift?: boolean;
  version?: string | null;
  vendoredVersion: string;
  lastBuild?: string | null;
  sbDerivedPresent?: boolean;
}

interface Manifest {
  vendoredOwned: string[];
  userOwnedPatterns: string[];
}

const USER_OWNED_DEFAULTS = [
  '.ai/memory/decisions.log',
  '.ai/memory/bugs.log',
  '.ai/memory/patterns.log',
  '.ai/index/.last-build',
  '.ai/.last-build',
  '.ai/.no-context-engine',
  '.ai/.context-engine-version',
  '.ai/sb-project-link',
];

/** Resolve `templates/context-engine/` regardless of whether we're running from src/ or dist/. */
export function findTemplatesDir(startDir?: string): string {
  if (process.env.COGNISTORE_TEMPLATES_DIR) {
    const p = resolve(process.env.COGNISTORE_TEMPLATES_DIR);
    if (existsSync(join(p, 'context-engine'))) return join(p, 'context-engine');
    if (existsSync(p) && existsSync(join(p, 'VERSION'))) return p;
  }

  let here = startDir ?? dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const cand = join(here, 'templates', 'context-engine', 'VERSION');
    if (existsSync(cand)) return dirname(cand);
    const parent = dirname(here);
    if (parent === here) break;
    here = parent;
  }
  const cwdCand = join(process.cwd(), 'templates', 'context-engine');
  if (existsSync(join(cwdCand, 'VERSION'))) return cwdCand;
  throw new Error('stack tools: could not locate templates/context-engine/. Set COGNISTORE_TEMPLATES_DIR.');
}

function readVersion(dir: string): string | null {
  const p = join(dir, 'VERSION');
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8').trim();
}

function readManifest(templatesDir: string): Manifest {
  const p = join(templatesDir, 'MANIFEST.json');
  if (!existsSync(p)) {
    return { vendoredOwned: [], userOwnedPatterns: USER_OWNED_DEFAULTS };
  }
  const m = JSON.parse(readFileSync(p, 'utf8'));
  return {
    vendoredOwned: Array.isArray(m.vendoredOwned) ? m.vendoredOwned : [],
    userOwnedPatterns: Array.isArray(m.userOwnedPatterns) ? m.userOwnedPatterns : USER_OWNED_DEFAULTS,
  };
}

function copyTree(srcRoot: string, dstRoot: string, files: string[], opts: { skipUserOwned: string[] }): string[] {
  const written: string[] = [];
  for (const rel of files) {
    if (opts.skipUserOwned.includes(rel)) continue;
    const src = join(srcRoot, rel);
    if (!existsSync(src)) continue;
    if (!statSync(src).isFile()) continue;
    const dst = join(dstRoot, rel);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    written.push(rel);
  }
  return written;
}

function ensureUserOwnedDirs(repoPath: string): void {
  const dirs = [
    '.ai/memory',
    '.ai/index',
    '.ai/context/sb-derived',
    '.ai/tasks/active',
    '.ai/tasks/completed',
  ];
  for (const d of dirs) mkdirSync(join(repoPath, d), { recursive: true });
}

function installedVersionFile(repoPath: string): string {
  return join(repoPath, '.ai', '.context-engine-version');
}

function recordInstalledVersion(repoPath: string, version: string): void {
  const f = installedVersionFile(repoPath);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, version + '\n');
}

function readInstalledVersion(repoPath: string): string | null {
  const f = installedVersionFile(repoPath);
  if (!existsSync(f)) return null;
  return readFileSync(f, 'utf8').trim();
}

/**
 * stack.init — bootstrap Context Engine into a target repo.
 */
export async function stackInit(opts: StackInitOptions): Promise<StackInitResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const repoPath = resolve(opts.repoPath);
  const templatesDir = opts.templatesDir ?? findTemplatesDir();
  const version = readVersion(templatesDir) ?? '';

  if (!existsSync(repoPath)) {
    return { initialized: false, version, errors: [`repoPath does not exist: ${repoPath}`] };
  }

  const lastBuild = join(repoPath, '.ai', '.last-build');
  const indexLastBuild = join(repoPath, '.ai', 'index', '.last-build');
  if (existsSync(lastBuild) || existsSync(indexLastBuild) || existsSync(installedVersionFile(repoPath))) {
    return {
      initialized: false,
      alreadyBootstrapped: true,
      version: readInstalledVersion(repoPath) ?? version,
      errors,
    };
  }

  const manifest = readManifest(templatesDir);
  const userOwned = manifest.userOwnedPatterns.filter(p => !p.includes('*'));
  const copiedPaths = copyTree(templatesDir, repoPath, manifest.vendoredOwned, { skipUserOwned: userOwned });

  ensureUserOwnedDirs(repoPath);

  const scriptsDir = join(repoPath, 'scripts');
  if (existsSync(scriptsDir)) {
    for (const f of readdirSync(scriptsDir)) {
      if (f.endsWith('.sh')) {
        try { spawnSync('chmod', ['+x', join(scriptsDir, f)], { stdio: 'ignore' }); } catch {}
      }
    }
  }

  if (!opts.skipVenv) {
    const setup = join(repoPath, 'scripts', 'setup_context_engine.sh');
    if (existsSync(setup)) {
      const r = spawnSync('bash', [setup], { cwd: repoPath, encoding: 'utf8' });
      if (r.status !== 0) {
        warnings.push(`setup_context_engine.sh exited ${r.status}: ${(r.stderr || '').slice(0, 1000)}`);
      }
    } else {
      warnings.push('setup_context_engine.sh not found after copy — venv not created');
    }
  }

  let sbDerived = false;
  if (opts.sbProject) {
    const linkPath = join(repoPath, '.ai', 'sb-project-link');
    mkdirSync(dirname(linkPath), { recursive: true });
    writeFileSync(linkPath, opts.sbProject + '\n');
    const refresh = join(repoPath, 'scripts', 'refresh_sb_context.sh');
    if (existsSync(refresh)) {
      const r = spawnSync('bash', [refresh, '--soft', repoPath], { cwd: repoPath, encoding: 'utf8' });
      if (r.status === 0) {
        sbDerived = true;
      } else {
        warnings.push(`refresh_sb_context.sh exited ${r.status}: ${(r.stderr || '').slice(0, 500)}`);
      }
    }
  }

  recordInstalledVersion(repoPath, version);

  return {
    initialized: true,
    version,
    sbDerived,
    copiedPaths,
    errors,
    warnings,
  };
}

/**
 * stack.upgrade — overwrite vendored-owned files while preserving user content.
 */
export async function stackUpgrade(opts: StackUpgradeOptions): Promise<StackUpgradeResult> {
  const repoPath = resolve(opts.repoPath);
  const templatesDir = opts.templatesDir ?? findTemplatesDir();
  const toVersion = readVersion(templatesDir) ?? '';
  const fromVersion = readInstalledVersion(repoPath);

  if (fromVersion && fromVersion === toVersion) {
    return { upgraded: false, fromVersion, toVersion, reason: 'already-current' };
  }

  const manifest = readManifest(templatesDir);
  const userOwned = manifest.userOwnedPatterns.filter(p => !p.includes('*'));
  const filesUpdated = copyTree(templatesDir, repoPath, manifest.vendoredOwned, { skipUserOwned: userOwned });

  const scriptsDir = join(repoPath, 'scripts');
  if (existsSync(scriptsDir)) {
    for (const f of readdirSync(scriptsDir)) {
      if (f.endsWith('.sh')) {
        try { spawnSync('chmod', ['+x', join(scriptsDir, f)], { stdio: 'ignore' }); } catch {}
      }
    }
  }

  recordInstalledVersion(repoPath, toVersion);

  return { upgraded: true, fromVersion, toVersion, filesUpdated };
}

/**
 * stack.status — report installation state and drift vs vendored snapshot.
 */
export async function stackStatus(opts: StackStatusOptions): Promise<StackStatusResult> {
  const repoPath = resolve(opts.repoPath);
  const templatesDir = opts.templatesDir ?? findTemplatesDir();
  const vendoredVersion = readVersion(templatesDir) ?? '';

  const aiDir = join(repoPath, '.ai');
  const indexDir = join(aiDir, 'index');
  const installed = existsSync(indexDir);
  if (!installed) {
    return { installed: false, vendoredVersion };
  }

  const version = readInstalledVersion(repoPath);

  let lastBuild: string | null = null;
  for (const candidate of [join(aiDir, '.last-build'), join(indexDir, '.last-build')]) {
    if (existsSync(candidate)) {
      try {
        const s = statSync(candidate);
        lastBuild = s.mtime.toISOString();
        break;
      } catch {}
    }
  }

  const sbDerivedDir = join(aiDir, 'context', 'sb-derived');
  const sbDerivedPresent = existsSync(sbDerivedDir) &&
    readdirSync(sbDerivedDir).filter(f => !f.startsWith('.')).length > 0;

  return {
    installed: true,
    version,
    vendoredVersion,
    drift: version !== vendoredVersion,
    lastBuild,
    sbDerivedPresent,
  };
}
