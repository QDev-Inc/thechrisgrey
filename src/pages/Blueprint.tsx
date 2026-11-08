import { useEffect, useMemo, useRef } from 'react';
import { SEO } from '../components/SEO';
import Breadcrumbs from '../components/Breadcrumbs';
import { typography } from '../utils/typography';
import { buildWebPageSchema } from '../utils/schemas';
import { useBlueprint } from '../hooks/useBlueprint';
import { useIsFeatureEnabled } from '../hooks/useFeatureFlag';
import { BlueprintForm } from '../components/blueprint/BlueprintForm';
import { BlueprintResult } from '../components/blueprint/BlueprintResult';
import { LoadingSkeleton } from '../components/blueprint/LoadingSkeleton';
import { Waitlist } from '../components/blueprint/Waitlist';
import { RateLimitedCard } from '../components/blueprint/RateLimitedCard';
import Icon from '../components/icons/Icon';

const breadcrumbs = [
  { name: 'Home', url: 'https://thechrisgrey.com' },
  { name: 'Blueprint', url: 'https://thechrisgrey.com/blueprint' },
];

const HIGHLIGHT_ITEMS: Array<{ icon: string; title: string; body: string }> = [
  {
    icon: 'schema',
    title: 'Architecture with clear tradeoffs',
    body: 'Get service recommendations, a Mermaid diagram, and the reasoning behind each choice.',
  },
  {
    icon: 'terminal',
    title: 'IaC scaffold + IAM highlights',
    body: 'Starter CDK, SAM, or Terraform with the scoped permissions you actually need.',
  },
  {
    icon: 'auto_awesome',
    title: 'Ready-to-run Claude artifacts',
    body: 'Skills, slash commands, subagents, and MCP tools tailored to the blueprint.',
  },
];

function BlueprintHero() {
  return (
    <section className="text-center space-y-5">
      <div className="inline-flex items-center gap-2 px-3 py-1 bg-altivum-gold/10 border border-altivum-gold/30 rounded-full">
        <Icon name="architecture" className="text-altivum-gold text-sm" aria-hidden="true" />
        <span className="text-altivum-gold uppercase tracking-wider" style={typography.smallText}>
          thechrisgrey Blueprint
        </span>
      </div>
      <h1 className="text-white" style={typography.heroHeader}>
        AWS architecture, <span className="text-altivum-gold">on demand.</span>
      </h1>
      <p className="text-altivum-silver max-w-2xl mx-auto" style={typography.subtitle}>
        Describe what you want to build and get an architecture, diagram, IaC scaffold, cost estimate, and ready-to-use
        Claude Code artifacts.
      </p>
    </section>
  );
}

function HighlightsGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {HIGHLIGHT_ITEMS.map((item) => (
        <div
          key={item.title}
          className="p-5 rounded-lg bg-altivum-navy/40 border border-white/5 hover:border-altivum-gold/20 transition-colors"
        >
          <div className="flex items-center gap-2 mb-2">
            <Icon name={item.icon} className="text-altivum-gold" aria-hidden="true" />
            <h3 className="text-white" style={typography.cardTitleSmall}>
              {item.title}
            </h3>
          </div>
          <p className="text-altivum-silver" style={typography.smallText}>
            {item.body}
          </p>
        </div>
      ))}
    </div>
  );
}

function WaitlistPlaceholder() {
  return (
    <div className="max-w-4xl mx-auto px-6 lg:px-8 py-20 md:py-28 space-y-10">
      <BlueprintHero />
      <HighlightsGrid />
      <div className="pt-6">
        <Waitlist
          heading="Be first when Blueprint goes live."
          subheading="We're opening access gradually. Join the waitlist and we'll email you when it's ready."
        />
      </div>
      <p className="text-center text-altivum-silver/60" style={typography.smallText}>
        Launching soon.
      </p>
    </div>
  );
}

export default function Blueprint() {
  const { output, meta, isGenerating, error, generate, reset } = useBlueprint();
  const resultRef = useRef<HTMLDivElement | null>(null);
  const blueprintEnabled = useIsFeatureEnabled('blueprint');

  const structuredData = useMemo(
    () => [
      buildWebPageSchema({
        name: 'thechrisgrey Blueprint',
        description:
          'Describe your workload and get a production-ready AWS architecture blueprint with IaC, IAM highlights, a cost estimate, and Claude Code artifacts.',
        url: 'https://thechrisgrey.com/blueprint',
      }),
    ],
    [],
  );

  useEffect(() => {
    if (output && resultRef.current) {
      resultRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [output]);

  if (!blueprintEnabled) {
    return (
      <div className="min-h-screen bg-altivum-dark pt-28">
        <SEO
          title="Blueprint — Coming soon"
          description="thechrisgrey Blueprint turns a short spec into a production-ready AWS architecture, IaC, IAM guidance, cost estimate, and Claude Code artifacts. Join the waitlist."
          keywords="AWS architecture generator, blueprint, AI design, IaC, Claude Code skills, Christian Perez"
          url="https://thechrisgrey.com/blueprint"
          breadcrumbs={breadcrumbs}
          structuredData={structuredData}
          noindex
        />
        <div className="pb-3 max-w-4xl mx-auto px-6 lg:px-8">
          <Breadcrumbs items={breadcrumbs} />
        </div>
        <WaitlistPlaceholder />
      </div>
    );
  }

  const showError = error !== null;
  const isRateLimited = error?.kind === 'rate_limited';
  const showResult = output !== null;
  const showForm = !isGenerating && !showResult && !isRateLimited;

  return (
    <div className="min-h-screen bg-altivum-dark pt-28 pb-24">
      <SEO
        title="Blueprint"
        description="Describe what you want to build and receive an AWS architecture blueprint: Mermaid diagram, IaC scaffold, IAM highlights, cost estimate, and Claude Code artifacts."
        keywords="AWS architecture, blueprint, AWS CDK, SAM, Terraform, AI design, serverless, RAG, Christian Perez"
        url="https://thechrisgrey.com/blueprint"
        breadcrumbs={breadcrumbs}
        structuredData={structuredData}
      />

      <div className="pb-3 max-w-4xl mx-auto px-6 lg:px-8">
        <Breadcrumbs items={breadcrumbs} />
      </div>

      <div className="max-w-4xl mx-auto px-6 lg:px-8 space-y-12">
        <BlueprintHero />
        <HighlightsGrid />

        <div className="h-px bg-linear-to-r from-transparent via-altivum-gold/15 to-transparent" />

        {showForm && (
          <section aria-labelledby="form-heading" className="space-y-4">
            <div>
              <h2 id="form-heading" className="text-white mb-2" style={typography.sectionHeader}>
                Describe your project
              </h2>
              <p className="text-altivum-silver" style={typography.bodyText}>
                Keep it short and specific. You get more useful blueprints when you name constraints (budget, latency,
                compliance) up front.
              </p>
            </div>
            <BlueprintForm onSubmit={generate} isGenerating={isGenerating} />
          </section>
        )}

        {isGenerating && (
          <section aria-labelledby="loading-heading" className="space-y-4">
            <h2 id="loading-heading" className="text-white" style={typography.sectionHeader}>
              Working on your blueprint…
            </h2>
            <LoadingSkeleton />
          </section>
        )}

        {showError && !isRateLimited && (
          <section
            aria-labelledby="error-heading"
            className="p-5 rounded-lg border border-rose-400/30 bg-rose-500/5"
            role="alert"
          >
            <div className="flex items-start gap-3">
              <Icon name="error_outline" className="text-rose-300 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <h2 id="error-heading" className="text-white mb-1" style={typography.cardTitleSmall}>
                  {error.kind === 'timeout'
                    ? 'Generation took too long.'
                    : error.kind === 'validation_failed'
                      ? 'The model returned a low-quality blueprint.'
                      : error.kind === 'invalid_input'
                        ? 'Your spec needs a small fix.'
                        : error.kind === 'not_configured'
                          ? 'Blueprint is not configured in this environment.'
                          : 'Something went wrong.'}
                </h2>
                <p className="text-altivum-silver" style={typography.bodyText}>
                  {error.message}
                </p>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={reset}
                    className="inline-flex items-center px-3 py-2 rounded-md border border-white/10 text-altivum-silver hover:border-altivum-gold/40 hover:text-white transition-colors"
                    style={typography.smallText}
                  >
                    <Icon name="refresh" className="text-sm mr-1" aria-hidden="true" />
                    Try again
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {isRateLimited && error && <RateLimitedCard message={error.message} />}

        {showResult && output && (
          <section ref={resultRef} aria-labelledby="result-heading" className="space-y-6">
            <h2 id="result-heading" className="sr-only">
              Generated blueprint
            </h2>
            <BlueprintResult output={output} meta={meta} onReset={reset} />
          </section>
        )}
      </div>
    </div>
  );
}
