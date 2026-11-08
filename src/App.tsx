import { lazy, Suspense, useEffect, useRef } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import Navigation from './components/Navigation';
import Footer from './components/Footer';
import ScrollToTop from './components/ScrollToTop';
import ErrorBoundary from './components/ErrorBoundary';
import { BlogErrorFallback } from './components/ErrorFallbacks';
import ChatWidget from './components/chat/ChatWidget';
import ConsentBanner from './components/ConsentBanner';
import { getConsent } from './utils/consent';
import { enablePostHog, capturePostHogPageview } from './utils/posthog';
import { isRumInitialized, recordPageView, setUserContext, addBreadcrumb } from './utils/rum';
import { setSentryUserContext, addSentryBreadcrumb, enableSentry } from './utils/sentry';
import { getOrCreateDeviceId } from './utils/deviceId';

// Static import — critical first-load path
import Home from './pages/Home';

// Lazy-loaded page chunks
const About = lazy(() => import('./pages/About'));
const Altivum = lazy(() => import('./pages/Altivum'));
const Foundation = lazy(() => import('./pages/Foundation'));
const Podcast = lazy(() => import('./pages/Podcast'));
const BeyondTheAssessment = lazy(() => import('./pages/BeyondTheAssessment'));
const Blog = lazy(() => import('./pages/Blog'));
const BlogPost = lazy(() => import('./pages/BlogPost'));
const Links = lazy(() => import('./pages/Links'));
const Contact = lazy(() => import('./pages/Contact'));
const NewsletterConfirm = lazy(() => import('./pages/NewsletterConfirm'));
const Chat = lazy(() => import('./pages/Chat'));
const Privacy = lazy(() => import('./pages/Privacy'));
const AWS = lazy(() => import('./pages/AWS'));
const Claude = lazy(() => import('./pages/Claude'));
const Admin = lazy(() => import('./pages/Admin'));
const Blueprint = lazy(() => import('./pages/Blueprint'));
const NotFound = lazy(() => import('./pages/NotFound'));

const PageLoadingFallback = () => (
  <div
    className="min-h-screen bg-altivum-dark flex items-center justify-center"
    role="status"
    aria-label="Loading page"
  >
    <div
      className="w-8 h-8 border-2 border-altivum-gold/30 border-t-altivum-gold rounded-full animate-spin"
      aria-hidden="true"
    />
  </div>
);

/** Lowercase hex SHA-256, matching the backend's hashDeviceId digest exactly. */
async function sha256Hex(value: string): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

function App() {
  const location = useLocation();
  const isFullscreenPage = location.pathname === '/chat' || location.pathname === '/admin';

  // Re-enable cookie-based analytics on load for visitors who already consented
  // (all no-ops if unconfigured or consent wasn't granted). enablePostHog()
  // captures the entry pageview itself; the effect below captures subsequent SPA
  // navigations. RUM already runs cookieless from its module init; enableSentry()
  // starts Sentry (dormant until consent). New consent is handled by ConsentBanner.
  useEffect(() => {
    if (getConsent() === 'granted') {
      void enablePostHog();
      enableSentry();
    }
  }, []);

  // Set anonymous user context (device hash) for error tracking correlation.
  // No PII — only the SHA-256 hash of the localStorage device ID.
  // Forwarded to both RUM and Sentry for cross-service correlation.
  //
  // The raw device ID is the partition key for the visitor's stored chat memory
  // (lambda/chat-stream/memory.mjs hashes it into deviceHash), so it is a bearer
  // value and must not leave the browser. Hashing it here with the same SHA-256
  // yields the identical correlation ID the backend stores, so cross-service
  // lookups are unchanged. Without crypto.subtle (a non-secure context) there is
  // no correlation ID and we set none rather than falling back to the raw value.
  useEffect(() => {
    const deviceId = getOrCreateDeviceId();
    if (!deviceId) return;

    let cancelled = false;
    void (async () => {
      const deviceHash = await sha256Hex(deviceId);
      if (!deviceHash || cancelled) return;
      const ctx = { deviceId: deviceHash, sessionStart: new Date().toISOString() };
      setUserContext(ctx);
      setSentryUserContext(ctx);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // SPA pageview + breadcrumb tracking. Skip the first run (the entry pageview
  // is captured by enablePostHog) and capture on each subsequent route change.
  // RUM page views and breadcrumbs are recorded alongside PostHog pageviews.
  const isFirstNavigation = useRef(true);
  useEffect(() => {
    if (isFirstNavigation.current) {
      isFirstNavigation.current = false;
      return;
    }
    capturePostHogPageview();
    if (isRumInitialized) {
      recordPageView(location.pathname);
    }
    addBreadcrumb('navigation', `Navigated to ${location.pathname}`);
    addSentryBreadcrumb('navigation', `Navigated to ${location.pathname}`);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-altivum-dark">
      <ScrollToTop />
      <Navigation />
      <main id="main-content">
        {/* Keyed by pathname so a render-time throw (e.g. a stale lazy chunk)
            clears on client-side navigation instead of trapping the user until
            a full reload. React remounts a fresh boundary per path. */}
        <ErrorBoundary key={location.pathname}>
          <Suspense fallback={<PageLoadingFallback />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/about" element={<About />} />
              <Route path="/altivum" element={<Altivum />} />
              <Route path="/foundation" element={<Foundation />} />
              <Route path="/podcast" element={<Podcast />} />
              <Route path="/beyond-the-assessment" element={<BeyondTheAssessment />} />
              <Route
                path="/blog"
                element={
                  <ErrorBoundary fallback={<BlogErrorFallback />} pageName="Blog">
                    <Blog />
                  </ErrorBoundary>
                }
              />
              <Route
                path="/blog/:slug"
                element={
                  <ErrorBoundary fallback={<BlogErrorFallback />} pageName="Blog Post">
                    <BlogPost />
                  </ErrorBoundary>
                }
              />
              <Route path="/links" element={<Links />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/newsletter/confirm" element={<NewsletterConfirm />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/aws" element={<AWS />} />
              <Route path="/claude" element={<Claude />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/blueprint" element={<Blueprint />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
      {!isFullscreenPage && <Footer />}
      {!isFullscreenPage && <ChatWidget />}
      <ConsentBanner />
    </div>
  );
}

export default App;
