import { redact } from './logger';

export function sanitizeTelemetry<T>(value: T): T {
  function clean(input: unknown, key = ''): unknown {
    if (/^(authorization|cookie|password|secret|token|confirmationToken|subject|message|body|draft)$/i.test(key)) {
      return '[REDACTED]';
    }
    if (typeof input === 'string') {
      return input.replace(/https?:\/\/[^\s"'<>]+/g, (raw) => {
        try {
          const url = new URL(raw);
          return `${url.origin}${url.pathname}`;
        } catch {
          return '[URL]';
        }
      });
    }
    if (Array.isArray(input)) return input.map((item) => clean(item));
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input).map(([name, item]) => [name, clean(item, name)]));
    }
    return input;
  }
  return redact(clean(value)) as T;
}
