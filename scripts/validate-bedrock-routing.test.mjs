import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const template = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../infra/personal-account-services.yaml'),
  'utf8',
);
const haiku = 'anthropic.claude-haiku-4-5-20251001-v1:0';
const opus = 'anthropic.claude-opus-4-6-v1';

describe('Bedrock inference profile routing permissions', () => {
  for (const [role, models] of [
    ['ChatStreamRole', [haiku, opus]],
    ['BlueprintRole', [haiku, opus]],
    ['McpServerRole', [haiku]],
  ]) {
    it(`${role} permits the configured models in every destination region`, () => {
      const policy = template.split(`  ${role}:`)[1].split(/\n {2}\w+:/)[0];
      for (const model of models) {
        for (const region of ['us-east-1', 'us-east-2', 'us-west-2']) {
          expect(policy).toContain(`bedrock:${region}::foundation-model/${model}`);
        }
      }
      expect(policy).not.toContain('foundation-model/*');
    });
  }
});
