/**
 * React-Context store for the Project Workspace screen.
 *
 * Persists per-tab state across navigation in the same session: which
 * project is selected, staged files, model overrides, in-flight run id,
 * branch name, and a rolling transcript buffer.
 *
 * Persistence is in-memory only — closing the dashboard window resets
 * everything. The Rust audit log is the durable source of truth.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import type {
  IntakeLifecycleEvent,
  IntakeStatus,
  StagedFile,
  TranscriptEventPayload,
  WorkspaceTab,
} from './types.js';

interface TranscriptLine {
  ts: number;
  source: 'lifecycle' | 'transcript';
  payload: IntakeLifecycleEvent | TranscriptEventPayload;
}

export interface WorkspaceState {
  activeTab: WorkspaceTab;
  projectSlug: string | null;
  stagedFiles: StagedFile[];
  intakeModel: string | null; // null → use config default
  prCutModel: string | null;
  // Run-in-flight state.
  currentRunId: string | null;
  currentBranch: string | null;
  currentSessionId: string | null;
  /** Most recent reported phase: idle | intake | review | pr-cut | done. */
  phase: 'idle' | 'intake' | 'review' | 'pr-cut' | 'done';
  status: IntakeStatus | null;
  errorMessage: string | null;
  prUrl: string | null;
  transcript: TranscriptLine[];
}

const INITIAL: WorkspaceState = {
  activeTab: 'inbox',
  projectSlug: null,
  stagedFiles: [],
  intakeModel: null,
  prCutModel: null,
  currentRunId: null,
  currentBranch: null,
  currentSessionId: null,
  phase: 'idle',
  status: null,
  errorMessage: null,
  prUrl: null,
  transcript: [],
};

type Action =
  | { type: 'set-tab'; tab: WorkspaceTab }
  | { type: 'set-project'; slug: string | null }
  | { type: 'add-files'; files: StagedFile[] }
  | { type: 'remove-file'; path: string }
  | { type: 'reorder-files'; files: StagedFile[] }
  | { type: 'clear-files' }
  | { type: 'set-intake-model'; model: string | null }
  | { type: 'set-pr-cut-model'; model: string | null }
  | { type: 'run-started'; runId: string; sessionId: string; phase: 'intake' | 'pr-cut' }
  | { type: 'lifecycle-event'; event: IntakeLifecycleEvent }
  | { type: 'transcript-event'; payload: TranscriptEventPayload }
  | {
      type: 'run-finished';
      status: IntakeStatus;
      branch?: string | null;
      errorMessage?: string | null;
      prUrl?: string | null;
    }
  | { type: 'reset-run' };

function reducer(state: WorkspaceState, action: Action): WorkspaceState {
  switch (action.type) {
    case 'set-tab':
      return { ...state, activeTab: action.tab };
    case 'set-project':
      return { ...state, projectSlug: action.slug };
    case 'add-files': {
      const seen = new Set(state.stagedFiles.map((f) => f.path));
      const next = [...state.stagedFiles];
      for (const f of action.files) {
        if (!seen.has(f.path)) {
          next.push(f);
          seen.add(f.path);
        }
      }
      return { ...state, stagedFiles: next };
    }
    case 'remove-file':
      return {
        ...state,
        stagedFiles: state.stagedFiles.filter((f) => f.path !== action.path),
      };
    case 'reorder-files':
      return { ...state, stagedFiles: action.files };
    case 'clear-files':
      return { ...state, stagedFiles: [] };
    case 'set-intake-model':
      return { ...state, intakeModel: action.model };
    case 'set-pr-cut-model':
      return { ...state, prCutModel: action.model };
    case 'run-started':
      return {
        ...state,
        currentRunId: action.runId,
        currentSessionId: action.sessionId,
        phase: action.phase,
        status: 'running',
        errorMessage: null,
        prUrl: action.phase === 'pr-cut' ? state.prUrl : null,
        transcript: [],
      };
    case 'lifecycle-event': {
      const next = {
        ...state,
        transcript: [...state.transcript, { ts: Date.now(), source: 'lifecycle' as const, payload: action.event }],
      };
      if (action.event.kind === 'branch-created') {
        next.currentBranch = action.event.branch;
      } else if (action.event.kind === 'pr-url-captured') {
        next.prUrl = action.event.prUrl;
      } else if (action.event.kind === 'failed') {
        next.errorMessage = action.event.message;
        next.status = 'failed';
      } else if (action.event.kind === 'aborted') {
        next.status = 'cancelled';
      } else if (action.event.kind === 'completed') {
        next.status = action.event.status;
        if (action.event.status === 'success') {
          if (state.phase === 'intake') next.phase = 'review';
          else if (state.phase === 'pr-cut') next.phase = 'done';
        }
      }
      return next;
    }
    case 'transcript-event':
      return {
        ...state,
        transcript: [
          ...state.transcript,
          { ts: Date.now(), source: 'transcript', payload: action.payload },
        ],
      };
    case 'run-finished':
      return {
        ...state,
        status: action.status,
        currentBranch: action.branch ?? state.currentBranch,
        errorMessage: action.errorMessage ?? state.errorMessage,
        prUrl: action.prUrl ?? state.prUrl,
        phase: action.status === 'success' && state.phase === 'intake'
          ? 'review'
          : action.status === 'success' && state.phase === 'pr-cut'
          ? 'done'
          : state.phase,
      };
    case 'reset-run':
      return {
        ...state,
        currentRunId: null,
        currentBranch: null,
        currentSessionId: null,
        phase: 'idle',
        status: null,
        errorMessage: null,
        prUrl: null,
        transcript: [],
      };
    default:
      return state;
  }
}

interface WorkspaceContextValue {
  state: WorkspaceState;
  setTab: (tab: WorkspaceTab) => void;
  setProject: (slug: string | null) => void;
  addFiles: (files: StagedFile[]) => void;
  removeFile: (path: string) => void;
  reorderFiles: (files: StagedFile[]) => void;
  clearFiles: () => void;
  setIntakeModel: (id: string | null) => void;
  setPrCutModel: (id: string | null) => void;
  runStarted: (runId: string, sessionId: string, phase: 'intake' | 'pr-cut') => void;
  pushLifecycleEvent: (ev: IntakeLifecycleEvent) => void;
  pushTranscriptEvent: (ev: TranscriptEventPayload) => void;
  runFinished: (
    status: IntakeStatus,
    extras?: { branch?: string | null; errorMessage?: string | null; prUrl?: string | null },
  ) => void;
  resetRun: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  const setTab = useCallback((tab: WorkspaceTab) => dispatch({ type: 'set-tab', tab }), []);
  const setProject = useCallback((slug: string | null) => dispatch({ type: 'set-project', slug }), []);
  const addFiles = useCallback((files: StagedFile[]) => dispatch({ type: 'add-files', files }), []);
  const removeFile = useCallback((path: string) => dispatch({ type: 'remove-file', path }), []);
  const reorderFiles = useCallback((files: StagedFile[]) => dispatch({ type: 'reorder-files', files }), []);
  const clearFiles = useCallback(() => dispatch({ type: 'clear-files' }), []);
  const setIntakeModel = useCallback((id: string | null) => dispatch({ type: 'set-intake-model', model: id }), []);
  const setPrCutModel = useCallback((id: string | null) => dispatch({ type: 'set-pr-cut-model', model: id }), []);
  const runStarted = useCallback(
    (runId: string, sessionId: string, phase: 'intake' | 'pr-cut') =>
      dispatch({ type: 'run-started', runId, sessionId, phase }),
    [],
  );
  const pushLifecycleEvent = useCallback(
    (ev: IntakeLifecycleEvent) => dispatch({ type: 'lifecycle-event', event: ev }),
    [],
  );
  const pushTranscriptEvent = useCallback(
    (ev: TranscriptEventPayload) => dispatch({ type: 'transcript-event', payload: ev }),
    [],
  );
  const runFinished = useCallback(
    (status: IntakeStatus, extras?: { branch?: string | null; errorMessage?: string | null; prUrl?: string | null }) =>
      dispatch({ type: 'run-finished', status, ...(extras ?? {}) }),
    [],
  );
  const resetRun = useCallback(() => dispatch({ type: 'reset-run' }), []);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      state,
      setTab,
      setProject,
      addFiles,
      removeFile,
      reorderFiles,
      clearFiles,
      setIntakeModel,
      setPrCutModel,
      runStarted,
      pushLifecycleEvent,
      pushTranscriptEvent,
      runFinished,
      resetRun,
    }),
    [
      state,
      setTab,
      setProject,
      addFiles,
      removeFile,
      reorderFiles,
      clearFiles,
      setIntakeModel,
      setPrCutModel,
      runStarted,
      pushLifecycleEvent,
      pushTranscriptEvent,
      runFinished,
      resetRun,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  return ctx;
}

/** Rough token-count estimate: bytes / 4 per the spec heuristic. */
export function estimateTokens(bytes: number): number {
  return Math.max(1, Math.round(bytes / 4));
}
