import { useState, type FormEvent } from 'react';
import { typography } from '../../utils/typography';
import { isValidEmail } from '../../utils/validators';
import { withTraceId } from '../../utils/traceId';
import { getTurnstileToken } from '../../utils/turnstile';
import Icon from '../icons/Icon';

interface WaitlistProps {
  heading?: string;
  subheading?: string;
  compact?: boolean;
}

type Status = { kind: 'idle' } | { kind: 'loading' } | { kind: 'success' } | { kind: 'error'; message: string };

const NEWSLETTER_ENDPOINT = import.meta.env.VITE_NEWSLETTER_ENDPOINT || '';

export function Waitlist({
  heading = 'Join the Blueprint waitlist',
  subheading = 'Get early access to Pro tier: higher limits, private blueprints, and priority generation.',
  compact = false,
}: WaitlistProps) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (!isValidEmail(email)) {
      setStatus({ kind: 'error', message: 'Please enter a valid email address.' });
      return;
    }

    if (!NEWSLETTER_ENDPOINT) {
      setStatus({
        kind: 'error',
        message: 'Waitlist is not configured yet. Please try again later.',
      });
      return;
    }

    setStatus({ kind: 'loading' });

    let timeoutId: number | undefined;

    try {
      const turnstileToken = await getTurnstileToken('newsletter');
      const controller = new AbortController();
      timeoutId = window.setTimeout(() => controller.abort(), 10_000);
      const response = await fetch(
        NEWSLETTER_ENDPOINT,
        withTraceId({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), source: 'blueprint', turnstileToken }),
          signal: controller.signal,
        }),
      );

      if (response.ok) {
        setEmail('');
        setStatus({ kind: 'success' });
        return;
      }

      if (response.status === 429) {
        setStatus({
          kind: 'error',
          message: 'Too many attempts. Please try again in a few minutes.',
        });
        return;
      }

      let message = 'Something went wrong. Please try again.';
      try {
        const body = (await response.json()) as { error?: string; message?: string };
        if (body?.error) message = body.error;
        else if (body?.message) message = body.message;
      } catch {
        // swallow JSON parse failure
      }
      setStatus({ kind: 'error', message });
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        setStatus({ kind: 'error', message: 'Request timed out. Please try again.' });
      } else {
        setStatus({
          kind: 'error',
          message: 'Network error. Please check your connection and try again.',
        });
      }
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
    }
  };

  const isLoading = status.kind === 'loading';
  const padding = compact ? 'p-5' : 'p-6';

  return (
    <div
      className={`rounded-lg border border-altivum-gold/20 bg-linear-to-br from-altivum-navy/80 to-altivum-blue/40 ${padding}`}
    >
      {heading && (
        <h3 className="text-white mb-2" style={compact ? typography.cardTitleSmall : typography.cardTitleLarge}>
          {heading}
        </h3>
      )}
      {subheading && (
        <p className="text-altivum-silver mb-4" style={typography.bodyText}>
          {subheading}
        </p>
      )}

      {status.kind === 'success' ? (
        <div className="flex items-start gap-2 text-emerald-300" style={typography.bodyText} role="status">
          <Icon name="mark_email_read" className="text-sm mt-0.5" aria-hidden="true" />
          <span>Check your inbox and confirm your email to join the Blueprint waitlist.</span>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
          <label htmlFor="blueprint-waitlist-email" className="sr-only">
            Email address
          </label>
          <input
            id="blueprint-waitlist-email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (status.kind === 'error') setStatus({ kind: 'idle' });
            }}
            placeholder="you@example.com"
            disabled={isLoading}
            required
            className="flex-1 px-4 py-2.5 bg-altivum-dark border border-white/10 rounded-md text-white placeholder:text-altivum-silver/60 focus:outline-hidden focus:border-altivum-gold/50 focus:ring-1 focus:ring-altivum-gold/30 transition-colors disabled:opacity-60"
            aria-invalid={status.kind === 'error'}
            aria-describedby={status.kind === 'error' ? 'blueprint-waitlist-error' : undefined}
          />
          <button
            type="submit"
            disabled={isLoading}
            className={`inline-flex items-center justify-center px-5 py-2.5 rounded-md border transition-colors ${
              isLoading
                ? 'border-white/10 bg-altivum-slate/40 text-altivum-silver cursor-not-allowed'
                : 'border-altivum-gold/60 bg-altivum-gold text-altivum-dark hover:bg-white hover:border-white'
            }`}
            style={typography.smallText}
          >
            {isLoading && (
              <span
                className="w-4 h-4 mr-2 border-2 border-altivum-dark/40 border-t-altivum-dark rounded-full animate-spin"
                aria-hidden="true"
              />
            )}
            {isLoading ? 'Joining…' : 'Join waitlist'}
          </button>
        </form>
      )}

      {status.kind === 'error' && (
        <p id="blueprint-waitlist-error" className="mt-3 text-rose-300" style={typography.smallText} role="alert">
          {status.message}
        </p>
      )}
    </div>
  );
}

export default Waitlist;
