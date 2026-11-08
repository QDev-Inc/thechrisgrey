import { useState, useEffect, useCallback } from 'react';
import { joinEndpoint } from '../utils/endpoint';

const METRICS_ENDPOINT = import.meta.env.VITE_METRICS_ENDPOINT;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export interface VitalStat {
  average: number | null;
  p75?: number | null;
  count: number;
}

export interface HealthData {
  vitals: {
    lcp: VitalStat;
    cls: VitalStat;
    inp: VitalStat;
    fcp: VitalStat;
    ttfb: VitalStat;
  };
  chat: {
    kbSuccessRate: string | null;
    kbFailures: number;
    kbSuccesses: number;
    guardrailInterventions: number;
    rateLimitRejections: number;
  };
  performance?: {
    kbRetrievalLatency: VitalStat;
    bedrockInvocationLatency: VitalStat;
    totalRequestLatency: VitalStat;
  };
  costs?: {
    bedrockInputTokens: number;
    bedrockOutputTokens: number;
    malformedRequests: number;
  };
  security: {
    cspViolations: number;
  };
  periodHours: number;
  timestamp: string;
}

interface SiteHealthState {
  data: HealthData | null;
  isLoading: boolean;
  error: string | null;
}

export function useSiteHealth(getAccessToken: () => Promise<string | null>, enabled = true) {
  const [state, setState] = useState<SiteHealthState>({
    data: null,
    isLoading: false,
    error: null,
  });

  const fetchHealth = useCallback(async () => {
    if (!METRICS_ENDPOINT) {
      setState({ data: null, isLoading: false, error: 'Metrics endpoint not configured' });
      return;
    }

    const token = await getAccessToken();
    if (!token) return;

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const response = await fetch(joinEndpoint(METRICS_ENDPOINT, '/health'), {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data: HealthData = await response.json();
      setState({ data, isLoading: false, error: null });
    } catch {
      setState((prev) => ({ ...prev, isLoading: false, error: 'Failed to load health data' }));
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (!enabled) return;
    // Canonical fetch-on-mount + interval-refresh pattern. fetchHealth's
    // internal setState transitions (isLoading → data | error) are the
    // hook's contract; adopting react-hooks/set-state-in-effect's preferred
    // shape would require migrating to TanStack Query / SWR (a data-library
    // dep this project intentionally doesn't take). Suppress with rationale.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchHealth();
    const interval = setInterval(fetchHealth, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchHealth, enabled]);

  return { ...state, refresh: fetchHealth };
}
