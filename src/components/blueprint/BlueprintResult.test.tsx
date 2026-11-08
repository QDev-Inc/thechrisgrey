import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BlueprintResult } from './BlueprintResult';
import type { BlueprintOutput, BlueprintSuccessResponse } from '../../types/blueprint';

// MermaidDiagram pulls in the heavy `mermaid` + `dompurify` libraries via dynamic
// import. Mock the child component (named AND default export, mirroring the source)
// so this suite stays focused on BlueprintResult's own composition and runs fast.
vi.mock('./MermaidDiagram', () => ({
  MermaidDiagram: ({ source }: { source: string }) => <div data-testid="mock-mermaid">{source}</div>,
  default: ({ source }: { source: string }) => <div data-testid="mock-mermaid">{source}</div>,
}));

// IacBlock and ArtifactCard both call navigator.clipboard.writeText on Copy.
// jsdom has no clipboard, so stub it.
const writeText = vi.fn().mockResolvedValue(undefined);
beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

// ─── Fixtures ───────────────────────────────────────────────────────────────

const baseOutput: BlueprintOutput = {
  architecture_summary:
    'A serverless RAG pipeline on AWS.\nDocuments land in S3, are embedded by Bedrock, and queried through a Lambda-backed API.',
  services: [
    {
      service: 'Amazon S3',
      purpose: 'Stores raw source documents and embeddings.',
      rationale: 'Cheap, durable object storage with event triggers.',
      cost_signal: 'free-tier',
    },
    {
      service: 'AWS Lambda',
      purpose: 'Runs the retrieval and generation handler.',
      rationale: 'No servers to manage and scales to zero.',
      cost_signal: 'low',
    },
    {
      service: 'Amazon Bedrock',
      purpose: 'Generates embeddings and answers.',
      rationale: 'Managed foundation models with no infra.',
      cost_signal: 'high',
    },
  ],
  diagram_mermaid: 'graph TD; S3-->Lambda; Lambda-->Bedrock;',
  iac_scaffold: {
    tool: 'cdk',
    rationale: 'CDK matches the TypeScript-first team preference.',
    snippet: 'const bucket = new s3.Bucket(this, "Docs");',
  },
  iam_highlights: [
    'Scope s3:GetObject to the documents bucket ARN only.',
    'Restrict bedrock:InvokeModel to the specific model id.',
  ],
  cost_estimate: {
    monthly_low_usd: 12,
    monthly_high_usd: 1450,
    assumptions: ['10k requests per month.', '5 GB of stored documents.'],
  },
  claude_artifacts: [
    {
      kind: 'skill',
      name: 'rag-query-helper',
      description: 'Formats retrieval prompts for the pipeline.',
      body: '# rag-query-helper\nDo retrieval things.',
    },
    {
      kind: 'mcp_tool',
      name: 'doc-ingest',
      description: 'MCP tool that uploads documents to S3.',
      body: '{"name":"doc-ingest"}',
    },
  ],
  next_steps: [
    'Provision the S3 bucket and Bedrock access.',
    'Deploy the Lambda handler.',
    'Wire up the API Gateway route.',
  ],
  caveats: ['Cost estimate assumes on-demand Bedrock pricing.', 'No VPC isolation is configured by default.'],
};

const baseMeta: NonNullable<BlueprintSuccessResponse['meta']> = {
  requestId: 'req-123',
  tier: 'free',
  latency_ms: 8400,
  examples_used: 2,
  haiku_verdict: {
    ok: true,
    confidence: 'high',
    issues: [
      {
        field: 'cost_estimate',
        severity: 'warn',
        note: 'High end may be optimistic for heavy Bedrock usage.',
      },
      {
        field: 'iam_highlights',
        severity: 'error',
        note: 'This error-severity issue should not appear as a soft signal.',
      },
    ],
  },
};

function renderResultWithContainer(
  overrides: {
    output?: Partial<BlueprintOutput>;
    meta?: BlueprintSuccessResponse['meta'] | null;
    onReset?: () => void;
  } = {},
) {
  const output = { ...baseOutput, ...overrides.output } as BlueprintOutput;
  const meta = 'meta' in overrides ? (overrides.meta ?? null) : baseMeta;
  const onReset = overrides.onReset ?? vi.fn();
  const result = render(<BlueprintResult output={output} meta={meta} onReset={onReset} />);
  return { ...result, onReset };
}

function renderResult(overrides: Parameters<typeof renderResultWithContainer>[0] = {}) {
  return renderResultWithContainer(overrides);
}

// userEvent.setup() installs its own navigator.clipboard stub, clobbering our
// spy. Reinstall the spy after setup so we can assert on the writeText the
// component actually calls.
function setupUserWithClipboard() {
  const user = userEvent.setup();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  return user;
}

describe('BlueprintResult', () => {
  describe('architecture summary', () => {
    it('renders the Blueprint ready badge and overview heading', () => {
      renderResult();
      expect(screen.getByText('Blueprint ready')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Architecture overview' })).toBeInTheDocument();
    });

    it('renders the architecture summary text', () => {
      renderResult();
      expect(screen.getByText(/A serverless RAG pipeline on AWS\./)).toBeInTheDocument();
      expect(screen.getByText(/queried through a Lambda-backed API\./)).toBeInTheDocument();
    });

    it('labels the whole result container', () => {
      const { container } = renderResultWithContainer();
      expect(container.querySelector('[aria-label="Generated blueprint"]')).not.toBeNull();
    });
  });

  describe('reset callback', () => {
    it('fires onReset when the "Start a new blueprint" button is clicked', async () => {
      const user = userEvent.setup();
      const onReset = vi.fn();
      renderResult({ onReset });

      await user.click(screen.getByRole('button', { name: /Start a new blueprint/i }));
      expect(onReset).toHaveBeenCalledTimes(1);
    });
  });

  describe('diagram section', () => {
    it('renders the section heading and passes the mermaid source to the child', () => {
      renderResult();
      expect(screen.getByRole('heading', { name: 'Architecture diagram' })).toBeInTheDocument();
      const diagram = screen.getByTestId('mock-mermaid');
      expect(diagram).toHaveTextContent('graph TD; S3-->Lambda; Lambda-->Bedrock;');
    });
  });

  describe('services section', () => {
    it('renders the AWS services heading', () => {
      renderResult();
      expect(screen.getByRole('heading', { name: 'AWS services' })).toBeInTheDocument();
    });

    it('renders every service name', () => {
      renderResult();
      expect(screen.getByText('Amazon S3')).toBeInTheDocument();
      expect(screen.getByText('AWS Lambda')).toBeInTheDocument();
      expect(screen.getByText('Amazon Bedrock')).toBeInTheDocument();
    });

    it('renders service purposes and cost-signal labels', () => {
      renderResult();
      expect(screen.getByText('Stores raw source documents and embeddings.')).toBeInTheDocument();
      // free-tier, low, high signals map to human labels.
      expect(screen.getByText('Free tier')).toBeInTheDocument();
      expect(screen.getByText('Low')).toBeInTheDocument();
      expect(screen.getByText('High')).toBeInTheDocument();
    });
  });

  describe('infrastructure-as-code section', () => {
    it('renders the IaC heading and tool label for CDK', () => {
      renderResult();
      expect(screen.getByRole('heading', { name: 'Infrastructure-as-code' })).toBeInTheDocument();
      expect(screen.getByText('AWS CDK (TypeScript)')).toBeInTheDocument();
    });

    it('renders the snippet and its rationale', () => {
      renderResult();
      expect(screen.getByText('const bucket = new s3.Bucket(this, "Docs");')).toBeInTheDocument();
      expect(screen.getByText(/CDK matches the TypeScript-first team preference\./)).toBeInTheDocument();
    });

    it('copies the snippet to the clipboard and flips the button label', async () => {
      const user = setupUserWithClipboard();
      renderResult();

      const copyButton = screen.getByRole('button', { name: /^Copy$/i });
      await user.click(copyButton);

      expect(writeText).toHaveBeenCalledWith('const bucket = new s3.Bucket(this, "Docs");');
      expect(screen.getByRole('button', { name: /Copied/i })).toBeInTheDocument();
    });

    it('renders the SAM tool label and yaml when tool is sam', () => {
      renderResult({
        output: {
          iac_scaffold: {
            tool: 'sam',
            rationale: 'SAM keeps the template terse.',
            snippet: 'Resources:\n  Fn:\n    Type: AWS::Serverless::Function',
          },
        },
      });
      expect(screen.getByText('AWS SAM (YAML)')).toBeInTheDocument();
    });

    it('renders the Terraform tool label when tool is terraform', () => {
      renderResult({
        output: {
          iac_scaffold: {
            tool: 'terraform',
            rationale: 'Terraform is the org standard.',
            snippet: 'resource "aws_s3_bucket" "docs" {}',
          },
        },
      });
      expect(screen.getByText('Terraform (HCL)')).toBeInTheDocument();
    });

    it('omits the rationale block when no rationale is provided', () => {
      renderResult({
        output: {
          iac_scaffold: {
            tool: 'cdk',
            rationale: '',
            snippet: 'const x = 1;',
          },
        },
      });
      expect(screen.queryByText(/Why this tool:/)).not.toBeInTheDocument();
    });
  });

  describe('IAM highlights section', () => {
    it('renders the IAM heading and each highlight', () => {
      renderResult();
      expect(screen.getByRole('heading', { name: 'IAM highlights' })).toBeInTheDocument();
      expect(screen.getByText('Scope s3:GetObject to the documents bucket ARN only.')).toBeInTheDocument();
      expect(screen.getByText('Restrict bedrock:InvokeModel to the specific model id.')).toBeInTheDocument();
    });

    it('omits the IAM section entirely when the list is empty', () => {
      renderResult({ output: { iam_highlights: [] } });
      expect(screen.queryByRole('heading', { name: 'IAM highlights' })).not.toBeInTheDocument();
    });
  });

  describe('cost estimate section', () => {
    it('renders the cost heading and the formatted range', () => {
      renderResult();
      expect(screen.getByRole('heading', { name: 'Cost estimate' })).toBeInTheDocument();
      expect(screen.getByText('$12 – $1,450')).toBeInTheDocument();
    });

    it('renders the cost assumptions', () => {
      renderResult();
      expect(screen.getByText('10k requests per month.')).toBeInTheDocument();
      expect(screen.getByText('5 GB of stored documents.')).toBeInTheDocument();
    });

    it('shows "Free tier" when the high estimate is zero', () => {
      // Override services so no service carries a "Free tier" cost label,
      // leaving the cost card as the sole source of that text.
      renderResult({
        output: {
          services: [
            {
              service: 'AWS Lambda',
              purpose: 'Runs everything.',
              rationale: 'Scales to zero.',
              cost_signal: 'low',
            },
          ],
          cost_estimate: {
            monthly_low_usd: 0,
            monthly_high_usd: 0,
            assumptions: ['Stays within the AWS free tier.'],
          },
        },
      });
      expect(screen.getByText('Free tier')).toBeInTheDocument();
      expect(screen.queryByText('/ month')).not.toBeInTheDocument();
    });
  });

  describe('claude artifacts section', () => {
    it('renders the artifacts heading and each artifact name', () => {
      renderResult();
      expect(screen.getByRole('heading', { name: 'Claude Code artifacts' })).toBeInTheDocument();
      expect(screen.getByText('rag-query-helper')).toBeInTheDocument();
      expect(screen.getByText('doc-ingest')).toBeInTheDocument();
    });

    it('renders the artifact kind labels', () => {
      renderResult();
      expect(screen.getByText('Claude Code Skill')).toBeInTheDocument();
      expect(screen.getByText('MCP Tool')).toBeInTheDocument();
    });

    it('omits the artifacts section when there are none', () => {
      renderResult({ output: { claude_artifacts: [] } });
      expect(screen.queryByRole('heading', { name: 'Claude Code artifacts' })).not.toBeInTheDocument();
    });
  });

  describe('next steps section', () => {
    it('renders the next steps heading and each ordered step', () => {
      renderResult();
      expect(screen.getByRole('heading', { name: 'Next steps' })).toBeInTheDocument();
      expect(screen.getByText('Provision the S3 bucket and Bedrock access.')).toBeInTheDocument();
      expect(screen.getByText('Deploy the Lambda handler.')).toBeInTheDocument();
      expect(screen.getByText('Wire up the API Gateway route.')).toBeInTheDocument();
    });

    it('omits the next steps section when the list is empty', () => {
      renderResult({ output: { next_steps: [] } });
      expect(screen.queryByRole('heading', { name: 'Next steps' })).not.toBeInTheDocument();
    });
  });

  describe('caveats section', () => {
    it('renders the caveats heading and each caveat', () => {
      renderResult();
      expect(screen.getByRole('heading', { name: 'Caveats' })).toBeInTheDocument();
      expect(screen.getByText('Cost estimate assumes on-demand Bedrock pricing.')).toBeInTheDocument();
      expect(screen.getByText('No VPC isolation is configured by default.')).toBeInTheDocument();
    });

    it('omits the caveats section when the list is empty', () => {
      renderResult({ output: { caveats: [] } });
      expect(screen.queryByRole('heading', { name: 'Caveats' })).not.toBeInTheDocument();
    });
  });

  describe('meta / haiku verdict footer', () => {
    it('always renders the generated-by attribution', () => {
      renderResult();
      expect(screen.getByText(/Generated and checked with AI\./)).toBeInTheDocument();
    });

    it('renders latency in seconds and example count when meta is provided', () => {
      renderResult();
      // 8400ms -> 8.4s, examples_used 2 -> "2 examples referenced"
      expect(screen.getByText(/8\.4s\s*·\s*2 examples referenced/)).toBeInTheDocument();
    });

    it('singularizes the example label when exactly one example is used', () => {
      renderResult({
        meta: { ...baseMeta, latency_ms: 3000, examples_used: 1 },
      });
      expect(screen.getByText(/3\.0s\s*·\s*1 example referenced/)).toBeInTheDocument();
    });

    it('renders only latency when examples_used is absent', () => {
      renderResult({
        meta: { latency_ms: 5000 },
      });
      const footer = screen.getByText(/5\.0s/);
      expect(footer).toBeInTheDocument();
      expect(footer.textContent).not.toMatch(/example/);
    });

    it('omits the latency line entirely when meta is null', () => {
      renderResult({ meta: null });
      // Attribution still present, but no latency text.
      expect(screen.getByText(/Generated and checked with AI/)).toBeInTheDocument();
      expect(screen.queryByText(/example.*referenced/)).not.toBeInTheDocument();
    });

    it('omits the latency line when latency_ms is missing', () => {
      renderResult({ meta: { examples_used: 4 } });
      expect(screen.queryByText(/referenced/)).not.toBeInTheDocument();
    });
  });

  describe('haiku verdict soft-signal warnings', () => {
    it('renders only warn-severity issues as soft signals', () => {
      renderResult();
      expect(screen.getByText(/Review notes for this blueprint:/)).toBeInTheDocument();
      expect(screen.getByText(/High end may be optimistic for heavy Bedrock usage\./)).toBeInTheDocument();
      // The error-severity issue must be filtered out.
      expect(screen.queryByText(/should not appear as a soft signal/)).not.toBeInTheDocument();
    });

    it('does not render the warning panel when there are no warn issues', () => {
      renderResult({
        meta: {
          ...baseMeta,
          haiku_verdict: {
            ok: true,
            confidence: 'high',
            issues: [
              {
                field: 'services',
                severity: 'error',
                note: 'An error, not a warning.',
              },
            ],
          },
        },
      });
      expect(screen.queryByText(/Review notes for this blueprint/)).not.toBeInTheDocument();
    });

    it('does not render the warning panel when there is no haiku verdict', () => {
      renderResult({ meta: { latency_ms: 1000 } });
      expect(screen.queryByText(/Review notes for this blueprint/)).not.toBeInTheDocument();
    });

    it('does not render the warning panel when meta is null', () => {
      renderResult({ meta: null });
      expect(screen.queryByText(/Review notes for this blueprint/)).not.toBeInTheDocument();
    });
  });

  describe('artifact copy interaction', () => {
    it('copies the artifact body via the child card Copy button', async () => {
      const user = setupUserWithClipboard();
      renderResult();

      const copyBodyButtons = screen.getAllByRole('button', {
        name: /Copy body/i,
      });
      await user.click(copyBodyButtons[0]);

      expect(writeText).toHaveBeenCalledWith('# rag-query-helper\nDo retrieval things.');
    });
  });

  describe('section structure', () => {
    it('renders all primary section headings together for a full blueprint', () => {
      renderResult();
      const headings = [
        'Architecture overview',
        'Architecture diagram',
        'AWS services',
        'Infrastructure-as-code',
        'IAM highlights',
        'Cost estimate',
        'Claude Code artifacts',
        'Next steps',
        'Caveats',
      ];
      for (const name of headings) {
        expect(screen.getByRole('heading', { name })).toBeInTheDocument();
      }
    });

    it('scopes the services list to its own labelled region', () => {
      renderResult();
      const list = screen.getByRole('list', {
        name: 'Services in this architecture',
      });
      expect(within(list).getByText('Amazon S3')).toBeInTheDocument();
    });
  });
});
