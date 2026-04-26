import { test, expect } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import {
  listProjects,
  getProjectBrain,
  getDecisionRecord,
  searchProject,
  _resetFreshnessThrottleForTests,
  type SbToolContext,
} from '../../../../apps/mcp-server/src/tools/secondBrain.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const SCRATCH_ROOT = join(REPO_ROOT, '.test-tmp');

function makeFakeSb(prefix: string): string {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  const root = mkdtempSync(join(SCRATCH_ROOT, `${prefix}-`));
  const projects = join(root, '01-Projects');
  mkdirSync(projects, { recursive: true });

  const alpha = join(projects, 'alpha');
  mkdirSync(join(alpha, '03-decisions'), { recursive: true });
  writeFileSync(join(alpha, 'brain.md'), '# Alpha\n\nThe alpha project ships token rotation.\n');
  writeFileSync(
    join(alpha, '03-decisions', 'DR-001-rotate-tokens.md'),
    '# DR-001 Rotate tokens\n\nWe rotate every 15 minutes.\n',
  );
  writeFileSync(
    join(alpha, '03-decisions', 'DR-002-cache-headers.md'),
    '# DR-002 Cache headers\n\nUse stale-while-revalidate.\n',
  );

  const beta = join(projects, 'beta');
  mkdirSync(beta, { recursive: true });
  writeFileSync(join(beta, 'brain.md'), '# Beta\n\nA beta playground.\n');

  const gamma = join(projects, 'gamma');
  mkdirSync(gamma, { recursive: true });

  mkdirSync(join(projects, '.git'), { recursive: true });

  return root;
}

function cleanup(dir: string) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

const on = (path: string): SbToolContext => ({ secondBrainPath: path, enableSbOrchestration: true });
const off = (path: string): SbToolContext => ({ secondBrainPath: path, enableSbOrchestration: false });

test.beforeEach(() => {
  _resetFreshnessThrottleForTests();
});

test.describe('@e2e secondBrain.* read-only tools', () => {
  test('listProjects returns sorted projects with brain + DR counts', () => {
    const sb = makeFakeSb('sb-list');
    try {
      const result = listProjects(on(sb));
      if ('disabled' in result || 'error' in result) throw new Error('unexpected');
      expect(result.projects.map((p) => p.name)).toEqual(['alpha', 'beta', 'gamma']);
      expect(result.projects[0].brainExists).toBe(true);
      expect(result.projects[0].decisionRecordCount).toBe(2);
      expect(result.projects[1].brainExists).toBe(true);
      expect(result.projects[1].decisionRecordCount).toBe(0);
      expect(result.projects[2].brainExists).toBe(false);
      expect(result.projects[2].decisionRecordCount).toBe(0);
    } finally { cleanup(sb); }
  });

  test('getProjectBrain happy path + missing project', () => {
    const sb = makeFakeSb('sb-brain');
    try {
      const ok = getProjectBrain('alpha', on(sb));
      if ('disabled' in ok || 'error' in ok) throw new Error('unexpected');
      expect(ok.brainExists).toBe(true);
      if (ok.brainExists) expect(ok.content).toContain('alpha project');

      const missing = getProjectBrain('gamma', on(sb));
      if ('disabled' in missing || 'error' in missing) throw new Error('unexpected');
      expect(missing.brainExists).toBe(false);
    } finally { cleanup(sb); }
  });

  test('getDecisionRecord by id, filename, relative path; rejects traversal', () => {
    const sb = makeFakeSb('sb-dr');
    try {
      const byId = getDecisionRecord('alpha', 'DR-001-rotate-tokens', on(sb));
      expect('content' in byId && byId.content.includes('Rotate tokens')).toBe(true);

      const byFile = getDecisionRecord('alpha', 'DR-002-cache-headers.md', on(sb));
      expect('content' in byFile && byFile.content.includes('stale-while-revalidate')).toBe(true);

      const byPath = getDecisionRecord('alpha', '03-decisions/DR-001-rotate-tokens.md', on(sb));
      expect('content' in byPath && byPath.content.includes('15 minutes')).toBe(true);

      const traversal = getDecisionRecord('alpha', '../../../etc/passwd', on(sb));
      expect('error' in traversal && traversal.error).toBe('invalid_path');

      const notFound = getDecisionRecord('alpha', 'DR-999-nope', on(sb));
      expect('error' in notFound && notFound.error).toBe('not_found');
    } finally { cleanup(sb); }
  });

  test('searchProject finds substring with line snippets', () => {
    const sb = makeFakeSb('sb-search');
    try {
      const result = searchProject('alpha', 'rotation', on(sb));
      if ('disabled' in result || 'error' in result) throw new Error('unexpected');
      expect(result.matches.length).toBeGreaterThan(0);
      expect(result.matches[0].snippet.toLowerCase()).toContain('rotation');
    } finally { cleanup(sb); }
  });

  test('all four tools return {disabled} when gate is off', () => {
    const sb = makeFakeSb('sb-disabled');
    try {
      const c = off(sb);
      expect('disabled' in listProjects(c)).toBe(true);
      expect('disabled' in getProjectBrain('alpha', c)).toBe(true);
      expect('disabled' in getDecisionRecord('alpha', 'DR-001-rotate-tokens', c)).toBe(true);
      expect('disabled' in searchProject('alpha', 'x', c)).toBe(true);
    } finally { cleanup(sb); }
  });

  test('all four tools return second_brain_not_configured when path missing', () => {
    const c: SbToolContext = { enableSbOrchestration: true, secondBrainPath: undefined };
    expect((listProjects(c) as any).error).toBe('second_brain_not_configured');
    expect((getProjectBrain('alpha', c) as any).error).toBe('second_brain_not_configured');
    expect((getDecisionRecord('alpha', 'DR-001', c) as any).error).toBe('second_brain_not_configured');
    expect((searchProject('alpha', 'x', c) as any).error).toBe('second_brain_not_configured');
  });

  test('rejects unsafe project names', () => {
    const sb = makeFakeSb('sb-unsafe');
    try {
      const bad = getProjectBrain('../alpha', on(sb));
      expect('error' in bad && bad.error).toBe('invalid_path');
      const dot = getProjectBrain('.git', on(sb));
      expect('error' in dot && dot.error).toBe('invalid_path');
    } finally { cleanup(sb); }
  });
});
