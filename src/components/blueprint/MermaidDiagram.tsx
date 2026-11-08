import { useEffect, useRef, useState } from 'react';
import { typography } from '../../utils/typography';
import Icon from '../icons/Icon';

interface MermaidDiagramProps {
  source: string;
}

let renderIdCounter = 0;

export function MermaidDiagram({ source }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Single state slot for the async render result so the source-change reset
  // is one setState call (not two), removing the cascading-render anti-pattern
  // that react-hooks/set-state-in-effect flags.
  const [render, setRender] = useState<{ svg: string | null; error: string | null }>({ svg: null, error: null });
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Intentional cascading render: when `source` changes, immediately reset
    // to the "rendering" state so the UI shows a spinner instead of the old
    // diagram while the new one builds. A consolidated single state slot
    // makes this one setState call (was two before this PR).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRender({ svg: null, error: null });

    (async () => {
      try {
        const [{ default: mermaid }, { default: DOMPurify }] = await Promise.all([
          import('mermaid'),
          import('dompurify'),
        ]);
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          securityLevel: 'strict',
          htmlLabels: false,
          fontFamily: typography.bodyText.fontFamily,
          themeVariables: {
            primaryColor: '#1A2332',
            primaryTextColor: '#FFFFFF',
            primaryBorderColor: '#C5A572',
            lineColor: '#C5A572',
            secondaryColor: '#2E4A6B',
            tertiaryColor: '#0A0F1C',
            background: '#0A0F1C',
            mainBkg: '#1A2332',
            nodeBorder: '#C5A572',
          },
        });
        const id = `blueprint-mermaid-${renderIdCounter++}`;
        const { svg: rendered } = await mermaid.render(id, source);
        if (cancelled) return;
        // Defense in depth: DOMPurify strips scripts, event handlers, and
        // foreignObject tricks even though mermaid's strict mode already
        // sanitizes. Blueprint output is LLM-generated, so double-check.
        const sanitized = DOMPurify.sanitize(rendered, {
          USE_PROFILES: { svg: true, svgFilters: true },
        });
        setRender({ svg: sanitized, error: null });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to render the diagram.';
        setRender({ svg: null, error: message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source]);

  const { svg, error } = render;

  return (
    <div className="rounded-lg bg-altivum-navy/60 border border-white/5 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-altivum-dark/50 border-b border-white/5">
        <span className="text-altivum-silver" style={typography.smallText}>
          Architecture diagram
        </span>
        <button
          type="button"
          onClick={() => setShowSource((v) => !v)}
          className="inline-flex items-center text-altivum-silver hover:text-altivum-gold transition-colors"
          style={typography.smallText}
          aria-expanded={showSource}
        >
          <Icon name={showSource ? 'image' : 'code'} className="text-sm mr-1" aria-hidden="true" />
          {showSource ? 'View diagram' : 'View source'}
        </button>
      </div>

      {showSource ? (
        <pre className="p-4 text-altivum-silver overflow-x-auto" style={typography.smallText}>
          {source}
        </pre>
      ) : (
        <div ref={containerRef} className="p-4 overflow-x-auto" aria-live="polite">
          {error ? (
            <div className="text-altivum-silver/80" style={typography.smallText}>
              <span className="text-rose-300">Diagram render failed.</span> You can still read the Mermaid source below.
              <pre className="mt-2 text-altivum-silver overflow-x-auto">{source}</pre>
            </div>
          ) : svg === null ? (
            <div
              className="flex items-center justify-center h-32 text-altivum-silver/70"
              style={typography.smallText}
              role="status"
              aria-label="Rendering diagram"
            >
              <span
                className="w-5 h-5 mr-2 border-2 border-altivum-gold/30 border-t-altivum-gold rounded-full animate-spin"
                aria-hidden="true"
              />
              Rendering diagram…
            </div>
          ) : (
            // Sanitized via DOMPurify above + mermaid strict mode; no user-typed
            // HTML reaches this path — only rendered-then-sanitized SVG.
            <div className="mermaid-rendered flex justify-center" dangerouslySetInnerHTML={{ __html: svg }} />
          )}
        </div>
      )}
    </div>
  );
}

export default MermaidDiagram;
