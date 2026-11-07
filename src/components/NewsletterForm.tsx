import { useState, useEffect, FormEvent } from 'react';
import { typography } from '../utils/typography';
import { isValidEmail } from '../utils/validators';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { trackEvent } from '../utils/analytics';
import { createLogger } from '../utils/logger';
import { withTraceId } from '../utils/traceId';
import { getTurnstileToken } from '../utils/turnstile';
import { slugify } from '../utils/slugify';
import Icon from './icons/Icon';

const log = createLogger('NewsletterForm');

interface NewsletterFormProps {
  variant?: 'full' | 'compact';
  /**
   * Which surface the form is mounted on (e.g. 'home', 'about', 'podcast').
   * Sent as a Plausible prop on the "Newsletter Subscribe" goal so signups can
   * be attributed to the page that drove them.
   */
  source?: string;
}

const NewsletterForm = ({ variant = 'full', source }: NewsletterFormProps) => {
  const [subscribeEmail, setSubscribeEmail] = useState('');
  const [subscribeStatus, setSubscribeStatus] = useState<{
    type: 'idle' | 'loading' | 'success' | 'error';
    message: string;
  }>({ type: 'idle', message: '' });
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const { containerRef: modalRef, handleKeyDown: handleModalKeyDown } = useFocusTrap(showSuccessModal);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showSuccessModal) {
        setShowSuccessModal(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [showSuccessModal]);

  const handleSubscribe = async (e: FormEvent) => {
    e.preventDefault();

    if (!isValidEmail(subscribeEmail)) {
      setSubscribeStatus({ type: 'error', message: 'Please enter a valid email address' });
      return;
    }

    setSubscribeStatus({ type: 'loading', message: 'Subscribing...' });

    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      const turnstileToken = await getTurnstileToken();
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 10_000);
      const response = await fetch(
        import.meta.env.VITE_NEWSLETTER_ENDPOINT,
        withTraceId({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: subscribeEmail.trim(),
            turnstileToken,
          }),
          signal: controller.signal,
        }),
      );

      const result = await response.json();

      if (response.ok) {
        setSubscribeEmail('');
        setSubscribeStatus({ type: 'idle', message: '' });
        setShowSuccessModal(true);
        trackEvent('Newsletter Subscribe', source ? { source } : undefined);
      } else if (response.status === 429) {
        setSubscribeStatus({
          type: 'error',
          message: 'Too many subscription attempts. Please try again later.',
        });
      } else {
        setSubscribeStatus({
          type: 'error',
          message: result.error || 'Failed to subscribe. Please try again.',
        });
      }
    } catch (error) {
      log.error('subscribe_failed', { error: error instanceof Error ? error.message : String(error) });
      if (error instanceof Error && error.name === 'AbortError') {
        setSubscribeStatus({
          type: 'error',
          message: 'Request timed out. Please try again.',
        });
      } else {
        setSubscribeStatus({
          type: 'error',
          message: 'Network error. Please check your connection and try again.',
        });
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  const inputId = variant === 'full' ? 'newsletter-email-full' : 'newsletter-email-compact';

  return (
    <>
      {variant === 'full' ? (
        <section className="py-32 bg-linear-to-b from-altivum-dark via-altivum-navy to-altivum-dark border-t border-white/5">
          <div className="max-w-4xl mx-auto px-6 lg:px-8 text-center">
            <div className="mb-8">
              <div className="inline-block px-4 py-1 bg-altivum-gold/10 border border-altivum-gold/20 rounded-full mb-6">
                <span className="text-altivum-gold text-xs uppercase tracking-widest font-medium">Newsletter</span>
              </div>
              <h2 id={slugify('Stay Informed')} className="text-white mb-6" style={typography.sectionHeader}>
                Stay Informed
              </h2>
              <p className="text-altivum-silver mb-12 max-w-2xl mx-auto" style={typography.bodyText}>
                Subscribe to receive new articles directly to your inbox. No spam, just valuable insights on leadership,
                technology, and growth.
              </p>
            </div>

            <form className="flex flex-col sm:flex-row gap-4 max-w-2xl mx-auto mb-8" onSubmit={handleSubscribe}>
              <div className="flex-1 relative group">
                <input
                  id={inputId}
                  type="email"
                  placeholder="Enter your email address"
                  value={subscribeEmail}
                  onChange={(e) => {
                    setSubscribeEmail(e.target.value);
                    if (subscribeStatus.type === 'error') {
                      setSubscribeStatus({ type: 'idle', message: '' });
                    }
                  }}
                  required
                  disabled={subscribeStatus.type === 'loading'}
                  className="w-full px-6 py-5 bg-white/5 border-2 border-white/10 text-white placeholder-white/70 focus:outline-hidden focus:border-altivum-gold focus:bg-white/10 transition-all duration-300 rounded-xs disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>
              <button
                type="submit"
                disabled={subscribeStatus.type === 'loading'}
                className={`group relative px-10 py-5 font-medium uppercase tracking-wider text-sm overflow-hidden transition-all duration-300 whitespace-nowrap ${
                  subscribeStatus.type === 'loading'
                    ? 'bg-altivum-slate/50 text-altivum-silver cursor-not-allowed'
                    : 'bg-altivum-gold text-altivum-dark hover:bg-white hover:shadow-[0_0_30px_rgba(197,165,114,0.3)]'
                }`}
              >
                <span className="relative z-10">
                  {subscribeStatus.type === 'loading' ? 'Subscribing...' : 'Subscribe'}
                </span>
                {subscribeStatus.type !== 'loading' && (
                  <span className="absolute inset-0 bg-white transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left"></span>
                )}
              </button>
            </form>

            {subscribeStatus.message && (
              <div
                className={`mt-8 p-5 rounded-xs backdrop-blur-xs max-w-2xl mx-auto transition-all duration-300 ${
                  subscribeStatus.type === 'success'
                    ? 'bg-green-900/30 border-l-4 border-green-500 text-green-300'
                    : subscribeStatus.type === 'error'
                      ? 'bg-red-900/30 border-l-4 border-red-500 text-red-300'
                      : 'bg-altivum-blue/30 border-l-4 border-altivum-gold text-altivum-gold'
                }`}
                role="alert"
              >
                {subscribeStatus.message}
              </div>
            )}

            <p className="text-xs text-altivum-silver/50 mt-8 uppercase tracking-wider">
              We respect your privacy. Unsubscribe at any time.
            </p>
          </div>
        </section>
      ) : (
        <div>
          <form className="flex flex-col sm:flex-row gap-3 max-w-lg mx-auto" onSubmit={handleSubscribe}>
            <div className="flex-1">
              <input
                id={inputId}
                type="email"
                placeholder="Enter your email address"
                value={subscribeEmail}
                onChange={(e) => {
                  setSubscribeEmail(e.target.value);
                  if (subscribeStatus.type === 'error') {
                    setSubscribeStatus({ type: 'idle', message: '' });
                  }
                }}
                required
                disabled={subscribeStatus.type === 'loading'}
                className="w-full px-5 py-3 bg-white/5 border border-white/10 text-white placeholder-white/70 focus:outline-hidden focus:border-altivum-gold focus:bg-white/10 transition-all duration-300 rounded-xs disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={subscribeStatus.type === 'loading'}
              className={`px-8 py-3 font-medium uppercase tracking-wider text-sm transition-all duration-300 whitespace-nowrap ${
                subscribeStatus.type === 'loading'
                  ? 'bg-altivum-slate/50 text-altivum-silver cursor-not-allowed'
                  : 'bg-altivum-gold text-altivum-dark hover:bg-white'
              }`}
            >
              {subscribeStatus.type === 'loading' ? 'Subscribing...' : 'Subscribe'}
            </button>
          </form>

          {subscribeStatus.message && (
            <div
              className={`mt-4 p-3 rounded-xs text-sm max-w-lg mx-auto transition-all duration-300 ${
                subscribeStatus.type === 'error'
                  ? 'bg-red-900/30 border-l-4 border-red-500 text-red-300'
                  : 'bg-altivum-blue/30 border-l-4 border-altivum-gold text-altivum-gold'
              }`}
              role="alert"
            >
              {subscribeStatus.message}
            </div>
          )}
        </div>
      )}

      {/* Success Modal */}
      {showSuccessModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-xs"
            onClick={() => setShowSuccessModal(false)}
          ></div>
          <div
            ref={modalRef}
            onKeyDown={handleModalKeyDown}
            role="dialog"
            aria-modal="true"
            aria-labelledby="newsletter-modal-title"
            className="relative bg-linear-to-br from-altivum-navy to-altivum-blue max-w-md w-full p-8 border-2 border-altivum-gold/30 shadow-[0_0_60px_rgba(197,165,114,0.2)]"
          >
            <button
              onClick={() => setShowSuccessModal(false)}
              className="absolute top-4 right-4 text-altivum-silver hover:text-white transition-colors"
              aria-label="Close"
            >
              <Icon name="close" className="text-2xl" />
            </button>

            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-altivum-gold/10 border-2 border-altivum-gold mb-6">
                <Icon name="mark_email_read" className="text-altivum-gold text-4xl" />
              </div>

              <h3 id="newsletter-modal-title" className="text-white mb-4" style={typography.cardTitleLarge}>
                Thank You for Subscribing!
              </h3>

              <p className="text-altivum-silver mb-8" style={typography.bodyText}>
                Check your email for a confirmation message. Be sure to check your spam folder and move it to your
                primary inbox if needed.
              </p>

              <button
                onClick={() => setShowSuccessModal(false)}
                className="px-8 py-3 bg-altivum-gold text-altivum-dark font-medium uppercase tracking-wider text-sm hover:bg-white transition-colors duration-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default NewsletterForm;
