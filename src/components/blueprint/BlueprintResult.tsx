import { useMemo, useState } from 'react';
import { typography } from '../../utils/typography';
import type { BlueprintOutput, BlueprintSuccessResponse } from '../../types/blueprint';
import { ServiceList } from './ServiceList';
import { MermaidDiagram } from './MermaidDiagram';
import { CostCard } from './CostCard';
import { ArtifactCard } from './ArtifactCard';
import Icon from '../icons/Icon';

interface BlueprintResultProps {
  output: BlueprintOutput;
  meta: BlueprintSuccessResponse['meta'] | null;
  onReset: () => void;
}

const IAC_TOOL_LABELS: Record<string, string> = {
  cdk: 'AWS CDK (TypeScript)',
  sam: 'AWS SAM (YAML)',
  terraform: 'Terraform (HCL)',
};

function Divider() {
  return <div className="h-px bg-linear-to-r from-transparent via-altivum-gold/15 to-transparent" aria-hidden="true" />;
}

function SectionHeading({ icon, title, caption }: { icon: string; title: string; caption?: string }) {
  return (
    <div className="flex items-start gap-3 mb-4">
      <Icon name={icon} className="text-altivum-gold mt-0.5" aria-hidden="true" />
      <div>
        <h3 className="text-white" style={typography.cardTitleLarge}>
          {title}
        </h3>
        {caption && (
          <p className="text-altivum-silver/80 mt-1" style={typography.smallText}>
            {caption}
          </p>
        )}
      </div>
    </div>
  );
}

function IacBlock({ output }: { output: BlueprintOutput }) {
  const [copied, setCopied] = useState(false);
  const { iac_scaffold } = output;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(iac_scaffold.snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // swallow
    }
  };

  const language = iac_scaffold.tool === 'terraform' ? 'hcl' : iac_scaffold.tool === 'sam' ? 'yaml' : 'typescript';

  return (
    <div className="rounded-lg bg-altivum-navy/60 border border-white/5 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-altivum-dark/50 border-b border-white/5">
        <div className="flex items-baseline gap-2">
          <span className="text-altivum-gold" style={typography.smallText}>
            {IAC_TOOL_LABELS[iac_scaffold.tool] ?? iac_scaffold.tool.toUpperCase()}
          </span>
          <span className="text-altivum-silver/60" style={typography.smallText}>
            starter snippet
          </span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center text-altivum-silver hover:text-altivum-gold transition-colors"
          style={typography.smallText}
        >
          <Icon name={copied ? 'check' : 'content_copy'} className="text-sm mr-1" aria-hidden="true" />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className={`p-4 text-altivum-silver overflow-x-auto language-${language}`} style={typography.smallText}>
        {iac_scaffold.snippet}
      </pre>
      {iac_scaffold.rationale && (
        <div className="px-4 py-3 border-t border-white/5 bg-altivum-dark/30">
          <p className="text-altivum-silver/90" style={typography.smallText}>
            <span className="text-altivum-gold">Why this tool: </span>
            {iac_scaffold.rationale}
          </p>
        </div>
      )}
    </div>
  );
}

export function BlueprintResult({ output, meta, onReset }: BlueprintResultProps) {
  const {
    architecture_summary,
    services,
    diagram_mermaid,
    iam_highlights,
    cost_estimate,
    claude_artifacts,
    next_steps,
    caveats,
  } = output;

  const hasCaveats = caveats && caveats.length > 0;
  const haikuWarnings = useMemo(() => {
    if (!meta?.haiku_verdict?.issues) return [];
    return meta.haiku_verdict.issues.filter((i) => i.severity === 'warn');
  }, [meta]);

  return (
    <div className="space-y-10" aria-label="Generated blueprint">
      <section aria-labelledby="summary-heading">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <span
              className="inline-block px-2.5 py-1 bg-altivum-gold/10 border border-altivum-gold/30 rounded-full text-altivum-gold mb-3"
              style={typography.smallText}
            >
              Blueprint ready
            </span>
            <h3 id="summary-heading" className="text-white" style={typography.cardTitleLarge}>
              Architecture overview
            </h3>
          </div>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center px-3 py-2 rounded-md border border-white/10 text-altivum-silver hover:border-altivum-gold/40 hover:text-white transition-colors"
            style={typography.smallText}
          >
            <Icon name="restart_alt" className="text-sm mr-1" aria-hidden="true" />
            Start a new blueprint
          </button>
        </div>
        <p className="text-altivum-silver whitespace-pre-line" style={typography.bodyText}>
          {architecture_summary}
        </p>

        {haikuWarnings.length > 0 && (
          <div className="mt-4 p-3 rounded-md bg-amber-300/5 border border-amber-300/20">
            <p className="text-amber-200 mb-1" style={typography.smallText}>
              <Icon name="info" className="text-sm align-middle mr-1" aria-hidden="true" />
              Review notes for this blueprint:
            </p>
            <ul className="list-disc pl-6 text-amber-100/80" style={typography.smallText}>
              {haikuWarnings.map((warning, idx) => (
                <li key={idx}>
                  <span className="text-amber-100">{warning.field}:</span> {warning.note}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <Divider />

      <section aria-labelledby="diagram-heading" className="space-y-4">
        <SectionHeading
          icon="hub"
          title="Architecture diagram"
          caption="Rendered with Mermaid. Toggle to view the raw source."
        />
        <MermaidDiagram source={diagram_mermaid} />
      </section>

      <Divider />

      <section aria-labelledby="services-heading" className="space-y-4">
        <SectionHeading
          icon="dns"
          title="AWS services"
          caption="Every service the blueprint uses, what it does, and why it was chosen."
        />
        <ServiceList services={services} />
      </section>

      <Divider />

      <section aria-labelledby="iac-heading" className="space-y-4">
        <SectionHeading
          icon="terminal"
          title="Infrastructure-as-code"
          caption="A starter snippet you can paste into your project."
        />
        <IacBlock output={output} />
      </section>

      {iam_highlights && iam_highlights.length > 0 && (
        <>
          <Divider />
          <section aria-labelledby="iam-heading" className="space-y-4">
            <SectionHeading
              icon="verified_user"
              title="IAM highlights"
              caption="Critical permissions to scope tightly before you ship."
            />
            <ul className="space-y-2">
              {iam_highlights.map((item, idx) => (
                <li
                  key={idx}
                  className="flex gap-3 p-3 rounded-md bg-altivum-navy/40 border border-white/5 text-altivum-silver"
                  style={typography.bodyText}
                >
                  <Icon name="shield" className="text-altivum-gold text-sm shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <Divider />

      <section aria-labelledby="cost-heading" className="space-y-4">
        <SectionHeading
          icon="payments"
          title="Cost estimate"
          caption="Estimated monthly spend based on the stated assumptions."
        />
        <CostCard cost={cost_estimate} />
      </section>

      {claude_artifacts && claude_artifacts.length > 0 && (
        <>
          <Divider />
          <section aria-labelledby="artifacts-heading" className="space-y-4">
            <SectionHeading
              icon="auto_awesome"
              title="Claude Code artifacts"
              caption="Ready-to-use skills, slash commands, subagents, and MCP tools for your project."
            />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {claude_artifacts.map((artifact, idx) => (
                <ArtifactCard key={`${artifact.kind}-${idx}`} artifact={artifact} />
              ))}
            </div>
          </section>
        </>
      )}

      {next_steps && next_steps.length > 0 && (
        <>
          <Divider />
          <section aria-labelledby="next-heading" className="space-y-4">
            <SectionHeading
              icon="play_arrow"
              title="Next steps"
              caption="A short punch list to move from blueprint to running system."
            />
            <ol className="space-y-2">
              {next_steps.map((step, idx) => (
                <li
                  key={idx}
                  className="flex gap-3 p-3 rounded-md bg-altivum-navy/40 border border-white/5 text-altivum-silver"
                  style={typography.bodyText}
                >
                  <span
                    className="shrink-0 w-6 h-6 rounded-full bg-altivum-gold/10 border border-altivum-gold/30 text-altivum-gold flex items-center justify-center"
                    style={typography.smallText}
                    aria-hidden="true"
                  >
                    {idx + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}

      {hasCaveats && (
        <>
          <Divider />
          <section aria-labelledby="caveats-heading" className="space-y-4">
            <SectionHeading
              icon="report_problem"
              title="Caveats"
              caption="Things worth double-checking before you treat this as ground truth."
            />
            <ul className="space-y-2">
              {caveats.map((caveat, idx) => (
                <li
                  key={idx}
                  className="flex gap-3 p-3 rounded-md bg-altivum-navy/40 border border-amber-300/10 text-altivum-silver/90"
                  style={typography.bodyText}
                >
                  <Icon name="warning_amber" className="text-amber-300/80 text-sm shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{caveat}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <div
        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg bg-altivum-navy/30 border border-white/5"
        style={typography.smallText}
      >
        <span className="text-altivum-silver/70">Generated and checked with AI.</span>
        {meta?.latency_ms != null && (
          <span className="text-altivum-silver/60">
            {(meta.latency_ms / 1000).toFixed(1)}s{' '}
            {meta.examples_used != null &&
              `· ${meta.examples_used} example${meta.examples_used === 1 ? '' : 's'} referenced`}
          </span>
        )}
      </div>
    </div>
  );
}

export default BlueprintResult;
