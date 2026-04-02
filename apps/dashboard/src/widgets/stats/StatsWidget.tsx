import { useEffect, useState, useCallback } from 'react';
import { api } from '../../api/client.js';

interface Metrics {
  activity: { total: number };
  operations: {
    readsLastHour: number;
    readsLastDay: number;
    writesLastHour: number;
    writesLastDay: number;
  };
}

const REFRESH_INTERVAL = 10_000;

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '6px 0',
      borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
    }}>
      <span style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.6)' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: '#a5b4fc' }}>{value}</span>
    </div>
  );
}

export function StatsWidget() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const data = await api.getMetrics();
      setMetrics(data);
    } catch {
      // silently retry on next interval
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleClose = () => {
    window.close();
  };

  return (
    <div className="widget-shell">
      {/* Drag region */}
      <div className="widget-drag-region" data-tauri-drag-region>
        <span className="widget-title" data-tauri-drag-region>CogniStore</span>
        <button className="widget-close" onClick={handleClose} title="Close">
          ×
        </button>
      </div>

      {/* Content */}
      <div className="widget-content">
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}>
            <div style={{
              width: 20,
              height: 20,
              border: '2px solid rgba(255,255,255,0.1)',
              borderTopColor: '#6366f1',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
          </div>
        ) : (
          <>
            {/* Total */}
            <div style={{
              textAlign: 'center',
              padding: '8px 0 12px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
              marginBottom: 8,
            }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#6366f1' }}>
                {metrics?.activity.total ?? 0}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.4)', textTransform: 'uppercase', letterSpacing: 1 }}>
                Total Knowledge
              </div>
            </div>

            {/* Operation rows */}
            <StatRow label="Consulted (1h)" value={metrics?.operations.readsLastHour ?? 0} />
            <StatRow label="Consulted (24h)" value={metrics?.operations.readsLastDay ?? 0} />
            <StatRow label="Written (1h)" value={metrics?.operations.writesLastHour ?? 0} />
            <StatRow label="Written (24h)" value={metrics?.operations.writesLastDay ?? 0} />
          </>
        )}
      </div>
    </div>
  );
}
