import type { HealthData } from '../../hooks';
import Icon from '../icons/Icon';

export interface SiteHealthPanelProps {
  expanded: boolean;
  onToggle: () => void;
  data: HealthData | null;
  isLoading: boolean;
}

function SiteHealthPanel({ expanded, onToggle, data, isLoading }: SiteHealthPanelProps) {
  return (
    <div className="mb-8 border border-white/5 rounded-sm overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 bg-altivum-navy/30 hover:bg-altivum-navy/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <Icon name="monitoring" className="text-altivum-gold text-lg" aria-hidden="true" />
          <span className="text-sm font-medium text-white uppercase tracking-wider">Site Health</span>
          <span className="text-xs text-altivum-silver">(24h)</span>
        </div>
        <Icon
          name="expand_more"
          className={`text-altivum-silver text-sm transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {expanded && (
        <div className="p-4 bg-altivum-navy/10">
          {isLoading && !data ? (
            <p className="text-altivum-silver text-sm">Loading metrics...</p>
          ) : !data ? (
            <p className="text-altivum-silver text-sm">
              No health data available. Metrics endpoint may not be configured.
            </p>
          ) : (
            <div className="space-y-4">
              {/* Web Vitals (75th percentile) */}
              <div>
                <h4 className="text-xs font-medium text-altivum-gold uppercase tracking-wider mb-2">
                  Core Web Vitals (75th percentile)
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {(['lcp', 'cls', 'inp', 'fcp', 'ttfb'] as const).map((key) => {
                    const vital = data.vitals[key];
                    const label = key.toUpperCase();
                    const value =
                      vital.p75 != null
                        ? key === 'cls'
                          ? vital.p75!.toFixed(3)
                          : `${Math.round(vital.p75!)}ms`
                        : '--';
                    return (
                      <div key={key} className="p-3 bg-white/5 rounded-sm">
                        <div className="text-lg text-white font-semibold">{value}</div>
                        <div className="text-xs text-altivum-silver uppercase tracking-wider">{label}</div>
                        <div className="text-xs text-altivum-silver mt-1">{vital.count} samples</div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* Chat Pipeline */}
              <div>
                <h4 className="text-xs font-medium text-altivum-gold uppercase tracking-wider mb-2">Chat Pipeline</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 bg-white/5 rounded-sm">
                    <div
                      className={`text-lg font-semibold ${data.chat.kbSuccessRate !== null && parseFloat(data.chat.kbSuccessRate) >= 95 ? 'text-green-400' : data.chat.kbSuccessRate !== null ? 'text-amber-400' : 'text-altivum-silver'}`}
                    >
                      {data.chat.kbSuccessRate !== null ? `${data.chat.kbSuccessRate}%` : '--'}
                    </div>
                    <div className="text-xs text-altivum-silver uppercase tracking-wider">KB Success</div>
                  </div>
                  <div className="p-3 bg-white/5 rounded-sm">
                    <div
                      className={`text-lg font-semibold ${data.chat.kbFailures > 0 ? 'text-red-400' : 'text-green-400'}`}
                    >
                      {data.chat.kbFailures}
                    </div>
                    <div className="text-xs text-altivum-silver uppercase tracking-wider">KB Failures</div>
                  </div>
                  <div className="p-3 bg-white/5 rounded-sm">
                    <div className="text-lg text-white font-semibold">{data.chat.guardrailInterventions}</div>
                    <div className="text-xs text-altivum-silver uppercase tracking-wider">Guardrails</div>
                  </div>
                  <div className="p-3 bg-white/5 rounded-sm">
                    <div className="text-lg text-white font-semibold">{data.chat.rateLimitRejections}</div>
                    <div className="text-xs text-altivum-silver uppercase tracking-wider">Rate Limits</div>
                  </div>
                </div>
              </div>
              {/* Performance */}
              {data.performance && (
                <div>
                  <h4 className="text-xs font-medium text-altivum-gold uppercase tracking-wider mb-2">
                    Performance (avg)
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="p-3 bg-white/5 rounded-sm">
                      <div className="text-lg text-white font-semibold">
                        {data.performance.kbRetrievalLatency.average !== null
                          ? `${Math.round(data.performance.kbRetrievalLatency.average)}ms`
                          : '--'}
                      </div>
                      <div className="text-xs text-altivum-silver uppercase tracking-wider">KB Retrieval</div>
                    </div>
                    <div className="p-3 bg-white/5 rounded-sm">
                      <div className="text-lg text-white font-semibold">
                        {data.performance.bedrockInvocationLatency.average !== null
                          ? `${Math.round(data.performance.bedrockInvocationLatency.average)}ms`
                          : '--'}
                      </div>
                      <div className="text-xs text-altivum-silver uppercase tracking-wider">Bedrock Invoke</div>
                    </div>
                    <div className="p-3 bg-white/5 rounded-sm">
                      <div className="text-lg text-white font-semibold">
                        {data.performance.totalRequestLatency.average !== null
                          ? `${Math.round(data.performance.totalRequestLatency.average)}ms`
                          : '--'}
                      </div>
                      <div className="text-xs text-altivum-silver uppercase tracking-wider">Total Request</div>
                    </div>
                  </div>
                </div>
              )}
              {/* Costs */}
              {data.costs && (
                <div>
                  <h4 className="text-xs font-medium text-altivum-gold uppercase tracking-wider mb-2">
                    Token Usage (24h)
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="p-3 bg-white/5 rounded-sm">
                      <div className="text-lg text-white font-semibold">
                        {data.costs.bedrockInputTokens > 0 ? data.costs.bedrockInputTokens.toLocaleString() : '--'}
                      </div>
                      <div className="text-xs text-altivum-silver uppercase tracking-wider">Input Tokens</div>
                    </div>
                    <div className="p-3 bg-white/5 rounded-sm">
                      <div className="text-lg text-white font-semibold">
                        {data.costs.bedrockOutputTokens > 0 ? data.costs.bedrockOutputTokens.toLocaleString() : '--'}
                      </div>
                      <div className="text-xs text-altivum-silver uppercase tracking-wider">Output Tokens</div>
                    </div>
                    <div className="p-3 bg-white/5 rounded-sm">
                      <div
                        className={`text-lg font-semibold ${data.costs.malformedRequests > 0 ? 'text-amber-400' : 'text-green-400'}`}
                      >
                        {data.costs.malformedRequests}
                      </div>
                      <div className="text-xs text-altivum-silver uppercase tracking-wider">Malformed Req</div>
                    </div>
                  </div>
                </div>
              )}
              {/* Security */}
              <div className="flex items-center gap-4">
                <h4 className="text-xs font-medium text-altivum-gold uppercase tracking-wider">Security</h4>
                <span className={`text-sm ${data.security.cspViolations > 0 ? 'text-amber-400' : 'text-green-400'}`}>
                  {data.security.cspViolations} CSP violations
                </span>
                <span className="text-xs text-altivum-silver">
                  Updated {new Date(data.timestamp).toLocaleTimeString()}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SiteHealthPanel;
