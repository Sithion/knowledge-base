import { test, expect } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stackInit, stackUpgrade } from '../../../../apps/mcp-server/src/tools/stack.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const TEMPLATES_DIR = join(REPO_ROOT, 'templates', 'context-engine');
const SCRATCH_ROOT = join(REPO_ROOT, '.test-tmp');

function makeDir(prefix: string): string {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  return mkdtempSync(join(SCRATCH_ROOT, `${prefix}-`));
}

function cleanup(dir: string) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

test.describe('@e2e stack.upgrade', () => {
  test('refreshes vendored files but preserves user-owned content', async () => {
    const repo = makeDir('stack-upgrade-repo');
    const fixture = makeDir('stack-upgrade-fixture');

    try {
      // 1) Initialize repo from real templates
      const init = await stackInit({ repoPath: repo, templatesDir: TEMPLATES_DIR, skipVenv: true });
      expect(init.initialized).toBe(true);

      // 2) Seed user-owned content that upgrade MUST NOT clobber
      const decisionsPath = join(repo, '.ai', 'memory', 'decisions.log');
      const decisionsContent = '2025-01-01T00:00:00Z [seed] preserved decision body\n';
      writeFileSync(decisionsPath, decisionsContent, 'utf8');

      const lastBuildPath = join(repo, '.ai', '.last-build');
      const lastBuildContent = '2025-01-01T00:00:00Z\n';
      writeFileSync(lastBuildPath, lastBuildContent, 'utf8');

      const sbDerivedDir = join(repo, '.ai', 'context', 'sb-derived');
      mkdirSync(sbDerivedDir, { recursive: true });
      const sbDerivedFile = join(sbDerivedDir, 'sample-decision.md');
      const sbDerivedContent = '# preserved sb-derived doc\nbody\n';
      writeFileSync(sbDerivedFile, sbDerivedContent, 'utf8');

      // 3) Build fixture templates dir = clone of TEMPLATES_DIR with bumped VERSION
      //    and a tweaked vendored file so we can prove vendored content was refreshed.
      cpSync(TEMPLATES_DIR, fixture, { recursive: true });
      const fakeSha = 'deadbeef'.repeat(5); // 40 chars
      writeFileSync(join(fixture, 'VERSION'), fakeSha + '\n', 'utf8');

      const tweakedScript = '#!/usr/bin/env bash\n# UPGRADED FIXTURE MARKER\n';
      writeFileSync(join(fixture, 'scripts', 'setup_context_engine.sh'), tweakedScript, 'utf8');

      // 4) Run upgrade
      const result = await stackUpgrade({ repoPath: repo, templatesDir: fixture });
      expect(result.upgraded).toBe(true);
      expect(result.fromVersion).toBe(init.version);
      expect(result.toVersion).toBe(fakeSha);

      // 5) Vendored file refreshed
      const refreshedScript = readFileSync(join(repo, 'scripts', 'setup_context_engine.sh'), 'utf8');
      expect(refreshedScript).toBe(tweakedScript);

      // 6) Version marker bumped
      const installedVersion = readFileSync(join(repo, '.ai', '.context-engine-version'), 'utf8').trim();
      expect(installedVersion).toBe(fakeSha);

      // 7) User-owned content byte-identical
      expect(readFileSync(decisionsPath, 'utf8')).toBe(decisionsContent);
      expect(readFileSync(lastBuildPath, 'utf8')).toBe(lastBuildContent);
      expect(readFileSync(sbDerivedFile, 'utf8')).toBe(sbDerivedContent);
    } finally {
      cleanup(repo);
      cleanup(fixture);
    }
  });

  test('upgrade is no-op when versions already match', async () => {
    const repo = makeDir('stack-upgrade-noop');
    try {
      await stackInit({ repoPath: repo, templatesDir: TEMPLATES_DIR, skipVenv: true });
      const result = await stackUpgrade({ repoPath: repo, templatesDir: TEMPLATES_DIR });
      expect(result.upgraded).toBe(false);
      expect(result.fromVersion).toBe(result.toVersion);
    } finally {
      cleanup(repo);
    }
  });

  test('upgrade on uninitialized repo installs fresh', async () => {
    const repo = makeDir('stack-upgrade-bare');
    try {
      const result = await stackUpgrade({ repoPath: repo, templatesDir: TEMPLATES_DIR });
      expect(result.upgraded).toBe(true);
      expect(result.fromVersion).toBeNull();
      expect(existsSync(join(repo, '.ai', 'index', 'build_index.py'))).toBe(true);
    } finally {
      cleanup(repo);
    }
  });
});
