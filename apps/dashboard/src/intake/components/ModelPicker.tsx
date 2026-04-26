/**
 * Reusable model picker. Reads catalog from the Tauri command
 * `get_copilot_models` (W4). Falls back to a static empty list when not
 * running inside Tauri so the dashboard still renders in dev/web mode.
 *
 * Tier badges colour-code by `ModelTier`:
 *   premium  — purple
 *   standard — blue
 *   fast     — green
 *   auto     — neutral
 */

import { useEffect, useState } from 'react';
import { tauriInvoke, isTauri } from '../tauriBridge.js';
import type { ModelInfo, ModelTier } from '../types.js';

const TIER_COLOR: Record<ModelTier, string> = {
  auto: '#6b7280',
  premium: '#a855f7',
  standard: '#3b82f6',
  fast: '#10b981',
};

const TIER_LABEL: Record<ModelTier, string> = {
  auto: 'Auto',
  premium: 'Premium',
  standard: 'Standard',
  fast: 'Fast',
};

interface Props {
  /** Currently-selected model id, or null to show "default" placeholder. */
  value: string | null;
  /** Default model id resolved from config (intakePipeline.intakeModel etc). */
  defaultId?: string;
  onChange: (id: string | null) => void;
  label: string;
  /** When true, renders a compact pill list. Otherwise vertical menu. */
  compact?: boolean;
}

export function ModelPicker({ value, defaultId, onChange, label, compact }: Props) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isTauri) {
        // TODO(wave-7): expose `/api/copilot/models` HTTP fallback so the
        // model picker works in non-Tauri dev preview.
        setLoading(false);
        return;
      }
      try {
        const list = await tauriInvoke<ModelInfo[]>('get_copilot_models');
        if (!cancelled) setModels(list);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const effective = value ?? defaultId ?? null;

  if (loading) {
    return (
      <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
        Loading models…
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ color: 'var(--error, #ef4444)', fontSize: 12 }}>
        Model catalog error: {error}
      </div>
    );
  }
  if (models.length === 0) {
    return (
      <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
        Model catalog unavailable (open the desktop app to use the
        Copilot CLI bridge).
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
        {label}
      </div>
      <div
        data-testid="model-picker"
        style={{
          display: 'flex',
          flexDirection: compact ? 'row' : 'column',
          flexWrap: 'wrap',
          gap: compact ? 8 : 6,
        }}
      >
        {models.map((m) => {
          const selected = effective === m.id;
          const isDefault = m.id === defaultId;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onChange(m.id === defaultId ? null : m.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: compact ? '6px 10px' : '10px 12px',
                borderRadius: 8,
                border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                background: selected ? 'rgba(99, 102, 241, 0.1)' : 'var(--bg-card)',
                color: 'var(--text)',
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: 12,
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: TIER_COLOR[m.tier],
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                }}
                data-testid={`model-tier-${m.tier}`}
              >
                {TIER_LABEL[m.tier]}
              </span>
              <span style={{ fontWeight: selected ? 600 : 400 }}>
                {m.display_name}
              </span>
              {isDefault && (
                <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                  (default)
                </span>
              )}
              {!compact && (
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                    flex: 1,
                  }}
                >
                  {m.description}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
