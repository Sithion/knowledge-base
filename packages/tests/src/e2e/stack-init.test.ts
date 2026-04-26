import { test, expect } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { stackInit, stackUpgrade, stackStatus } from '../../../../apps/mcp-server/src/tools/stack.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const TEMPLATES_DIR = join(REPO_ROOT, 'templates', 'context-engine');
const SCRATCH_ROOT = join(REPO_ROOT, '.test-tmp');

function makeRepo(prefix: string): string {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  return mkdtempSync(join(SCRATCH_ROOT, `${prefix}-`));
}

function cleanup(dir: string) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

test.describe('@e2e stack.init', () => {
  test('initializes a clean repo and records version', async () => {
    const repo = makeRepo('stack-init-clean');
    try {
      const result = await stackInit({ repoPath: repo, templatesDir: TEMPLATES_DIR, skipVenv: true });

      expect(result.initialized).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.version).toBeTruthy();
      expect(result.copiedPaths!.length).toBeGreaterThan(10);

      // Vendored-owned files present in target
      expect(existsSync(join(repo, '.ai', 'index', 'build_index.py'))).toBe(true);
      expect(existsSync(join(repo, '.ai', 'index', 'summarize.py'))).toBe(true);
      expect(existsSync(join(repo, '.ai', 'mcp', 'server.py'))).toBe(true);
      expect(existsSync(join(repo, 'scripts', 'setup_context_engine.sh'))).toBe(true);
      expect(existsSync(join(repo, 'requirements-context.txt'))).toBe(true);

      // User-owned dirs created
      expect(existsSync(join(repo, '.ai', 'context', 'sb-derived'))).toBe(true);

      // Version recorded
      const installed = readFileSync(join(repo, '.ai', '.context-engine-version'), 'utf8').trim();
      const vendored = readFileSync(join(TEMPLATES_DIR, 'VERSION'), 'utf8').trim();
      expect(installed).toBe(vendored);
    } finally {
      cleanup(repo);
    }
  });

  test('is idempotent on already-bootstrapped repo', async () => {
    const repo = makeRepo('stack-init-idem');
    try {
      const first = await stackInit({ repoPath: repo, templatesDir: TEMPLATES_DIR, skipVenv: true });
      expect(first.initialized).toBe(true);

      const second = await stackInit({ repoPath: repo, templatesDir: TEMPLATES_DIR, skipVenv: true });
      expect(second.initialized).toBe(false);
      expect(second.alreadyBootstrapped).toBe(true);
      expect(second.version).toBe(first.version);
    } finally {
      cleanup(repo);
    }
  });

  test('writes sb-project-link when sbProject provided', async () => {
    const repo = makeRepo('stack-init-sb');
    try {
      // Refresh script will likely fail-soft (no SB clone in test env), that's fine.
      const result = await stackInit({
        repoPath: repo,
        templatesDir: TEMPLATES_DIR,
        skipVenv: true,
        sbProject: 'test-project-slug',
      });
      expect(result.initialized).toBe(true);
      const link = readFileSync(join(repo, '.ai', 'sb-project-link'), 'utf8').trim();
      expect(link).toBe('test-project-slug');
    } finally {
      cleanup(repo);
    }
  });

  test('summarize.py bridge default URL targets cognistore IPC route', async () => {
    // Reconciliation guard: the vendored summarize.py defaults to /ipc/addKnowledge.
    // Dashboard server now exposes that path as an alias for /api/knowledge.
    const summarize = readFileSync(join(TEMPLATES_DIR, '.ai', 'index', 'summarize.py'), 'utf8');
    expect(summarize).toMatch(/ipc\/addKnowledge|api\/knowledge/);
  });
});

test.describe('@e2e stack.status', () => {
  test('reports drift between installed and vendored versions', async () => {
    const repo = makeRepo('stack-status');
    try {
      await stackInit({ repoPath: repo, templatesDir: TEMPLATES_DIR, skipVenv: true });

      const status = await stackStatus({ repoPath: repo, templatesDir: TEMPLATES_DIR });
      expect(status.installed).toBe(true);
      expect(status.drift).toBe(false);
      expect(status.version).toBe(status.vendoredVersion);

      // Force drift by overwriting installed version marker
      writeFileSync(join(repo, '.ai', '.context-engine-version'), 'fake-old-sha\n');
      const status2 = await stackStatus({ repoPath: repo, templatesDir: TEMPLATES_DIR });
      expect(status2.drift).toBe(true);
      expect(status2.version).toBe('fake-old-sha');
    } finally {
      cleanup(repo);
    }
  });

  test('reports installed:false when no .ai/index/ exists', async () => {
    const repo = makeRepo('stack-status-uninit');
    try {
      const status = await stackStatus({ repoPath: repo, templatesDir: TEMPLATES_DIR });
      expect(status.installed).toBe(false);
      expect(status.vendoredVersion).toBeTruthy();
    } finally {
      cleanup(repo);
    }
  });
});
