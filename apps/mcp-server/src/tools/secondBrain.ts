/**
 * secondBrain.* MCP tools — read-only Second Brain context surface.
 *
 * Implements section 2 of `openspec/changes/ai-stack-poc-cognistore/tasks.md`
 * with the simplest correct shape from the wave-3 brief: four read-only tools
 * (`listProjects`, `getProjectBrain`, `getDecisionRecord`, `searchProject`)
 * that operate against a Second Brain checkout under `01-Projects/`.
 *
 * Heavier write-side tools (`runPipeline`, `promoteDecision`,
 * `lookupTraceability`) from the original spec are deferred to a later wave —
 * they require the SB repo to ship `_tools/ingest`, `_tools/promote`, and a
 * built `_graph.json` which are not yet present.
 *
 * All tools fail-soft when:
 *  - `enableSbOrchestration` is `false` → `{ disabled: true, reason }`.
 *  - `secondBrainPath` is unset / missing → `{ error: 'second_brain_not_configured', ... }`.
 *
 * Path validation: every project / DR path is normalized and required to stay
 * inside `${secondBrainPath}/01-Projects/`. No traversal escape.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep, normalize } from 'node:path';
import { homedir } from 'node:os';

// ─── Types ────────────────────────────────────────────────────────────────

export interface SbToolContext {
  /** Resolved path to the Second Brain checkout. May not exist on disk. */
  secondBrainPath?: string;
  /** Master gate. When `false`, every tool no-ops with `{ disabled: true }`. */
  enableSbOrchestration: boolean;
}

export interface SbDisabled {
  disabled: true;
  reason: string;
}

export interface SbNotConfigured {
  error: 'second_brain_not_configured';
  details: string;
}

export interface SbInvalidPath {
  error: 'invalid_path';
  details: string;
}

export interface SbProjectSummary {
  name: string;
  path: string;
  brainExists: boolean;
  decisionRecordCount: number;
}

export type ListProjectsResult =
  | SbDisabled
  | SbNotConfigured
  | { projects: SbProjectSummary[]; warning?: string };

export type GetProjectBrainResult =
  | SbDisabled
  | SbNotConfigured
  | SbInvalidPath
  | { project: string; brainExists: false }
  | { project: string; brainExists: true; path: string; content: string };

export type GetDecisionRecordResult =
  | SbDisabled
  | SbNotConfigured
  | SbInvalidPath
  | { error: 'not_found'; details: string }
  | { project: string; id: string; path: string; content: string };

export type SearchProjectResult =
  | SbDisabled
  | SbNotConfigured
  | SbInvalidPath
  | {
      project: string;
      query: string;
      matches: Array<{
        path: string;
        line: number;
        snippet: string;
      }>;
      truncated: boolean;
    };

// ─── Helpers ──────────────────────────────────────────────────────────────

const PROJECTS_SUBDIR = '01-Projects';
const DECISIONS_SUBDIR = '03-decisions';
const BRAIN_FILENAME = 'brain.md';

/** Resolve `~` in user-supplied paths. */
export function expandHome(p: string | undefined | null): string | undefined {
  if (!p) return undefined;
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~' + sep)) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

/**
 * Normalize and assert a path is contained inside `root`.
 * Returns the resolved absolute path on success; throws an Error otherwise.
 */
export function assertInside(root: string, candidate: string): string {
  const r = resolve(root);
  const c = resolve(candidate);
  // Use sep guard so `/foo/bar` is not considered inside `/foo/ba`.
  if (c !== r && !c.startsWith(r + sep)) {
    throw new Error(`path escapes root: ${candidate}`);
  }
  return c;
}

/** Validate a project name does not contain path separators or `..`. */
export function isSafeProjectName(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  if (name === '.' || name === '..') return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name.startsWith('.')) return false;
  // No null bytes / leading/trailing whitespace
  if (name !== name.trim()) return false;
  if (name.includes('\0')) return false;
  return true;
}

function projectsRoot(sbPath: string): string {
  return join(sbPath, PROJECTS_SUBDIR);
}

function projectDir(sbPath: string, name: string): string {
  return join(projectsRoot(sbPath), name);
}

function disabled(reason = 'enableSbOrchestration is false'): SbDisabled {
  return { disabled: true, reason };
}

function notConfigured(details: string): SbNotConfigured {
  return { error: 'second_brain_not_configured', details };
}

function checkContext(ctx: SbToolContext): SbDisabled | SbNotConfigured | { sbPath: string } {
  if (!ctx.enableSbOrchestration) return disabled();
  const sbPath = expandHome(ctx.secondBrainPath);
  if (!sbPath) {
    return notConfigured('aiStack.secondBrainPath is not configured');
  }
  if (!existsSync(sbPath)) {
    return notConfigured(`secondBrainPath does not exist on disk: ${sbPath}`);
  }
  if (!existsSync(projectsRoot(sbPath))) {
    return notConfigured(
      `secondBrainPath is missing ${PROJECTS_SUBDIR}/: ${sbPath}`
    );
  }
  return { sbPath };
}

function countDecisionRecords(projectPath: string): number {
  const drDir = join(projectPath, DECISIONS_SUBDIR);
  if (!existsSync(drDir)) return 0;
  try {
    return readdirSync(drDir).filter((f) => f.endsWith('.md') && !f.startsWith('.')).length;
  } catch {
    return 0;
  }
}

// ─── Freshness coordination (before-use) ──────────────────────────────────

/**
 * Track when we last asked the freshness service to run. The Rust-side
 * `SbFreshnessService` is the source of truth for actual freshness; this
 * is just a TS-side cache so we don't ping it on every MCP call.
 *
 * Wave 3: observational only. We never auto-pull. The dashboard / user
 * triggers `sb_freshness_pull_and_import` explicitly.
 */
const FRESHNESS_TTL_MS = 5 * 60 * 1000; // 5 minutes — see brief
let lastFreshnessCheckAt = 0;

export interface FreshnessHook {
  /** Fire-and-forget signal to whatever subscribes (e.g. a Tauri command). */
  notify(reason: string): void;
}

let freshnessHook: FreshnessHook | null = null;

export function setFreshnessHook(hook: FreshnessHook | null): void {
  freshnessHook = hook;
}

/**
 * Opportunistic before-use freshness check. Caps to one notification per
 * `FRESHNESS_TTL_MS`. Caller does NOT await any sync — this is purely a
 * "please go check" signal so the dashboard can update its banner.
 */
export function freshnessCheckBeforeUse(reason: string, ctx: SbToolContext): void {
  if (!ctx.enableSbOrchestration) return;
  const now = Date.now();
  if (now - lastFreshnessCheckAt < FRESHNESS_TTL_MS) return;
  lastFreshnessCheckAt = now;
  if (freshnessHook) {
    try {
      freshnessHook.notify(reason);
    } catch {
      // intentionally swallow — observational only
    }
  }
}

/** Test-only: reset the throttle so unit tests can call repeatedly. */
export function _resetFreshnessThrottleForTests(): void {
  lastFreshnessCheckAt = 0;
}

// ─── Tool: secondBrain.listProjects ───────────────────────────────────────

export function listProjects(ctx: SbToolContext): ListProjectsResult {
  const ck = checkContext(ctx);
  if ('disabled' in ck || 'error' in ck) return ck;
  freshnessCheckBeforeUse('secondBrain.listProjects', ctx);

  const root = projectsRoot(ck.sbPath);
  let entries: string[];
  try {
    entries = readdirSync(root).filter((n) => isSafeProjectName(n));
  } catch (e) {
    return {
      error: 'second_brain_not_configured',
      details: `failed to read ${root}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const projects: SbProjectSummary[] = [];
  for (const name of entries) {
    const p = projectDir(ck.sbPath, name);
    let isDir = false;
    try {
      isDir = statSync(p).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;

    const brainPath = join(p, BRAIN_FILENAME);
    projects.push({
      name,
      path: p,
      brainExists: existsSync(brainPath),
      decisionRecordCount: countDecisionRecords(p),
    });
  }
  projects.sort((a, b) => a.name.localeCompare(b.name));

  return { projects };
}

// ─── Tool: secondBrain.getProjectBrain ────────────────────────────────────

export function getProjectBrain(
  project: string,
  ctx: SbToolContext
): GetProjectBrainResult {
  const ck = checkContext(ctx);
  if ('disabled' in ck || 'error' in ck) return ck;
  if (!isSafeProjectName(project)) {
    return { error: 'invalid_path', details: `unsafe project name: ${project}` };
  }
  freshnessCheckBeforeUse('secondBrain.getProjectBrain', ctx);

  let dir: string;
  try {
    dir = assertInside(projectsRoot(ck.sbPath), projectDir(ck.sbPath, project));
  } catch (e) {
    return {
      error: 'invalid_path',
      details: e instanceof Error ? e.message : String(e),
    };
  }
  if (!existsSync(dir)) {
    return { project, brainExists: false };
  }
  const brainPath = join(dir, BRAIN_FILENAME);
  if (!existsSync(brainPath)) {
    return { project, brainExists: false };
  }
  let content: string;
  try {
    content = readFileSync(brainPath, 'utf8');
  } catch (e) {
    return {
      error: 'invalid_path',
      details: `failed to read brain.md: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  return { project, brainExists: true, path: brainPath, content };
}

// ─── Tool: secondBrain.getDecisionRecord ──────────────────────────────────

/**
 * `idOrPath`:
 *  - Bare DR id (e.g. `DR-007-front-end-scope-guard`) → looks up
 *    `${project}/03-decisions/DR-007-front-end-scope-guard.md`.
 *  - With `.md` suffix → used as-is inside the project's `03-decisions/`.
 *  - Relative path containing `03-decisions/` → resolved inside project.
 *
 * Path traversal is rejected: result must live under the project dir.
 */
export function getDecisionRecord(
  project: string,
  idOrPath: string,
  ctx: SbToolContext
): GetDecisionRecordResult {
  const ck = checkContext(ctx);
  if ('disabled' in ck || 'error' in ck) return ck;
  if (!isSafeProjectName(project)) {
    return { error: 'invalid_path', details: `unsafe project name: ${project}` };
  }
  if (!idOrPath || idOrPath.includes('\0') || idOrPath.includes('..')) {
    return { error: 'invalid_path', details: `unsafe DR identifier: ${idOrPath}` };
  }
  freshnessCheckBeforeUse('secondBrain.getDecisionRecord', ctx);

  const projDir = projectDir(ck.sbPath, project);
  if (!existsSync(projDir)) {
    return { error: 'not_found', details: `project does not exist: ${project}` };
  }

  const drDir = join(projDir, DECISIONS_SUBDIR);
  let candidate: string;
  if (idOrPath.endsWith('.md')) {
    candidate = idOrPath.includes(sep) || idOrPath.includes('/')
      ? join(projDir, idOrPath)
      : join(drDir, idOrPath);
  } else {
    candidate = join(drDir, `${idOrPath}.md`);
  }

  let resolved: string;
  try {
    resolved = assertInside(projDir, normalize(candidate));
  } catch (e) {
    return {
      error: 'invalid_path',
      details: e instanceof Error ? e.message : String(e),
    };
  }
  if (!existsSync(resolved)) {
    return { error: 'not_found', details: `DR not found: ${resolved}` };
  }
  let content: string;
  try {
    content = readFileSync(resolved, 'utf8');
  } catch (e) {
    return {
      error: 'invalid_path',
      details: `failed to read DR: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  return { project, id: idOrPath, path: resolved, content };
}

// ─── Tool: secondBrain.searchProject ──────────────────────────────────────

const SEARCH_MAX_FILES = 500;
const SEARCH_MAX_MATCHES = 50;
const SEARCH_FILE_MAX_BYTES = 1_000_000; // skip huge files
const SEARCH_EXTS = new Set(['.md', '.markdown', '.txt']);

function walk(dir: string, out: string[], cap: number): void {
  if (out.length >= cap) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (out.length >= cap) return;
    if (name.startsWith('.')) continue;
    const p = join(dir, name);
    let s;
    try {
      s = statSync(p);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      walk(p, out, cap);
    } else if (s.isFile()) {
      const dot = name.lastIndexOf('.');
      const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
      if (SEARCH_EXTS.has(ext) && s.size <= SEARCH_FILE_MAX_BYTES) {
        out.push(p);
      }
    }
  }
}

export function searchProject(
  project: string,
  query: string,
  ctx: SbToolContext
): SearchProjectResult {
  const ck = checkContext(ctx);
  if ('disabled' in ck || 'error' in ck) return ck;
  if (!isSafeProjectName(project)) {
    return { error: 'invalid_path', details: `unsafe project name: ${project}` };
  }
  freshnessCheckBeforeUse('secondBrain.searchProject', ctx);

  const projDir = projectDir(ck.sbPath, project);
  if (!existsSync(projDir)) {
    return { project, query, matches: [], truncated: false };
  }
  const needle = (query || '').trim();
  if (!needle) {
    return { project, query, matches: [], truncated: false };
  }
  const needleLower = needle.toLowerCase();

  const files: string[] = [];
  walk(projDir, files, SEARCH_MAX_FILES);

  const matches: Array<{ path: string; line: number; snippet: string }> = [];
  let truncated = files.length >= SEARCH_MAX_FILES;
  for (const f of files) {
    if (matches.length >= SEARCH_MAX_MATCHES) {
      truncated = true;
      break;
    }
    let body: string;
    try {
      body = readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    const lines = body.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= SEARCH_MAX_MATCHES) {
        truncated = true;
        break;
      }
      const line = lines[i];
      if (line.toLowerCase().includes(needleLower)) {
        const snippet = line.length > 240 ? line.slice(0, 240) + '…' : line;
        matches.push({ path: f, line: i + 1, snippet });
      }
    }
  }

  return { project, query, matches, truncated };
}
