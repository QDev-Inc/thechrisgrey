import { useState, useEffect } from 'react';
import { typography } from '../utils/typography';
import { SEO } from '../components/SEO';
import Breadcrumbs from '../components/Breadcrumbs';
import ResponsiveImage from '../components/ResponsiveImage';
import tvpLogo from '../assets/tvp.png?responsive';
// Profile image: AVIF/WebP responsive variants via the `?responsive` Vite plugin
// (VAL-PERF-004). Shared with Home and BlogPost.
import profileImage from '../assets/profile1.jpeg?responsive';
import {
  podcastFAQs,
  buildPodcastSeriesSchema,
  buildVideoObjectSchema,
  buildPodcastEpisodeSchema,
} from '../utils/schemas';
import DirectAnswerSummary from '../components/aeo/DirectAnswerSummary';
import FAQSection from '../components/aeo/FAQSection';
import QuestionHeading from '../components/aeo/QuestionHeading';
import { AEO_SUMMARIES } from '../data/aeoSummaries';
import { slugify } from '../utils/slugify';

const breadcrumbs = [
  { name: 'Home', url: 'https://thechrisgrey.com' },
  { name: 'Podcast', url: 'https://thechrisgrey.com/podcast' },
];

import {
  PODCAST_EPISODES,
  PODCAST_PLATFORMS,
  SPOTIFY_EMBED_URL,
  LATEST_VIDEO_ID,
  LATEST_EPISODE_DATE,
} from '../data/podcastEpisodes';
import EpisodeCard from '../components/EpisodeCard';
import AskTheVector from '../components/podcast/AskTheVector';
import SubscribePlatforms from '../components/SubscribePlatforms';
import NewsletterCTA from '../components/NewsletterCTA';
import YouTubeFacade from '../components/YouTubeFacade';
import SpotifyFacade from '../components/SpotifyFacade';
import { podcastClient, PODCAST_GUESTS_QUERY, classifySanityError, isPodcastGuestArray } from '../sanity';
// Imported from its own module rather than the barrel, for the same reason as
// on Blog/BlogPost: the page tests replace `../sanity` with a hand-enumerated
// factory.
import { sanityError } from '../sanity/errors';
import type { PodcastGuest } from '../sanity';
import GuestCard from '../components/GuestCard';
import { SpotifyIcon, ApplePodcastIcon, YouTubeIcon } from '../components/PodcastPlatformIcons';
import { createLogger } from '../utils/logger';
import { captureError } from '../utils/rum';

const log = createLogger('Podcast');

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Format an ISO 'YYYY-MM-DD' as 'Mon YYYY' (e.g. 'Feb 2026'). Parsed by string,
 *  not Date, to avoid any UTC/local timezone month-shift. */
function formatMonthYear(iso: string): string {
  const [year, month] = iso.split('-');
  const monthIndex = parseInt(month, 10) - 1;
  const label = MONTH_ABBR[monthIndex];
  return label ? `${label} ${year}` : year;
}

const Podcast = () => {
  const [showAllEpisodes, setShowAllEpisodes] = useState(false);
  const [guests, setGuests] = useState<PodcastGuest[]>([]);
  const [isLoadingGuests, setIsLoadingGuests] = useState(true);

  useEffect(() => {
    // Guests are supplementary — the section degrades gracefully to empty on
    // failure. We still validate the shape and classify/report errors so a real
    // outage or schema drift is observable rather than silently swallowed.
    //
    // captureError, not log.error alone: the logger's Sentry gate tests the
    // REDACTED clone with `instanceof Error` (which no caller can satisfy) and
    // is consent-gated besides, so a log.error never leaves the visitor's
    // browser. This section failing silently for everyone is exactly the
    // outcome the comment above claimed to prevent.
    podcastClient
      .fetch<PodcastGuest[]>(PODCAST_GUESTS_QUERY)
      .then((data) => {
        if (isPodcastGuestArray(data)) {
          setGuests(data);
        } else {
          // The HTTP call succeeded, so no network telemetry fires: this is the
          // only signal that the podcastGuest schema drifted.
          const classified = sanityError('malformed', 'Podcast guests');
          log.error('shape_validation_failed', { kind: classified.kind });
          captureError(new Error(classified.message), { scope: 'Podcast', kind: classified.kind });
          setGuests([]);
        }
      })
      .catch((err) => {
        const classified = classifySanityError(err, 'Podcast guests');
        log.error('fetch_failed', { kind: classified.kind, message: classified.message });
        captureError(classified.causedBy ?? new Error(classified.message), {
          scope: 'Podcast',
          kind: classified.kind,
        });
        setGuests([]);
      })
      .finally(() => setIsLoadingGuests(false));
  }, []);

  const featuredEpisode = PODCAST_EPISODES[0];
  const otherEpisodes = PODCAST_EPISODES.slice(1);
  const displayedEpisodes = showAllEpisodes ? otherEpisodes : otherEpisodes.slice(0, 4);

  return (
    <div className="min-h-screen">
      <SEO
        title="The Vector Podcast"
        description="The Vector Podcast explores veteran experience, emerging technology, and purposeful entrepreneurship. Hosted by Christian Perez."
        keywords="The Vector Podcast, Christian Perez podcast, AI podcast, veteran entrepreneurship, technology podcast, Altivum Press"
        url="https://thechrisgrey.com/podcast"
        imageAlt="The Vector Podcast cover art — hosted by Christian Perez"
        faq={podcastFAQs}
        breadcrumbs={breadcrumbs}
        structuredData={[
          buildPodcastSeriesSchema(),
          // PodcastEpisode nodes for each episode (VAL-SD-005). Google's
          // podcast carousel keys off these; partOfSeries references the
          // canonical PodcastSeries node above.
          ...PODCAST_EPISODES.map((ep) =>
            buildPodcastEpisodeSchema({
              name: ep.title,
              description: ep.description,
              url: ep.links.youtube || ep.links.spotify || 'https://thechrisgrey.com/podcast',
              datePublished: ep.publishedAt,
              duration: ep.duration,
              episodeNumber: ep.episodeNumber,
              seasonNumber: ep.seasonNumber,
            }),
          ),
          ...(LATEST_VIDEO_ID && LATEST_EPISODE_DATE
            ? [
                buildVideoObjectSchema({
                  videoId: LATEST_VIDEO_ID,
                  title: featuredEpisode?.title || 'The Vector Podcast',
                  description: featuredEpisode?.description,
                  uploadDate: LATEST_EPISODE_DATE,
                }),
              ]
            : []),
        ]}
      />

      {/* Visible breadcrumb trail — mirrors the BreadcrumbList JSON-LD emitted
          by <SEO> above. Ancestors are SPA-transition links; the current page
          carries aria-current="page". */}
      <div className="pt-24 pb-3 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <Breadcrumbs items={breadcrumbs} />
      </div>

      {/* Hero Section */}
      <section className="relative flex items-center justify-center overflow-hidden">
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-12 md:pt-16 md:pb-16">
          <div className="max-w-4xl mx-auto text-center">
            <div className="mb-6 sm:mb-8">
              <ResponsiveImage
                src={tvpLogo}
                alt="The Vector Podcast"
                sizes="(min-width: 768px) 768px, 100vw"
                className="w-full max-w-3xl mx-auto opacity-90"
                priority
              />
              <h1 className="sr-only">The Vector Podcast - Hosted by Christian Perez</h1>
            </div>

            {/* Direct-answer summary — first viewport, before the first H2 (VAL-AEO-001, VAL-AEO-002). */}
            <DirectAnswerSummary text={AEO_SUMMARIES['/podcast']} className="max-w-2xl mx-auto" />

            {/* Podcast Stats */}
            <div className="flex justify-center gap-12 mt-10">
              <div className="text-center">
                <div className="text-4xl font-light text-altivum-gold" style={{ fontWeight: 200 }}>
                  {PODCAST_EPISODES.length}
                </div>
                <div className="text-sm text-altivum-silver uppercase tracking-wider mt-1">Episodes</div>
              </div>
              {LATEST_EPISODE_DATE && (
                <div className="text-center">
                  <div className="text-4xl font-light text-altivum-gold whitespace-nowrap" style={{ fontWeight: 200 }}>
                    {formatMonthYear(LATEST_EPISODE_DATE)}
                  </div>
                  <div className="text-sm text-altivum-silver uppercase tracking-wider mt-1">Latest episode</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Ask The Vector — semantic podcast search with timestamp-cited answers */}
      <div className="h-px bg-linear-to-r from-transparent via-altivum-gold/15 to-transparent" />
      <AskTheVector />

      {/* About Section */}
      <section className="py-24 bg-altivum-dark">
        <div className="max-w-4xl mx-auto px-6 lg:px-8 text-center">
          <QuestionHeading as="h2" className="mb-6">
            What is The Vector Podcast about?
          </QuestionHeading>
          <div className="h-px w-24 bg-altivum-gold mx-auto mb-8"></div>
          <p className="text-altivum-silver leading-relaxed" style={typography.subtitle}>
            The Vector Podcast delivers mission-focused conversations at the intersection of veteran experience, small
            business, and modern technology. We break down artificial intelligence, cloud solutions, and
            entrepreneurship into clear, actionable insights anyone can apply.
          </p>
        </div>
      </section>

      {/* Latest Episode - YouTube Embed */}
      <div className="h-px bg-linear-to-r from-transparent via-altivum-gold/15 to-transparent" />
      <section className="py-24 bg-altivum-dark">
        <div className="max-w-5xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-12">
            <div className="inline-block px-4 py-2 bg-altivum-gold/10 rounded-md mb-4">
              <span className="text-altivum-gold font-semibold text-sm uppercase tracking-wider">Latest Episode</span>
            </div>
            <QuestionHeading as="h2">What is the latest episode?</QuestionHeading>
          </div>

          {LATEST_VIDEO_ID ? (
            <div className="relative aspect-video rounded-xl overflow-hidden bg-altivum-navy">
              <YouTubeFacade
                videoId={LATEST_VIDEO_ID}
                title={featuredEpisode.title}
                embedParams="rel=0&modestbranding=1"
              />
            </div>
          ) : (
            <EpisodeCard episode={featuredEpisode} variant="featured" />
          )}

          {/* Episode Details (shown below video embed) */}
          {LATEST_VIDEO_ID && featuredEpisode && (
            <div className="mt-8 p-6 sm:p-8 rounded-lg border border-white/10 bg-white/5">
              <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-wider font-medium mb-4">
                {featuredEpisode.episodeNumber && (
                  <span className="text-altivum-gold">
                    {featuredEpisode.seasonNumber ? `S${featuredEpisode.seasonNumber} ` : ''}Episode{' '}
                    {featuredEpisode.episodeNumber}
                  </span>
                )}
                <span className="text-altivum-silver">|</span>
                <span className="text-altivum-silver">{featuredEpisode.duration}</span>
              </div>
              <h3 id={slugify(featuredEpisode.title)} className="text-white mb-4" style={typography.cardTitleLarge}>
                {featuredEpisode.title}
              </h3>
              <p className="text-altivum-silver" style={typography.bodyText}>
                {featuredEpisode.description}
              </p>

              {/* Listen Links — match the per-episode card link row */}
              {(featuredEpisode.links.spotify || featuredEpisode.links.apple || featuredEpisode.links.youtube) && (
                <div className="flex flex-wrap gap-3 mt-6">
                  {featuredEpisode.links.spotify && (
                    <a
                      href={featuredEpisode.links.spotify}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-[#1DB954]/10 text-[#1DB954] rounded-full text-sm font-medium hover:bg-[#1DB954]/20 transition-colors"
                    >
                      <SpotifyIcon className="w-4 h-4" />
                      Spotify
                    </a>
                  )}
                  {featuredEpisode.links.apple && (
                    <a
                      href={featuredEpisode.links.apple}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-[#872EC4]/10 text-[#872EC4] rounded-full text-sm font-medium hover:bg-[#872EC4]/20 transition-colors"
                    >
                      <ApplePodcastIcon className="w-4 h-4" />
                      Apple
                    </a>
                  )}
                  {featuredEpisode.links.youtube && (
                    <a
                      href={featuredEpisode.links.youtube}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-[#FF0000]/10 text-[#FF0000] rounded-full text-sm font-medium hover:bg-[#FF0000]/20 transition-colors"
                    >
                      <YouTubeIcon className="w-4 h-4" />
                      YouTube
                    </a>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Spotify Embed Section */}
      <div className="h-px bg-linear-to-r from-transparent via-altivum-gold/15 to-transparent" />
      <section className="py-16 bg-altivum-dark">
        <div className="max-w-3xl mx-auto px-6 lg:px-8">
          <div className="rounded-xl overflow-hidden">
            <SpotifyFacade embedUrl={SPOTIFY_EMBED_URL} title="The Vector Podcast" />
          </div>
        </div>
      </section>

      {/* All Episodes */}
      {otherEpisodes.length > 0 && (
        <>
          <div className="h-px bg-linear-to-r from-transparent via-altivum-gold/15 to-transparent" />
          <section className="py-24 bg-altivum-dark">
            <div className="max-w-4xl mx-auto px-6 lg:px-8">
              <div className="text-center mb-12">
                <QuestionHeading as="h2" className="mb-4">
                  What episodes are available?
                </QuestionHeading>
                <div className="h-px w-24 bg-altivum-gold mx-auto"></div>
              </div>

              <div className="flex flex-col gap-2">
                {displayedEpisodes.map((episode) => (
                  <EpisodeCard key={episode.id} episode={episode} variant="compact" />
                ))}
              </div>

              {otherEpisodes.length > 4 && !showAllEpisodes && (
                <div className="text-center mt-8">
                  <button
                    onClick={() => setShowAllEpisodes(true)}
                    className="inline-flex items-center px-6 py-2 text-sm bg-transparent border border-white/20 text-altivum-silver font-medium hover:border-altivum-gold hover:text-altivum-gold transition-all duration-200 rounded-sm"
                  >
                    Show All {otherEpisodes.length} Episodes
                  </button>
                </div>
              )}
            </div>
          </section>
        </>
      )}

      {/* Featured Veterans */}
      {!isLoadingGuests && guests.length > 0 && (
        <>
          <div className="h-px bg-linear-to-r from-transparent via-altivum-gold/15 to-transparent" />
          <section className="py-24 bg-altivum-dark">
            <div className="max-w-7xl mx-auto px-6 lg:px-8">
              <div className="text-center mb-12">
                <QuestionHeading as="h2" className="mb-4">
                  Who are the featured veterans?
                </QuestionHeading>
                <div className="h-px w-24 bg-altivum-gold mx-auto"></div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {guests.map((guest) => (
                  <GuestCard key={guest._id} guest={guest} />
                ))}
              </div>
            </div>
          </section>
        </>
      )}

      {/* Subscribe Section */}
      <div className="h-px bg-linear-to-r from-transparent via-altivum-gold/15 to-transparent" />
      <section className="py-24 bg-linear-to-b from-altivum-dark to-altivum-navy">
        <div className="max-w-4xl mx-auto px-6 lg:px-8 text-center">
          <QuestionHeading as="h2" className="mb-6">
            How can I listen and subscribe?
          </QuestionHeading>
          <p className="text-altivum-silver mb-12 max-w-2xl mx-auto" style={typography.bodyText}>
            Never miss an episode. Subscribe on your favorite podcast platform.
          </p>

          <SubscribePlatforms platforms={PODCAST_PLATFORMS} />
        </div>
      </section>

      <NewsletterCTA
        source="podcast"
        heading="Get new episodes in your inbox"
        blurb="Prefer email? Subscribe and I'll send a note when a new episode of The Vector Podcast drops."
      />

      {/* Host Section */}
      <div className="h-px bg-linear-to-r from-transparent via-altivum-gold/15 to-transparent" />
      <section className="py-24 bg-altivum-navy">
        <div className="max-w-4xl mx-auto px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center gap-10">
            <div className="w-48 h-48 rounded-full overflow-hidden border-4 border-altivum-gold/30 shrink-0">
              <ResponsiveImage
                src={profileImage}
                alt="Christian Perez"
                sizes="192px"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="text-center md:text-left">
              <QuestionHeading as="h3" className="mb-2">
                Who hosts The Vector Podcast?
              </QuestionHeading>
              <h4 className="text-altivum-gold mb-4" style={typography.subtitle}>
                Christian Perez
              </h4>
              <p className="text-altivum-silver" style={typography.bodyText}>
                Former Green Beret, Founder & CEO of Altivum Inc., and passionate advocate for veteran entrepreneurship.
                Christian brings unique insights from his journey transitioning from Special Operations to tech
                leadership, exploring how emerging technology can empower individuals and organizations to adapt and
                excel.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Visible FAQ — mirrors the FAQPage JSON-LD emitted by <SEO faq={podcastFAQs}>
          so the DOM text and structured data agree (VAL-AEO-004). */}
      <FAQSection faqs={podcastFAQs} />
    </div>
  );
};

export default Podcast;
