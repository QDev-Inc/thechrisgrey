import { capturePostHogEvent } from './posthog';

export type PlausibleProps = Record<string, string | number | boolean>;

export function trackEvent(event: string, props?: PlausibleProps): void {
  capturePostHogEvent(event, props);
}
