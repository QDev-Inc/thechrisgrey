/**
 * System prompt composition for the thechrisgrey Blueprint generator.
 *
 * The generator is grounded on three inputs stitched together at request time:
 *  1. Christian's opinionated architecture principles (authored separately)
 *  2. 2–3 golden examples selected by category match from Sanity
 *  3. A concise description of the required output shape
 *
 * The output shape is enforced by Zod at parse time (BlueprintOutputSchema);
 * the prompt only has to communicate intent and tone well enough that Opus 4.6
 * produces JSON the validator accepts on the first try.
 */

import { BLUEPRINT_CATEGORIES } from "./schema.mjs";

/**
 * Christian's opinionated principles. This is a placeholder — the canonical
 * copy lives in docs/blueprint/system-prompt-principles.md and is pasted in
 * when Christian has authored it. The generator is safe to run with this
 * placeholder; the tone is deliberately close to the final draft target so
 * the model behavior is consistent.
 */
export const ARCHITECTURE_PRINCIPLES = `You are a principal AWS / AI architect speaking in Christian Perez's voice.
Christian is a former Green Beret (18D) turned Founder & CEO of Altivum Inc.,
an AWS Community Builder in AI Engineering, and an Anthropic-certified Applied
AI Engineer. He builds for builders. His principles:

- Serverless first. Reach for Lambda, Step Functions, DynamoDB, and Bedrock
  before ECS/EKS. Reserve containers for workloads that genuinely need them.
- Cost transparency over cost hiding. Every architecture ships with a real
  monthly range and the assumptions behind it. No "contact sales."
- Managed services over bespoke. Pay AWS to operate the hard parts (vector
  search, queues, streaming, ML inference) unless you have a specific reason.
- IaC or it didn't happen. Every diagram ships with a runnable CDK, SAM, or
  Terraform scaffold — not pseudo-code, not "..." placeholders.
- Least-privilege IAM from day one. Call out the one permission most teams
  over-scope and explain the correct narrower form.
- Observability is a feature. CloudWatch alarms, structured JSON logs, and
  at least one "this broke" alert belong in every blueprint.
- Ship-ready Claude artifacts. Every blueprint hands back at least one Claude
  Code artifact (skill, slash command, subagent, or MCP tool) the user can
  drop into ~/.claude/ and use today.
- Region honesty. Default to us-east-1 unless the workload says otherwise,
  and flag cross-region concerns (DR, latency, data residency) in caveats.
- Say "I'd pick X" — not "here are the tradeoffs." Principal engineers make
  calls. Explain the call in one or two sentences and move on.`;

/**
 * Output-shape guidance. This is deliberately terse because the Zod schema
 * (BlueprintOutputSchema) is the source of truth — the prompt just reminds
 * Opus which fields are required and which style conventions apply.
 */
export const OUTPUT_FORMAT_INSTRUCTIONS = `Return ONE JSON object and nothing else.
No prose before, no prose after, no markdown fences. The shape must be:

{
  "architecture_summary": string (100–2000 chars, prose, whiteboard voice),
  "services": [ { "service": string, "purpose": string, "rationale": string,
                  "cost_signal": "free-tier"|"low"|"medium"|"high" } ]  (2–15 items),
  "diagram_mermaid": string (flowchart TD or graph LR, 50–4000 chars, no code fences),
  "iac_scaffold": { "tool": "cdk"|"sam"|"terraform",
                    "rationale": string (20–400 chars),
                    "snippet": string (50–4000 chars, real runnable IaC) },
  "iam_highlights": [ string (10–300 chars) ]  (1–10 items),
  "cost_estimate": { "monthly_low_usd": number, "monthly_high_usd": number,
                     "assumptions": [ string (10–400 chars) ]  (1–8 items) },
  "claude_artifacts": [ { "kind": "skill"|"slash_command"|"subagent"|"mcp_tool",
                          "name": string (3–80 chars, kebab-case),
                          "description": string (20–300 chars),
                          "body": string (100–8000 chars) } ]  (1–4 items),
  "next_steps": [ string (10–300 chars) ]  (3–10 ordered items),
  "caveats": [ string (10–300 chars) ]  (0–6 items)
}

Style rules:
- No emojis anywhere.
- Mermaid: use flowchart TD or graph LR only. No sequence/gantt diagrams.
- IaC: real compilable code, not pseudo-code. No "..." elisions in critical paths.
- Artifact bodies: a skill is a valid SKILL.md. A slash command is the full body.
  A subagent is its full system prompt. An MCP tool is the inputSchema JSON + a
  concrete handler sketch.
- Prefer one complete artifact with a 400–1200 character body. Include concrete
  steps, commands, and verification criteria in the body itself, not a short
  description of what could be written. Every artifact body must exceed 100
  characters. Check each field's length before returning the JSON.
- Cost: monthly_low_usd is the steady-state floor, monthly_high_usd is the burst
  ceiling. Both must be >= 0 and <= 100000.`;

/**
 * Format a golden example as a compact text block. We serialize only the
 * fields that materially inform the model's output depth and style — the full
 * zod document is too big to fit 3 of them in a prompt.
 *
 * @param {any} example - A document matching GoldenExampleSchema.
 * @returns {string}
 */
export function formatExampleForPrompt(example) {
  const { spec, output } = example;
  const services = output.services.map((/** @type {any} */ s) => `  - ${s.service}: ${s.purpose}`).join("\n");
  const artifacts = output.claude_artifacts
    .map((/** @type {any} */ a) => `  - ${a.kind}: ${a.name} — ${a.description}`)
    .join("\n");
  const costLo = output.cost_estimate.monthly_low_usd;
  const costHi = output.cost_estimate.monthly_high_usd;

  return [
    `### Example: ${example.title}`,
    `Category: ${example.category}`,
    `Goal: ${spec.goal}`,
    `Summary: ${output.architecture_summary.slice(0, 400)}${output.architecture_summary.length > 400 ? "..." : ""}`,
    `Services:`,
    services,
    `Artifacts:`,
    artifacts,
    `Cost: $${costLo}–$${costHi}/mo`,
  ].join("\n");
}

/**
 * Pick up to `limit` examples that best match the spec. Category match is the
 * primary selector; after that we break ties by `sortOrder` ascending (lower
 * first = curated preference).
 *
 * @param {any[]} allExamples - Active GoldenExample documents.
 * @param {any} spec - A validated BlueprintInput.
 * @param {number} [limit=3]
 * @returns {any[]}
 */
export function selectExamples(allExamples, spec, limit = 3) {
  if (!Array.isArray(allExamples) || allExamples.length === 0) return [];

  const categoryMatches = allExamples
    .filter((/** @type {any} */ ex) => ex.category === spec.category)
    .sort((/** @type {any} */ a, /** @type {any} */ b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  if (categoryMatches.length >= limit) {
    return categoryMatches.slice(0, limit);
  }

  const others = allExamples
    .filter((/** @type {any} */ ex) => ex.category !== spec.category)
    .sort((/** @type {any} */ a, /** @type {any} */ b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  return [...categoryMatches, ...others].slice(0, limit);
}

/**
 * Format the user spec as a human-readable block for the user-turn prompt.
 *
 * @param {any} spec - A validated BlueprintInput.
 * @returns {string}
 */
export function formatSpecForPrompt(spec) {
  const lines = [`Goal: ${spec.goal}`, `Category: ${spec.category}`];

  if (spec.scale) {
    const { traffic, data_volume, latency_budget } = spec.scale;
    if (traffic) lines.push(`Traffic: ${traffic}`);
    if (data_volume) lines.push(`Data volume: ${data_volume}`);
    if (latency_budget) lines.push(`Latency budget: ${latency_budget}`);
  }

  if (spec.constraints) {
    const { monthly_budget_usd, compliance, region_restriction, team_size } = spec.constraints;
    if (monthly_budget_usd) lines.push(`Monthly budget: $${monthly_budget_usd}`);
    if (Array.isArray(compliance) && compliance.length > 0) {
      lines.push(`Compliance: ${compliance.join(", ")}`);
    }
    if (region_restriction) lines.push(`Region: ${region_restriction}`);
    if (team_size) lines.push(`Team size: ${team_size}`);
  }

  if (Array.isArray(spec.preferred_languages) && spec.preferred_languages.length > 0) {
    lines.push(`Preferred languages: ${spec.preferred_languages.join(", ")}`);
  }

  if (Array.isArray(spec.integrations) && spec.integrations.length > 0) {
    lines.push(`Integrations: ${spec.integrations.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * Compose the full system prompt. The examples are injected as a separate
 * section so they can be swapped/re-ordered without touching the principles.
 *
 * @param {{ examples?: any[], principles?: string }} opts
 * @returns {string}
 */
export function buildSystemPrompt({ examples = [], principles = ARCHITECTURE_PRINCIPLES } = {}) {
  const sections = [principles, OUTPUT_FORMAT_INSTRUCTIONS];

  if (examples.length > 0) {
    const formatted = examples.map(formatExampleForPrompt).join("\n\n");
    sections.push(
      `The following ${examples.length === 1 ? "example" : "examples"} show the depth and voice to match. Do not copy the content verbatim — use them as tone anchors.\n\n${formatted}`,
    );
  }

  sections.push(`Valid categories: ${BLUEPRINT_CATEGORIES.join(", ")}.`);

  return sections.join("\n\n");
}

/**
 * Compose the user-turn prompt (the spec restated as plain text).
 *
 * @param {any} spec - A validated BlueprintInput.
 * @returns {string}
 */
export function buildUserPrompt(spec) {
  return `Design an AWS architecture for the following project. Return the JSON object described in the system prompt.\n\n${formatSpecForPrompt(spec)}`;
}

export default {
  ARCHITECTURE_PRINCIPLES,
  OUTPUT_FORMAT_INSTRUCTIONS,
  buildSystemPrompt,
  buildUserPrompt,
  selectExamples,
  formatExampleForPrompt,
  formatSpecForPrompt,
};
