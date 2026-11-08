import { useState, useEffect, useRef } from 'react';
import { typography } from '../utils/typography';
import { getConsent, setConsent } from '../utils/consent';
import { isPostHogConfigured, enablePostHog } from '../utils/posthog';
import { grantRumCookies, revokeRumCookies } from '../utils/rum';
import { enableSentry } from '../utils/sentry';
import { isPrerender } from '../utils/prerender';
import ViewTransitionLink from './ViewTransitionLink';

/**
 * Opt-in consent banner for cookie-based analytics (PostHog).
 *
 * Shows only when PostHog is configured AND the visitor hasn't chosen yet. It is
 * client-only (gated behind a mount effect) so it never serializes into the
 * prerendered HTML. Accept initializes PostHog; Decline keeps the site cookie-free.
 * Non-modal and positioned bottom-left so it doesn't cover the chat widget.
 */
const ConsentBanner = () => {
  // Computed once at mount (no effect). isPrerender() short-circuits before any
  // localStorage access so the banner never serializes into prerendered HTML.
  const [visible, setVisible] = useState(() => !isPrerender() && isPostHogConfigured() && getConsent() === null);

  const bannerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!visible) return;
    const update = () => {
      const offset = window.innerWidth < 640 ? (bannerRef.current?.getBoundingClientRect().height || 0) + 24 : 0;
      document.documentElement.style.setProperty('--consent-bottom', `${offset}px`);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (bannerRef.current) observer?.observe(bannerRef.current);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      document.documentElement.style.removeProperty('--consent-bottom');
    };
  }, [visible]);

  if (!visible) return null;

  const accept = () => {
    setConsent('granted');
    void enablePostHog();
    // RUM is already running cookieless; upgrade it to cookie-backed sessions.
    grantRumCookies();
    enableSentry();
    setVisible(false);
  };

  const decline = () => {
    setConsent('denied');
    // Ensure RUM stays cookieless and purge any cookies set this session.
    revokeRumCookies();
    setVisible(false);
  };

  return (
    <div
      ref={bannerRef}
      role="region"
      aria-label="Analytics consent"
      className="fixed bottom-3 left-3 right-3 sm:right-auto sm:max-w-sm z-[60] rounded-lg border border-altivum-gold/20 bg-altivum-navy p-5 shadow-[0_8px_40px_rgba(0,0,0,0.45)]"
    >
      <div className="inline-block px-3 py-0.5 bg-altivum-gold/10 border border-altivum-gold/20 rounded-full mb-3">
        <span className="text-altivum-gold text-[11px] uppercase tracking-widest font-medium">Analytics</span>
      </div>
      <p className="text-altivum-silver mb-4" style={typography.smallText}>
        Allow optional analytics to help improve the site? Message content and form fields are never recorded.{' '}
        <ViewTransitionLink to="/privacy" className="text-altivum-gold/90 hover:text-altivum-gold underline">
          Privacy policy
        </ViewTransitionLink>
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={accept}
          className="flex-1 min-h-[44px] px-4 py-2 bg-altivum-gold text-altivum-dark text-sm font-medium rounded-md hover:shadow-[0_0_20px_rgba(197,165,114,0.3)] active:scale-[0.98] transition-all duration-200 touch-manipulation focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-altivum-gold focus-visible:outline-offset-2"
        >
          Accept
        </button>
        <button
          type="button"
          onClick={decline}
          className="flex-1 min-h-[44px] px-4 py-2 border border-white/15 text-altivum-silver text-sm rounded-md hover:bg-white/5 active:scale-[0.98] transition-all duration-200 touch-manipulation focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-altivum-gold focus-visible:outline-offset-2"
        >
          Decline
        </button>
      </div>
    </div>
  );
};

export default ConsentBanner;
