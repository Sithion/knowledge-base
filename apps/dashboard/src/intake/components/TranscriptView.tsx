/**
 * Live transcript view: renders both `intake:event` lifecycle events
 * (high-level phase progress) and `agent-transcript-event` payloads
 * (token-stream / tool calls). Auto-scrolls to bottom; collapsible
 * "Older entries" header for big histories.
 */

import { useEffect, useRef } from 'react';
import type { IntakeLifecycleEvent, TranscriptEventPayload } from '../types.js';

interface Line {
  ts: number;
  source: 'lifecycle' | 'transcript';
  payload: IntakeLifecycleEvent | TranscriptEventPayload;
}

interface Props {
  lines: Line[];
  /** When true, render in a fixed-height pane with scroll. */
  bounded?: boolean;
}

function lineColor(line: Line): string {
  if (line.source === 'lifecycle') {
    const k = (line.payload as IntakeLifecycleEvent).kind;
    if (k === 'failed' || k === 'aborted') return 'var(--error, #ef4444)';
    if (k === 'completed') return 'var(--success, #10b981)';
    if (k === 'pr-url-captured') return 'var(--accent)';
    return 'var(--text-secondary)';
  }
  const t = (line.payload as TranscriptEventPayload).type;
  if (t === 'error') return 'var(--error, #ef4444)';
  if (t === 'final_message') return 'var(--success, #10b981)';
  if (t === 'tool_call' || t === 'tool_result') return 'var(--accent)';
  return 'var(--text)';
}

function formatPayload(line: Line): string {
  if (line.source === 'lifecycle') {
    const ev = line.payload as IntakeLifecycleEvent;
    const tag = `[${ev.kind}]`;
    switch (ev.kind) {
      case 'branch-created':
        return `${tag} ${ev.branch} (base ${ev.baseSha.slice(0, 8)})`;
      case 'agent-spawning':
        return `${tag} model=${ev.model} phase=${ev.phase}`;
      case 'agent-exited':
        return `${tag} exit=${ev.exitCode ?? '?'}${ev.aborted ? ' aborted' : ''}${ev.timedOut ? ' timed-out' : ''}`;
      case 'pr-url-captured':
        return `${tag} ${ev.prUrl}`;
      case 'failed':
        return `${tag} ${ev.message}`;
      case 'aborted':
        return `${tag} ${ev.reason}`;
      case 'completed':
        return `${tag} ${ev.status}`;
      case 'files-staged':
        return `${tag} ${ev.count} file(s)`;
      case 'committed':
        return `${tag} ${ev.message}`;
      case 'audit-written':
        return `${tag} ${ev.auditPath}`;
      default:
        return tag;
    }
  }
  const ev = line.payload as TranscriptEventPayload;
  const tag = `[agent:${ev.type}]`;
  switch (ev.type) {
    case 'tool_call':
      return `${tag} ${(ev as any).tool}(${JSON.stringify((ev as any).args).slice(0, 80)})`;
    case 'tool_result': {
      const ok = (ev as any).ok ? '✓' : '✗';
      return `${tag} ${ok} ${(ev as any).tool} ${(ev as any).summary ?? ''}`;
    }
    case 'text_delta':
      return (ev as any).content;
    case 'final_message':
      return `${tag} ${(ev as any).content}`;
    case 'error':
      return `${tag} ${(ev as any).kind} — ${(ev as any).message}`;
    case 'unknown':
      return `${tag} ${(ev as any).raw?.slice(0, 200) ?? ''}`;
    default:
      return tag;
  }
}

export function TranscriptView({ lines, bounded = true }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll to bottom on new line.
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [lines.length]);

  if (lines.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          textAlign: 'center',
          color: 'var(--text-secondary)',
          fontSize: 12,
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--bg-card)',
        }}
      >
        Transcript will appear here once the run starts.
      </div>
    );
  }

  return (
    <div
      ref={ref}
      data-testid="transcript-view"
      style={{
        padding: 12,
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'var(--bg-input, #0b0d14)',
        fontFamily: 'monospace',
        fontSize: 11,
        maxHeight: bounded ? 360 : undefined,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      {lines.map((line, i) => (
        <div key={i} style={{ color: lineColor(line) }}>
          <span style={{ opacity: 0.5 }}>
            {new Date(line.ts).toLocaleTimeString()}
          </span>{' '}
          {formatPayload(line)}
        </div>
      ))}
    </div>
  );
}
