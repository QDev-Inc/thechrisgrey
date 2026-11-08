import ViewTransitionLink from '../components/ViewTransitionLink';
import { SEO } from '../components/SEO';
import HeroBento from '../components/home/HeroBento';
import { typography } from '../utils/typography';
import { homeFAQs, buildWebPageSchema } from '../utils/schemas';
import { SOCIAL_LINKS } from '../constants/links';
import SocialIcon from '../components/SocialIcon';
import NewsletterForm from '../components/NewsletterForm';
import Testimonials from '../components/Testimonials';
import DirectAnswerSummary from '../components/aeo/DirectAnswerSummary';
import FAQSection from '../components/aeo/FAQSection';
import { AEO_SUMMARIES } from '../data/aeoSummaries';
import { slugify } from '../utils/slugify';
import Icon from '../components/icons/Icon';

const keyPoints = [
  { title: 'Personal Biography', subtitle: 'Christian Perez', link: '/about' },
  { title: 'Altivum Inc', subtitle: 'Founder & CEO', link: '/altivum' },
  { title: 'The Altivum Foundation', subtitle: 'Founder & President', link: '/foundation' },
  { title: 'The Vector Podcast', subtitle: 'Host', link: '/podcast' },
  { title: 'Beyond the Assessment', subtitle: 'Author', link: '/beyond-the-assessment' },
  { title: 'Amazon Web Services', subtitle: 'AWS Community Builder (AI Engineering)', link: '/aws' },
  { title: 'Claude', subtitle: 'Applied AI Engineer', link: '/claude' },
  { title: 'thechrisgrey Blueprint', subtitle: 'Architect', link: '/blueprint' },
] as const;

const Home = () => {
  return (
    <div className="min-h-screen">
      <SEO
        title="Christian Perez"
        description="Personal website of Christian Perez, Founder & CEO of Altivum Inc., Former Green Beret, Bronze Star Recipient, and Host of The Vector Podcast."
        keywords="Christian Perez, thechrisgrey, Altivum Inc, Green Beret, The Vector Podcast, veteran entrepreneur, AI technology, cloud architecture"
        url="https://thechrisgrey.com"
        imageAlt="Christian Perez — Founder & CEO of Altivum Inc., former Green Beret, host of The Vector Podcast"
        faq={homeFAQs}
        structuredData={[
          buildWebPageSchema({
            name: 'Christian Perez - thechrisgrey',
            description:
              'Personal website of Christian Perez, Founder & CEO of Altivum Inc., Former Green Beret, and Host of The Vector Podcast.',
            url: 'https://thechrisgrey.com',
          }),
        ]}
      />
      <HeroBento />
      <div className="sr-only">
        {/* Direct-answer summary — first in DOM order, before the first H2
            (VAL-AEO-001, VAL-AEO-002), which is what the build-time [seo-gate]
            and AI answer engines read.
            Deliberately sr-only: the bento hero already gives sighted visitors
            the concise introduction, while this fuller summary remains in the
            accessible DOM and is visible again in the scroll section below. */}
        <DirectAnswerSummary text={AEO_SUMMARIES['/']} className="sr-only" />
      </div>

      <section id="work" className="bg-altivum-navy/35 py-16 md:py-20 scroll-mt-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-12">
          <h2 id="work-service-ideas" className="text-white mb-4" style={typography.sectionHeader}>
            Work, service & ideas
          </h2>
          <p className="max-w-2xl text-altivum-silver mb-10" style={typography.bodyText}>
            Explore the companies, community work, and conversations that connect my experience in service with the
            systems I build today.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {keyPoints.map((point) => (
              <ViewTransitionLink
                key={point.link}
                to={point.link}
                className="group flex min-h-40 flex-col justify-between rounded-2xl border border-white/10 bg-altivum-dark/60 p-6 transition-colors hover:border-altivum-gold/50 hover:bg-altivum-navy"
              >
                <h3 id={slugify(point.title)} className="text-white mb-3" style={typography.cardTitleSmall}>
                  {point.title}
                </h3>
                <div className="flex items-end justify-between gap-4">
                  <p className="text-altivum-silver text-sm leading-relaxed">{point.subtitle}</p>
                  <Icon name="north_east" className="text-altivum-gold shrink-0" />
                </div>
              </ViewTransitionLink>
            ))}
          </div>
        </div>
      </section>

      {/* Social proof (renders only once real testimonials exist) */}
      <Testimonials />

      {/* Visible FAQ — mirrors the FAQPage JSON-LD emitted by <SEO faq={homeFAQs}>
          so the DOM text and structured data agree (VAL-AEO-004). Below-fold:
          content-visibility: auto skips render until scrolled near
          (VAL-PERF-010). */}
      <FAQSection faqs={homeFAQs} className="cv-below-fold" />

      {/* CTA Section. Below-fold: content-visibility: auto skips render until
          scrolled near (VAL-PERF-010). */}
      <section className="cv-below-fold bg-linear-to-br from-altivum-navy to-altivum-blue py-16 md:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 id={slugify("Let's Connect")} className="text-white mb-4 sm:mb-6" style={typography.sectionHeader}>
            Let's Connect
          </h2>
          <p className="text-altivum-silver mb-8 sm:mb-10 max-w-2xl mx-auto" style={typography.subtitle}>
            Field notes on AI, cloud, and leadership — plus the occasional dispatch on what I'm building. Straight to
            your inbox, no noise.
          </p>

          {/* Primary: owned-audience capture */}
          <div className="mb-10 sm:mb-12">
            <NewsletterForm variant="compact" source="home" />
          </div>

          {/* Secondary: explore the work */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 mb-10">
            <ViewTransitionLink
              to="/podcast"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 sm:py-3 bg-altivum-gold text-altivum-dark font-semibold rounded-md hover:shadow-[0_0_20px_rgba(197,165,114,0.3)] active:scale-[0.98] transition-all duration-300 touch-manipulation min-h-[48px]"
            >
              <Icon name="podcasts" className="text-xl" aria-hidden="true" />
              Listen to the Podcast
            </ViewTransitionLink>
            <ViewTransitionLink
              to="/beyond-the-assessment"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 sm:py-3 bg-transparent border-2 border-altivum-gold text-altivum-gold font-semibold rounded-md hover:bg-altivum-gold/10 active:scale-[0.98] transition-all duration-300 touch-manipulation min-h-[48px]"
            >
              <Icon name="menu_book" className="text-xl" aria-hidden="true" />
              Get the Book
            </ViewTransitionLink>
          </div>

          {/* Tertiary: socials, demoted */}
          <div className="flex items-center justify-center gap-6">
            <a
              href={SOCIAL_LINKS.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="LinkedIn"
              className="text-altivum-silver hover:text-altivum-gold transition-colors touch-manipulation"
            >
              <SocialIcon platform="linkedin" className="w-6 h-6" />
            </a>
            <a
              href={SOCIAL_LINKS.instagram}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Instagram"
              className="text-altivum-silver hover:text-altivum-gold transition-colors touch-manipulation"
            >
              <SocialIcon platform="instagram" className="w-6 h-6" />
            </a>
            <ViewTransitionLink
              to="/links"
              className="text-altivum-silver hover:text-white underline transition-colors touch-manipulation"
              style={typography.smallText}
            >
              All links
            </ViewTransitionLink>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;
