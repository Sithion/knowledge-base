/**
 * Shared types for the AI Stack POC intake-pipeline UI (Wave 6).
 *
 * These mirror the Rust types in `apps/dashboard/src-tauri/src/intake/`.
 * Kept in lockstep manually — when the Rust side changes, update here.
 */

export type IntakeStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export type ModelTier = 'auto' | 'premium' | 'standard' | 'fast';

export interface ModelInfo {
  id: string;
  display_name: string;
  tier: ModelTier;
  description: string;
}

export interface IntakeResult {
  runId: string;
  branchName: string;
  transcriptPath: string;
  auditPath: string;
  status: IntakeStatus;
  errorMessage: string | null;
}

export interface PrCutResult {
  runId: string;
  prUrl: string | null;
  status: IntakeStatus;
  errorMessage: string | null;
}

export type IntakeLifecycleEvent =
  | { kind: 'lock-acquired'; runId: string }
  | { kind: 'preflight-freshness'; runId: string }
  | { kind: 'branch-created'; runId: string; branch: string; baseSha: string }
  | { kind: 'files-staged'; runId: string; count: number; stagingDir: string }
  | { kind: 'committed'; runId: string; message: string }
  | { kind: 'agent-spawning'; runId: string; model: string; phase: string }
  | { kind: 'agent-exited'; runId: string; exitCode: number | null; aborted: boolean; timedOut: boolean }
  | { kind: 'pr-url-captured'; runId: string; prUrl: string }
  | { kind: 'audit-written'; runId: string; auditPath: string }
  | { kind: 'aborted'; runId: string; reason: string }
  | { kind: 'failed'; runId: string; message: string }
  | { kind: 'completed'; runId: string; status: IntakeStatus };

export type TranscriptEvent =
  | { type: 'tool_call'; tool: string; args: unknown }
  | { type: 'tool_result'; tool: string; ok: boolean; summary?: string }
  | { type: 'text_delta'; content: string }
  | { type: 'final_message'; content: string }
  | { type: 'error'; kind: string; message: string }
  | { type: 'unknown'; raw: string };

export interface TranscriptEventPayload extends Record<string, unknown> {
  sessionId: string;
  phase: string;
  type: TranscriptEvent['type'];
}

export type FirstRunStepStatus = 'pass' | 'fail' | 'skipped' | 'unknown';

export interface FirstRunStep {
  id: string;
  label: string;
  status: FirstRunStepStatus;
  detail: string | null;
  remediation: string | null;
}

export interface FirstRunReport {
  sbCloneReady: boolean;
  copilotPresent: boolean;
  copilotAuthed: boolean;
  ghPresent: boolean;
  blockingSteps: string[];
  steps: FirstRunStep[];
}

export interface IntakeAuditRecord {
  schemaVersion: number;
  runId: string;
  projectSlug: string;
  phase: 'intake_a' | 'pr_cut_b';
  model: string;
  startedAt: string;
  finishedAt: string | null;
  status: IntakeStatus;
  branchName: string | null;
  baseSha: string | null;
  fileCount: number;
  errorMessage: string | null;
  transcriptPath: string | null;
  prUrl: string | null;
  parentRunId: string | null;
}

export interface IntakeLockState {
  managedClonePath: string;
  lockFileExists: boolean;
  held: boolean;
}

export interface ContextEngineRepoStatus {
  repoPath: string;
  hasScaffold: boolean;
  lastBuildAt: string | null;
  decisionsCount: number;
}

export interface SbProject {
  name: string;
  path: string;
  brainExists: boolean;
  decisionRecordCount?: number;
}

/** Workspace tab identifiers. */
export type WorkspaceTab = 'inbox' | 'stage' | 'run' | 'review' | 'pr-cut';

/** Single staged inbox file. */
export interface StagedFile {
  /** Absolute path on disk. */
  path: string;
  /** Display name (basename). */
  name: string;
  /** Size in bytes (estimated when unknown). */
  size: number;
}
