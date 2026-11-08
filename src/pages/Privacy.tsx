import { useState } from 'react';
import { SEO } from '../components/SEO';
import Breadcrumbs from '../components/Breadcrumbs';
import { typography } from '../utils/typography';
import ViewTransitionLink from '../components/ViewTransitionLink';
import { buildWebPageSchema } from '../utils/schemas';
import { clearConsent, getConsent } from '../utils/consent';
import { disablePostHog, isPostHogConfigured } from '../utils/posthog';
import { revokeRumCookies } from '../utils/rum';
import { disableSentry } from '../utils/sentry';
import { isPrerender } from '../utils/prerender';
import { slugify } from '../utils/slugify';
import Icon from '../components/icons/Icon';

const breadcrumbs = [
  { name: 'Home', url: 'https://thechrisgrey.com' },
  { name: 'Privacy Policy', url: 'https://thechrisgrey.com/privacy' },
];

const Privacy = () => {
  const lastUpdated = 'November 7, 2026';

  // The reset control is only meaningful once the visitor has actually opted in
  // to PostHog. Computed once at mount (lazy initializer, no effect). isPrerender()
  // short-circuits before any localStorage access so the button never serializes
  // into the prerendered HTML — same client-only pattern as ConsentBanner.
  const [showResetPreference] = useState(() => !isPrerender() && isPostHogConfigured() && getConsent() === 'granted');

  const resetAnalyticsPreference = () => {
    clearConsent();
    disablePostHog();
    // Return RUM to cookieless and purge its cookies; tear down Sentry.
    revokeRumCookies();
    disableSentry();
    window.location.reload();
  };

  return (
    <div className="min-h-screen pt-20">
      <SEO
        title="Privacy Policy"
        description="Privacy policy for thechrisgrey.com: what data is collected, how it is used and protected, the cookie-free analytics in use, and the choices available to you."
        url="https://thechrisgrey.com/privacy"
        breadcrumbs={breadcrumbs}
        structuredData={[
          buildWebPageSchema({
            name: 'Privacy Policy - Christian Perez',
            description:
              'Privacy policy for thechrisgrey.com - how we collect, use, and protect your personal information.',
            url: 'https://thechrisgrey.com/privacy',
            breadcrumbs,
          }),
        ]}
      />

      {/* Visible breadcrumb trail — mirrors the BreadcrumbList JSON-LD emitted
          by <SEO> above. Ancestors are SPA-transition links; the current page
          carries aria-current="page". The wrapper's `pt-20` clears the fixed
          nav, so this bar only adds bottom spacing before the hero. */}
      <div className="pb-3 max-w-7xl mx-auto px-6 lg:px-8">
        <Breadcrumbs items={breadcrumbs} />
      </div>

      {/* Hero Section */}
      <section className="py-32 bg-altivum-dark">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="max-w-4xl">
            <h1 className="text-white mb-6" style={typography.heroHeader}>
              Privacy Policy
            </h1>
            <div className="h-px w-24 bg-altivum-gold mb-8"></div>
            <p className="text-altivum-silver" style={typography.bodyText}>
              Last updated: {lastUpdated}
            </p>
          </div>
        </div>
      </section>

      {/* Policy Content */}
      <section className="py-24 bg-altivum-dark">
        <div className="max-w-4xl mx-auto px-6 lg:px-8">
          <div className="space-y-12">
            {/* Introduction */}
            <div>
              <h2 id={slugify('Introduction')} className="text-white mb-4" style={typography.sectionHeader}>
                Introduction
              </h2>
              <p className="text-altivum-silver" style={typography.bodyText}>
                This Privacy Policy explains how Christian Perez and Altivum Inc. ("we," "us," or "our") collect, use,
                and protect your personal information when you visit thechrisgrey.com (the "Site"). We are committed to
                protecting your privacy and being transparent about our data practices.
              </p>
            </div>

            {/* Information We Collect */}
            <div>
              <h2 id={slugify('Information We Collect')} className="text-white mb-4" style={typography.sectionHeader}>
                Information We Collect
              </h2>
              <div className="space-y-6">
                <div>
                  <h3
                    id={slugify('Information You Provide')}
                    className="text-white mb-2"
                    style={typography.cardTitleSmall}
                  >
                    Information You Provide
                  </h3>
                  <ul className="text-altivum-silver space-y-2" style={typography.bodyText}>
                    <li className="flex items-start">
                      <span className="text-altivum-gold mr-3" aria-hidden="true">
                        •
                      </span>
                      <span>
                        <strong className="text-white">Contact Form:</strong> Name, email address, subject, and message
                        content when you reach out to us.
                      </span>
                    </li>
                    <li className="flex items-start">
                      <span className="text-altivum-gold mr-3" aria-hidden="true">
                        •
                      </span>
                      <span>
                        <strong className="text-white">Newsletter:</strong> Email address if you subscribe to updates.
                      </span>
                    </li>
                    <li className="flex items-start">
                      <span className="text-altivum-gold mr-3" aria-hidden="true">
                        •
                      </span>
                      <span>
                        <strong className="text-white">AI Chat:</strong> Messages you send when using the chat feature.
                        These are processed to generate responses but are not permanently stored.
                      </span>
                    </li>
                  </ul>
                </div>
                <div>
                  <h3
                    id={slugify('Information Collected Automatically')}
                    className="text-white mb-2"
                    style={typography.cardTitleSmall}
                  >
                    Information Collected Automatically
                  </h3>
                  <p className="text-altivum-silver" style={typography.bodyText}>
                    When you visit the Site, we may automatically collect standard web server log information, including
                    your IP address, browser type, device information, and pages visited. This information helps us
                    understand how visitors use the Site and improve its functionality.
                  </p>
                </div>
              </div>
            </div>

            {/* How We Use Your Information */}
            <div>
              <h2
                id={slugify('How We Use Your Information')}
                className="text-white mb-4"
                style={typography.sectionHeader}
              >
                How We Use Your Information
              </h2>
              <ul className="text-altivum-silver space-y-2" style={typography.bodyText}>
                <li className="flex items-start">
                  <span className="text-altivum-gold mr-3" aria-hidden="true">
                    •
                  </span>
                  <span>Respond to your inquiries and messages</span>
                </li>
                <li className="flex items-start">
                  <span className="text-altivum-gold mr-3" aria-hidden="true">
                    •
                  </span>
                  <span>Send newsletter updates if you have subscribed</span>
                </li>
                <li className="flex items-start">
                  <span className="text-altivum-gold mr-3" aria-hidden="true">
                    •
                  </span>
                  <span>Provide AI-powered chat responses about my background and work</span>
                </li>
                <li className="flex items-start">
                  <span className="text-altivum-gold mr-3" aria-hidden="true">
                    •
                  </span>
                  <span>Improve the Site's functionality and user experience</span>
                </li>
                <li className="flex items-start">
                  <span className="text-altivum-gold mr-3" aria-hidden="true">
                    •
                  </span>
                  <span>Protect against spam and abuse</span>
                </li>
              </ul>
            </div>

            {/* Third-Party Services */}
            <div>
              <h2 id={slugify('Third-Party Services')} className="text-white mb-4" style={typography.sectionHeader}>
                Third-Party Services
              </h2>
              <p className="text-altivum-silver mb-4" style={typography.bodyText}>
                We use the following third-party services to operate the Site:
              </p>
              <ul className="text-altivum-silver space-y-2" style={typography.bodyText}>
                <li className="flex items-start">
                  <span className="text-altivum-gold mr-3" aria-hidden="true">
                    •
                  </span>
                  <span>
                    <strong className="text-white">Amazon Web Services (AWS):</strong> Cloud hosting, serverless
                    functions, and AI processing and safety checks via Amazon Bedrock.
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="text-altivum-gold mr-3" aria-hidden="true">
                    •
                  </span>
                  <span>
                    <strong className="text-white">AWS Amplify:</strong> Website hosting and deployment.
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="text-altivum-gold mr-3" aria-hidden="true">
                    •
                  </span>
                  <span>
                    <strong className="text-white">Sanity.io:</strong> Content management system for blog content.
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="text-altivum-gold mr-3" aria-hidden="true">
                    •
                  </span>
                  <span>
                    <strong className="text-white">Cloudflare:</strong> DNS, bot protection, and AI processing through
                    Workers AI. Chat messages and relevant conversation context may be sent to Cloudflare to generate
                    responses using the configured model.
                  </span>
                </li>
              </ul>
              <p className="text-altivum-silver mt-4" style={typography.bodyText}>
                These services have their own privacy policies governing how they handle data. We encourage you to
                review their policies for more information.
              </p>
            </div>

            {/* Cookies & Tracking */}
            <div>
              <h2 id={slugify('Cookies & Tracking')} className="text-white mb-4" style={typography.sectionHeader}>
                Cookies & Tracking
              </h2>
              <p className="text-altivum-silver mb-4" style={typography.bodyText}>
                This Site uses minimal cookies necessary for basic functionality. We do not use third-party advertising
                trackers or sell your data to advertisers.
              </p>
              <p className="text-altivum-silver" style={typography.bodyText}>
                Performance measurements are sent to our AWS monitoring service. They contain timing data and page
                paths, not message content. Optional error reports are sent to Sentry only with analytics consent.
                Session recording is disabled.
              </p>
              <p className="text-altivum-silver mt-4" style={typography.bodyText}>
                With your consent, we use <strong className="text-white">PostHog</strong> for product analytics that
                help us improve the Site. PostHog uses cookies and is enabled <em>only</em> if you accept it on the
                consent banner &mdash; declining disables optional analytics cookies. Form fields you enter (such as
                your email) are never recorded. You can withdraw your consent at any time.
              </p>
              {showResetPreference && (
                <button
                  type="button"
                  onClick={resetAnalyticsPreference}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2 border border-altivum-gold/40 text-altivum-gold text-sm rounded-md hover:bg-altivum-gold/10 active:scale-[0.98] transition-all duration-200 touch-manipulation focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-altivum-gold focus-visible:outline-offset-2"
                >
                  <Icon name="tune" className="text-base" aria-hidden="true" />
                  Reset analytics preference
                </button>
              )}
            </div>

            {/* Data Retention */}
            <div>
              <h2 id={slugify('Data Retention')} className="text-white mb-4" style={typography.sectionHeader}>
                Data Retention
              </h2>
              <ul className="text-altivum-silver space-y-2" style={typography.bodyText}>
                <li>
                  Pending newsletter confirmations expire after 24 hours and are queued for automatic deletion.
                  Newsletter and Blueprint waitlist consent are stored separately. A confirmation link is required
                  before either subscription becomes active.
                </li>
                <li className="flex items-start">
                  <span className="text-altivum-gold mr-3" aria-hidden="true">
                    •
                  </span>
                  <span>
                    <strong className="text-white">Contact submissions:</strong> Retained for business communication
                    purposes.
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="text-altivum-gold mr-3" aria-hidden="true">
                    •
                  </span>
                  <span>
                    <strong className="text-white">Newsletter subscriptions:</strong> Retained until you unsubscribe.
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="text-altivum-gold mr-3" aria-hidden="true">
                    •
                  </span>
                  <span>
                    <strong className="text-white">AI chat messages:</strong> Processed in real-time and not permanently
                    stored.
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="text-altivum-gold mr-3" aria-hidden="true">
                    •
                  </span>
                  <span>
                    <strong className="text-white">Server logs:</strong> Retained according to standard AWS practices.
                  </span>
                </li>
              </ul>
            </div>

            {/* Your Rights */}
            <div>
              <h2 id={slugify('Your Rights')} className="text-white mb-4" style={typography.sectionHeader}>
                Your Rights
              </h2>
              <p className="text-altivum-silver mb-4" style={typography.bodyText}>
                Depending on your location, you may have the following rights regarding your personal data:
              </p>
              <ul className="text-altivum-silver space-y-2" style={typography.bodyText}>
                <li className="flex items-start">
                  <span className="text-altivum-gold mr-3" aria-hidden="true">
                    •
                  </span>
                  <span>
                    <strong className="text-white">Access:</strong> Request a copy of the personal data we hold about
                    you.
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="text-altivum-gold mr-3" aria-hidden="true">
                    •
                  </span>
                  <span>
                    <strong className="text-white">Deletion:</strong> Request that we delete your personal data.
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="text-altivum-gold mr-3" aria-hidden="true">
                    •
                  </span>
                  <span>
                    <strong className="text-white">Correction:</strong> Request that we correct inaccurate data.
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="text-altivum-gold mr-3" aria-hidden="true">
                    •
                  </span>
                  <span>
                    <strong className="text-white">Opt-out:</strong> Unsubscribe from marketing communications at any
                    time.
                  </span>
                </li>
              </ul>
              <p className="text-altivum-silver mt-4" style={typography.bodyText}>
                To exercise any of these rights, please contact us using the information below.
              </p>
            </div>

            {/* Data Security */}
            <div>
              <h2 id={slugify('Data Security')} className="text-white mb-4" style={typography.sectionHeader}>
                Data Security
              </h2>
              <p className="text-altivum-silver" style={typography.bodyText}>
                We take reasonable measures to protect your personal information. The Site uses HTTPS encryption for all
                data transmission. Our infrastructure is hosted on AWS, which maintains robust security certifications
                and practices. However, no method of transmission over the internet is 100% secure, and we cannot
                guarantee absolute security.
              </p>
              <p className="text-altivum-silver mt-4" style={typography.bodyText}>
                We do not sell, rent, or share your personal information with third parties for their marketing
                purposes.
              </p>
            </div>

            {/* Children's Privacy */}
            <div>
              <h2 id={slugify("Children's Privacy")} className="text-white mb-4" style={typography.sectionHeader}>
                Children's Privacy
              </h2>
              <p className="text-altivum-silver" style={typography.bodyText}>
                This Site is not intended for children under the age of 13. We do not knowingly collect personal
                information from children under 13. If you believe we have collected information from a child under 13,
                please contact us immediately.
              </p>
            </div>

            {/* Changes to This Policy */}
            <div>
              <h2 id={slugify('Changes to This Policy')} className="text-white mb-4" style={typography.sectionHeader}>
                Changes to This Policy
              </h2>
              <p className="text-altivum-silver" style={typography.bodyText}>
                We may update this Privacy Policy from time to time. Any changes will be posted on this page with an
                updated "Last updated" date. We encourage you to review this policy periodically.
              </p>
            </div>

            {/* Contact */}
            <div>
              <h2 id={slugify('Contact Us')} className="text-white mb-4" style={typography.sectionHeader}>
                Contact Us
              </h2>
              <p className="text-altivum-silver" style={typography.bodyText}>
                If you have any questions about this Privacy Policy or our data practices, please contact us at:
              </p>
              <div className="mt-4 p-6 bg-altivum-navy/50 border-l-4 border-altivum-gold">
                <p className="text-white" style={typography.bodyText}>
                  Christian Perez
                </p>
                <p className="text-altivum-silver" style={typography.bodyText}>
                  Email:{' '}
                  <a href="mailto:admin@altivum.ai" className="text-altivum-gold hover:underline">
                    admin@altivum.ai
                  </a>
                </p>
                <p className="text-altivum-silver mt-2" style={typography.bodyText}>
                  Or use our{' '}
                  <ViewTransitionLink to="/contact" className="text-altivum-gold hover:underline">
                    contact form
                  </ViewTransitionLink>
                  .
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Privacy;
