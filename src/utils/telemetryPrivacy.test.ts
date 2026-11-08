import { expect, it } from 'vitest';
import { sanitizeTelemetry } from './telemetryPrivacy';

it('removes URL queries, fragments, credentials, and form content before telemetry leaves the browser', () => {
  const event = {
    request: { url: 'https://example.com/contact?message=private#token' },
    authorization: 'Bearer secret',
    draft: 'private text',
    extra: { email: 'person@example.com' },
  };
  const clean = sanitizeTelemetry(event);
  expect(clean.request.url).toBe('https://example.com/contact');
  expect(clean.authorization).toBe('[REDACTED]');
  expect(clean.draft).toBe('[REDACTED]');
  expect(clean.extra.email).toBe('[REDACTED]');
  expect(event.draft).toBe('private text');
});
