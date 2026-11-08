import { useEffect, useState } from 'react';
import { SEO } from '../components/SEO';
import ViewTransitionLink from '../components/ViewTransitionLink';
import { typography } from '../utils/typography';
import { withTraceId } from '../utils/traceId';

export default function NewsletterConfirm() {
  const [token] = useState(() => window.location.hash.slice(1));
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('Confirm that you want to receive the updates you requested.');

  useEffect(() => {
    window.history.replaceState(window.history.state, '', window.location.pathname);
  }, []);

  const confirm = async () => {
    setStatus('loading');
    try {
      const response = await fetch(
        import.meta.env.VITE_NEWSLETTER_ENDPOINT,
        withTraceId({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmationToken: token }),
          signal: AbortSignal.timeout(10000),
        }),
      );
      if (!response.ok) throw new Error('Confirmation failed');
      const result = await response.json();
      setStatus('success');
      setMessage(
        result.source === 'blueprint'
          ? "You're on the Blueprint waitlist. We'll email you when there's news."
          : 'Your subscription is confirmed. Look out for new articles in your inbox.',
      );
    } catch {
      setStatus('error');
      setMessage(
        'This link may have expired or already been used. Please request a new confirmation from the signup form.',
      );
    }
  };

  return (
    <section className="min-h-[70vh] px-6 pt-36 pb-20 max-w-2xl mx-auto">
      <SEO
        title="Confirm your subscription"
        description="Confirm your newsletter or Blueprint waitlist subscription."
        url="https://thechrisgrey.com/newsletter/confirm"
        noindex
      />
      <h1 className="text-white mb-6" style={typography.sectionHeader}>
        {status === 'success' ? 'You’re confirmed' : 'Confirm your subscription'}
      </h1>
      <p className="text-altivum-silver mb-8" style={typography.bodyText} role="status">
        {token ? message : 'Open the confirmation link from your email to finish subscribing.'}
      </p>
      {token && (status === 'idle' || status === 'loading') && (
        <button
          onClick={confirm}
          disabled={status === 'loading'}
          className="min-h-12 rounded-lg bg-altivum-gold px-6 py-3 font-medium text-altivum-dark disabled:opacity-60"
        >
          {status === 'loading' ? 'Confirming…' : 'Confirm subscription'}
        </button>
      )}
      {(status === 'success' || status === 'error' || !token) && (
        <ViewTransitionLink to="/" className="text-altivum-gold underline">
          Return home
        </ViewTransitionLink>
      )}
    </section>
  );
}
