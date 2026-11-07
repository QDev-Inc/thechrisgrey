#!/usr/bin/env node

// Generates a markdown API reference from the OpenAPI YAML specs in
// lambda/{service}/openapi.yaml files.
//
// Reads each spec, extracts paths, methods, auth requirements, request/response
// schemas, and status codes, then writes a consolidated markdown reference to
// docs/api/lambda-api-reference.md.
//
// Usage:
//   node scripts/generate-openapi-docs.mjs
//
// The output is a human-readable summary suitable for onboarding and quick
// reference. For the full interactive spec, use the YAML files directly or
// import them into Swagger UI / Redoc.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SPECS = [
  'lambda/chat-stream/openapi.yaml',
  'lambda/blueprint/openapi.yaml',
  'lambda/kb-builder/openapi.yaml',
  'lambda/kb-sync/openapi.yaml',
  'lambda/metrics/openapi.yaml',
  'lambda/mcp-server/openapi.yaml',
  'lambda/session-token/openapi.yaml',
  'lambda/contact-email/openapi.yaml',
  'lambda/newsletter-subscription/openapi.yaml',
  'src/openapi.yaml',
];

const OUTPUT_DIR = join(ROOT, 'docs', 'api');
const OUTPUT_FILE = join(OUTPUT_DIR, 'lambda-api-reference.md');

/** @param {string} specPath @returns {{title: string, version: string, description: string, paths: any, servers: any, components: any}} */
function loadSpec(specPath) {
  const raw = readFileSync(join(ROOT, specPath), 'utf-8');
  return parse(raw);
}

/** @param {string} method @returns {string} */
function methodBadge(method) {
  const badges = { get: 'GET', post: 'POST', put: 'PUT', delete: 'DELETE', options: 'OPTIONS' };
  return badges[method.toLowerCase()] || method.toUpperCase();
}

/** @param {any} schema @param {number} indent @returns {string} */
function formatSchema(schema, indent = 0) {
  if (!schema) return '*No schema*';
  const pad = '  '.repeat(indent);
  let out = '';

  if (schema.$ref) {
    return `${pad}See \`${schema.$ref}\``;
  }

  if (schema.type === 'object' && schema.properties) {
    out += `${pad}**Object**\n`;
    for (const [key, prop] of Object.entries(schema.properties)) {
      const required = schema.required?.includes(key) ? ' (required)' : '';
      out += `${pad}- \`${key}\`${required}: ${prop.type || 'any'}`;
      if (prop.description) out += ` - ${prop.description}`;
      if (prop.enum) out += ` (enum: ${prop.enum.join(', ')})`;
      out += '\n';
      if (prop.type === 'object' && prop.properties) {
        out += formatSchema(prop, indent + 2);
      }
    }
    return out;
  }

  if (schema.type === 'array' && schema.items) {
    out += `${pad}**Array** of:\n`;
    out += formatSchema(schema.items, indent + 1);
    return out;
  }

  return `${pad}${schema.type || 'any'}${schema.format ? ` (${schema.format})` : ''}`;
}

/** @param {any} op @returns {string} */
function formatAuth(op) {
  if (!op.security || op.security.length === 0) return 'None (public)';
  return op.security.map((s) => Object.keys(s).join(', ')).join(' | ');
}

/** @param {{title: string, version: string, description: string, paths: any, servers: any, components: any}} spec @param {string} specPath @returns {string} */
function specToMarkdown(spec, specPath) {
  const serviceName = specPath.split('/')[1];
  let md = `## ${spec.info.title}\n\n`;
  md += `**Service:** \`lambda/${serviceName}\`  \n`;
  md += `**Version:** ${spec.info.version}  \n`;
  if (spec.servers?.[0]?.url) {
    md += `**Base URL:** ${spec.servers[0].url}\n\n`;
  }
  if (spec.info.description) {
    md += `${spec.info.description}\n\n`;
  }

  if (!spec.paths || Object.keys(spec.paths).length === 0) {
    md += '*No endpoints defined.*\n\n';
    return md;
  }

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    md += `### \`${path}\`\n\n`;
    if (pathItem.description) {
      md += `${pathItem.description}\n\n`;
    }

    for (const method of ['get', 'post', 'put', 'delete', 'options']) {
      const op = pathItem[method];
      if (!op) continue;

      md += `#### ${methodBadge(method)}`;
      if (op.operationId) md += ` - \`${op.operationId}\``;
      md += '\n\n';

      if (op.summary) md += `**Summary:** ${op.summary}  \n`;
      if (op.description) md += `**Description:** ${op.description}  \n`;
      md += `**Auth:** ${formatAuth(op)}\n\n`;

      if (op.parameters?.length) {
        md += '**Parameters:**\n\n';
        md += '| Name | In | Required | Type | Description |\n';
        md += '|------|-----|----------|------|-------------|\n';
        for (const p of op.parameters) {
          md += `| \`${p.name}\` | ${p.in} | ${p.required ? 'Yes' : 'No'} | ${p.schema?.type || 'any'} | ${p.description || ''} |\n`;
        }
        md += '\n';
      }

      if (op.requestBody) {
        md += '**Request Body:**\n\n';
        const content = op.requestBody.content;
        if (content) {
          for (const [mediaType, mediaInfo] of Object.entries(content)) {
            md += `*Content-Type:* \`${mediaType}\`\n\n`;
            md += formatSchema(mediaInfo.schema);
            md += '\n';
          }
        }
        md += '\n';
      }

      if (op.responses) {
        md += '**Responses:**\n\n';
        md += '| Status | Description | Content-Type |\n';
        md += '|--------|-------------|--------------|\n';
        for (const [code, resp] of Object.entries(op.responses)) {
          const contentTypes = resp.content ? Object.keys(resp.content).join(', ') : 'N/A';
          md += `| ${code} | ${resp.description || ''} | ${contentTypes} |\n`;
        }
        md += '\n';
      }
    }
  }

  if (spec.components?.securitySchemes) {
    md += '### Authentication Schemes\n\n';
    for (const [name, scheme] of Object.entries(spec.components.securitySchemes)) {
      md += `- **${name}**: ${scheme.type}`;
      if (scheme.description) md += ` - ${scheme.description}`;
      md += '\n';
    }
    md += '\n';
  }

  return md;
}

// Main
console.log('Generating Lambda API reference from OpenAPI specs...');

let markdown = '# Lambda API Reference\n\n';
markdown += '> Auto-generated from `lambda/*/openapi.yaml` specs by `scripts/generate-openapi-docs.mjs`.\n';
markdown += '> Do not edit manually - run `npm run docs:openapi` to regenerate.\n\n';
markdown += `> Generated: ${new Date().toISOString()}\n\n`;
markdown += '---\n\n';

let specCount = 0;
for (const specPath of SPECS) {
  try {
    const spec = loadSpec(specPath);
    markdown += specToMarkdown(spec, specPath);
    markdown += '---\n\n';
    specCount++;
    console.log(`  Parsed: ${specPath}`);
  } catch (err) {
    console.warn(`  Skipped: ${specPath} - ${err.message}`);
  }
}

markdown += '## Notes\n\n';
markdown +=
  '- `lambda/kb-sync/openapi.yaml` documents the S3 event trigger schema and health check mode (not a traditional HTTP API).\n';
markdown += '- `src/openapi.yaml` documents the frontend health endpoint and references consumed Lambda APIs.\n';
markdown +=
  '- For interactive exploration, import the YAML files into [Swagger UI](https://swagger.io/tools/swagger-ui/) or [Redoc](https://redocly.com/redoc/).\n';

mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(OUTPUT_FILE, markdown);
console.log(`\nWrote ${specCount} API specs to ${OUTPUT_FILE}`);
console.log('Done.');
