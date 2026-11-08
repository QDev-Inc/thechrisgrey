import { describe, it, expect, vi } from 'vitest';
import { trackEvent } from './analytics';
import { capturePostHogEvent } from './posthog';
vi.mock('./posthog', () => ({ capturePostHogEvent: vi.fn() }));
describe('trackEvent', () => {
  it('sends conversion events through the consent-gated provider', () => {
    trackEvent('Newsletter Confirmation Requested', { source: 'home' });
    expect(capturePostHogEvent).toHaveBeenCalledWith('Newsletter Confirmation Requested', { source: 'home' });
  });
});
