import { useState } from 'react';
import { typography } from '../utils/typography';
import Icon from './icons/Icon';
import { getSessionToken } from '../utils/sessionToken';

const MCP_ENDPOINT = import.meta.env.VITE_MCP_ENDPOINT || 'https://mcp.thechrisgrey.com';

const makeConfig = (token: string) => `{
  "mcpServers": {
    "alti": {
      "command": "npx",
      "args": ["mcp-remote", "${MCP_ENDPOINT}", "--header", "Authorization:Bearer ${token}"]
    }
  }
}`;

const TOOLS = [
  {
    name: 'search_blog',
    description: "Search Christian's blog by keyword. Returns up to 5 matches with URLs.",
  },
  {
    name: 'get_blog_post',
    description: 'Retrieve the full text of a blog post by slug.',
  },
  {
    name: 'ask_alti',
    description: "Ask Alti a single question about Christian's work, podcast, or writing.",
  },
];

type CopyState = 'idle' | 'copied' | 'error';

interface CopyButtonProps {
  value: string;
  label: string;
}

function CopyButton({ value, label }: CopyButtonProps) {
  const [state, setState] = useState<CopyState>('idle');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
      window.setTimeout(() => setState('idle'), 1800);
    } catch {
      setState('error');
      window.setTimeout(() => setState('idle'), 1800);
    }
  };

  const icon = state === 'copied' ? 'check' : state === 'error' ? 'error_outline' : 'content_copy';
  const buttonLabel = state === 'copied' ? 'Copied' : state === 'error' ? 'Copy failed' : label;

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm min-h-[36px] text-altivum-gold border border-altivum-gold/40 bg-altivum-gold/5 hover:bg-altivum-gold/15 transition-all active:scale-[0.98] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-altivum-gold focus-visible:outline-offset-2"
      aria-label={buttonLabel}
    >
      <Icon name={icon} className="text-base leading-none" aria-hidden="true" />
      <span>{buttonLabel}</span>
    </button>
  );
}

export function McpInstallBadge() {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generateConfig = async () => {
    setBusy(true);
    setError('');
    const issued = await getSessionToken('mcp');
    setBusy(false);
    if (!issued) {
      setError('Verification failed. Please try again.');
      return;
    }
    setToken(issued);
  };
  const config = makeConfig(token || 'GENERATE_A_SESSION_BELOW');
  return (
    <section className="py-20 md:py-28" aria-labelledby="mcp-install-heading">
      <div className="max-w-4xl mx-auto px-6 lg:px-8">
        <div className="text-center mb-12">
          <span className="text-altivum-gold/70 text-[11px] uppercase tracking-[0.25em]">Model Context Protocol</span>
          <h2 id="mcp-install-heading" className="text-white mt-3 mb-4" style={typography.sectionHeader}>
            Use Alti in Your AI Client
          </h2>
          <p className="text-altivum-silver max-w-2xl mx-auto" style={typography.bodyText}>
            Connect Alti to a client that supports MCP bearer headers. Verify your session below, then copy the
            configuration to search the blog and ask about Christian’s work.
          </p>
        </div>

        <div className="bg-white/5 border border-altivum-gold/30 rounded-2xl px-6 py-6 sm:px-8 sm:py-8 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-altivum-gold/5 transition-all duration-300">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <div className="min-w-0">
              <p
                className="text-altivum-silver/70 text-xs uppercase tracking-[0.2em] mb-1"
                style={typography.smallText}
              >
                Server URL
              </p>
              <code className="text-altivum-gold font-mono text-sm sm:text-base break-all">{MCP_ENDPOINT}</code>
            </div>
            <div className="shrink-0">
              <CopyButton value={MCP_ENDPOINT} label="Copy URL" />
            </div>
          </div>

          <div className="mb-6">
            <div className="flex items-center justify-between gap-4 mb-2">
              <p className="text-altivum-silver/70 text-xs uppercase tracking-[0.2em]" style={typography.smallText}>
                Claude Desktop config
              </p>
              {token ? (
                <CopyButton value={config} label="Copy config" />
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void generateConfig()}
                  className="min-h-11 rounded-lg border border-altivum-gold/50 px-4 py-2 text-altivum-gold disabled:opacity-50"
                >
                  {busy ? 'Verifying…' : 'Generate session config'}
                </button>
              )}
            </div>
            <pre
              className="ph-no-capture bg-altivum-dark/60 border border-white/5 rounded-lg p-4 overflow-x-auto text-xs sm:text-sm text-altivum-silver font-mono leading-relaxed"
              aria-label="Claude Desktop configuration snippet"
            >
              <code>{config}</code>
            </pre>
            <p className="text-altivum-silver/60 mt-3" style={typography.smallText}>
              Claude Desktop reaches the server through{' '}
              <code className="text-altivum-gold/90 font-mono">mcp-remote</code>, a stdio bridge. The session expires
              after 30 minutes. Return here to generate a new configuration when it expires. Treat the generated
              configuration as a temporary credential. URL-only connectors are not supported.
            </p>
          </div>

          {error && (
            <p role="alert" className="text-red-300 mb-4">
              {error}
            </p>
          )}
          <div>
            <p className="text-altivum-silver/70 text-xs uppercase tracking-[0.2em] mb-3" style={typography.smallText}>
              Exposed tools
            </p>
            <ul className="space-y-3">
              {TOOLS.map((tool) => (
                <li key={tool.name} className="border-l-2 border-altivum-gold/40 pl-3">
                  <p className="text-altivum-gold font-mono text-sm">{tool.name}</p>
                  <p className="text-altivum-silver/80" style={typography.smallText}>
                    {tool.description}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-altivum-silver/50 mt-6 text-xs" style={typography.smallText}>
            Verified sessions, rate-limited to 60 requests per hour per IP.
          </p>
        </div>
      </div>
    </section>
  );
}

export default McpInstallBadge;
