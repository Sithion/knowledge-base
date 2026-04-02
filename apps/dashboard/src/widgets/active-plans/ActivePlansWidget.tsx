import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../../api/client.js';
import { useWidgetClose } from '../shared/useWidgetClose.js';

interface Plan {
  id: string;
  title: string;
  status: string;
  taskCount?: number;
  completedTasks?: number;
}

const REFRESH_INTERVAL = 10_000;
const ROW_HEIGHT = 44; // px per plan row
const HEADER_HEIGHT = 32; // drag region
const PADDING_HEIGHT = 24; // content padding top+bottom
const EMPTY_HEIGHT = 80; // empty state height
const MIN_WIDTH = 320;

function getMaxVisible(): number {
  const params = new URLSearchParams(window.location.search);
  const val = Number(params.get('max'));
  return val > 0 ? val : 5;
}

function PlanRow({ plan, onDelete }: { plan: Plan; onDelete: (id: string) => void }) {
  const [hover, setHover] = useState(false);
  const total = plan.taskCount ?? 0;
  const completed = plan.completedTasks ?? 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const handleClick = () => {
    import('@tauri-apps/api/event').then(({ emit }) => {
      emit('open-plan', plan.id);
    }).catch(() => {});
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(plan.id);
  };

  return (
    <div
      onClick={handleClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '8px 0',
        borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
        cursor: 'pointer',
        background: hover ? 'rgba(255,255,255,0.03)' : 'transparent',
        transition: 'background 0.15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
        <div style={{
          fontSize: 12, fontWeight: 500, color: '#e2e8f0', flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {plan.title}
        </div>
        {hover && (
          <button
            onClick={handleDelete}
            title="Delete plan"
            style={{
              width: 18, height: 18, borderRadius: '50%', border: 'none',
              background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444',
              cursor: 'pointer', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 10, lineHeight: 1,
              padding: 0, flexShrink: 0, transition: 'background 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239, 68, 68, 0.4)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239, 68, 68, 0.2)'; }}
          >
            ×
          </button>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          flex: 1, height: 3, borderRadius: 2,
          backgroundColor: 'rgba(255, 255, 255, 0.08)', overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', width: `${pct}%`, borderRadius: 2,
            backgroundColor: pct === 100 ? '#22c55e' : '#3b82f6',
            transition: 'width 0.3s ease',
          }} />
        </div>
        <span style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.4)', flexShrink: 0 }}>
          {completed}/{total}
        </span>
      </div>
    </div>
  );
}

export function ActivePlansWidget() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const handleClose = useWidgetClose();
  const maxVisible = useRef(getMaxVisible()).current;
  const resized = useRef(false);

  const fetchData = useCallback(async () => {
    try {
      const data = await api.listPlans(20, 'active');
      setPlans(data);
    } catch {
      // silently retry on next interval
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDelete = useCallback(async (planId: string) => {
    try {
      await api.deletePlan(planId);
      setPlans(prev => prev.filter(p => p.id !== planId));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Resize window dynamically based on plan count
  useEffect(() => {
    if (loading) return;
    const visibleCount = Math.min(plans.length, maxVisible);
    const contentHeight = plans.length === 0
      ? EMPTY_HEIGHT
      : visibleCount * ROW_HEIGHT;
    const totalHeight = HEADER_HEIGHT + PADDING_HEIGHT + contentHeight;

    import('@tauri-apps/api/window').then(({ getCurrentWindow, LogicalSize }) => {
      getCurrentWindow().setSize(new LogicalSize(MIN_WIDTH, totalHeight));
    }).catch(() => {});
    resized.current = true;
  }, [plans.length, loading, maxVisible]);

  const showScroll = plans.length > maxVisible;
  const maxContentHeight = maxVisible * ROW_HEIGHT;

  return (
    <div className="widget-shell">
      <div className="widget-drag-region" data-tauri-drag-region>
        <span className="widget-title" data-tauri-drag-region>Active Plans</span>
        <button className="widget-close" onClick={handleClose} title="Close">×</button>
      </div>

      <div className="widget-content" style={{
        overflowY: showScroll ? 'auto' : 'hidden',
        maxHeight: showScroll ? maxContentHeight : undefined,
      }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 20 }}>
            <div style={{
              width: 20, height: 20,
              border: '2px solid rgba(255,255,255,0.1)',
              borderTopColor: '#6366f1',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
          </div>
        ) : plans.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '20px 0',
            color: 'rgba(255, 255, 255, 0.3)', fontSize: 12,
          }}>
            No active plans
          </div>
        ) : (
          plans.map(plan => <PlanRow key={plan.id} plan={plan} onDelete={handleDelete} />)
        )}
      </div>
    </div>
  );
}
