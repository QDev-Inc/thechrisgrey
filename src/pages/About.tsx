import mpbLogo from '../assets/mpb.png?responsive';
import ResponsiveImage from '../components/ResponsiveImage';
import ViewTransitionLink from '../components/ViewTransitionLink';
import { SEO } from '../components/SEO';
import Breadcrumbs from '../components/Breadcrumbs';
import { typography } from '../utils/typography';
import { aboutFAQs, buildProfilePageSchema } from '../utils/schemas';
import NewsletterCTA from '../components/NewsletterCTA';
import Credentials from '../components/Credentials';
import DirectAnswerSummary from '../components/aeo/DirectAnswerSummary';
import FAQSection from '../components/aeo/FAQSection';
import QuestionHeading from '../components/aeo/QuestionHeading';
import { AEO_SUMMARIES } from '../data/aeoSummaries';

const breadcrumbs = [
  { name: 'Home', url: 'https://thechrisgrey.com' },
  { name: 'About', url: 'https://thechrisgrey.com/about' },
];

const About = () => {
  return (
    <div className="min-h-screen bg-altivum-dark">
      <SEO
        title="About Christian Perez"
        description="Christian Perez: Green Beret and Special Forces Medic (18D) to Founder & CEO of Altivum Inc. A journey of service, leadership, and innovation."
        keywords="Christian Perez bio, Green Beret, 18D, Special Forces Medic, Altivum founder, veteran entrepreneur, Bronze Star, 1st Special Forces Group"
        url="https://thechrisgrey.com/about"
        imageAlt="About Christian Perez — former Green Beret, Bronze Star recipient, and Founder of Altivum Inc."
        type="website"
        faq={aboutFAQs}
        breadcrumbs={breadcrumbs}
        structuredData={[
          buildProfilePageSchema({
            name: 'About Christian Perez',
            description:
              'Biography of Christian Perez: From Special Forces Medic (18D) to Founder & CEO of Altivum Inc.',
            url: 'https://thechrisgrey.com/about',
          }),
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
            <h1 className="sr-only">About Christian Perez - Personal Biography</h1>
            <div className="mb-6 sm:mb-8">
              <ResponsiveImage
                src={mpbLogo}
                alt=""
                sizes="(min-width: 768px) 768px, 100vw"
                className="w-full max-w-3xl mx-auto opacity-90"
                priority
              />
            </div>
            {/* Direct-answer summary — first viewport, before the first H2 (VAL-AEO-001, VAL-AEO-002). */}
            <DirectAnswerSummary text={AEO_SUMMARIES['/about']} className="mt-8 max-w-2xl mx-auto" />
          </div>
        </div>
      </section>

      {/* Biography Content */}
      <section className="pb-24 md:pb-32 lg:pb-40">
        <div className="max-w-3xl mx-auto px-6 lg:px-8">
          {/* Opening Statement */}
          <div className="mb-20 md:mb-24 text-center">
            <QuestionHeading as="h2" className="mb-8">
              Who is Christian Perez?
            </QuestionHeading>
            <p className="text-white" style={typography.sectionHeader}>
              My name is <span className="text-altivum-gold">Christian Perez</span>, and I'm the Founder & CEO of{' '}
              <ViewTransitionLink to="/altivum" className="text-altivum-gold link-underline">
                Altivum Inc.
              </ViewTransitionLink>
            </p>
          </div>

          {/* Early Life */}
          <div className="mb-20 md:mb-24">
            <QuestionHeading as="h2" className="mb-8">
              Where did Christian Perez grow up?
            </QuestionHeading>
            <p className="text-white/80" style={typography.subtitle}>
              I was born in <span className="text-white">Guatemala City</span> and came to the United States with my
              family when I was two. <span className="text-white">Boston</span> shaped me. From enjoying Italian cuisine
              in the North End to runs along the Charles River, the city's energy became part of who I am.
            </p>
          </div>

          {/* Military Service */}
          <div className="mb-20 md:mb-24">
            <QuestionHeading as="h2" className="mb-8">
              What was Christian Perez's military service?
            </QuestionHeading>
            <p className="text-white/80" style={typography.subtitle}>
              In <span className="text-white">2012</span>, I joined the Army and later earned my{' '}
              <span className="text-altivum-gold">Green Beret</span> as a Special Forces Medic (18D). I was then
              assigned to 1st Special Forces Group and soon thereafter deployed to{' '}
              <span className="text-white">Afghanistan</span> with SFOD-A 1236, where I was awarded a{' '}
              <span className="text-altivum-gold">Bronze Star</span>. After receiving an Honorable Discharge, I wrote{' '}
              <ViewTransitionLink to="/beyond-the-assessment" className="text-altivum-gold italic link-underline">
                Beyond the Assessment
              </ViewTransitionLink>
              —a reflection on modern masculinity and a dedication to my son, <span className="text-white">Elijah</span>
              .
            </p>
          </div>

          {/* Career Evolution */}
          <div className="mb-20 md:mb-24">
            <QuestionHeading as="h2" className="mb-8">
              How did Christian Perez transition to tech?
            </QuestionHeading>
            <p className="text-white/80" style={typography.subtitle}>
              Throughout my military career, I watched the rapid evolution of computing and artificial intelligence. In{' '}
              <span className="text-white">February 2025</span>, I founded{' '}
              <ViewTransitionLink to="/altivum" className="text-altivum-gold link-underline">
                Altivum Inc.
              </ViewTransitionLink>
              , a public benefit corporation dedicated to engineering AI systems that{' '}
              <span className="text-white">empower people and organizations to adapt and excel</span>.
            </p>
          </div>

          {/* Core Mission */}
          <div className="mt-32">
            <QuestionHeading as="h2" className="mb-8">
              What drives Christian Perez?
            </QuestionHeading>
            <p className="text-white mb-8" style={typography.cardTitleLarge}>
              At my core, I'm a <span className="text-altivum-gold">builder</span>.
            </p>
            <p className="text-white/80 mb-8" style={typography.subtitle}>
              I create systems that turn experience into opportunity. I work with veterans, students, and small
              businesses to help them step confidently into a rapidly changing world.
            </p>
            <p className="text-white/80" style={typography.subtitle}>
              I believe the next decade belongs to those who understand how to combine{' '}
              <span className="text-white">human judgment</span> with{' '}
              <span className="text-white">intelligent machines</span>—and my mission is to ensure the people I serve
              are among them.
            </p>
          </div>
        </div>
      </section>

      {/* Credentials & Recognition — visible trust signals mirroring the
          Person / Organization JSON-LD (Bronze Star, Green Beret / 18D, AWS
          Community Builder, Anthropic Academy certifications, Veteran Business
          of the Month). The heading is phrased as a question so it counts
          toward the question-heading ratio (VAL-AEO-003). */}
      <Credentials heading="What credentials & recognition has Christian earned?" />

      {/* Visible FAQ — mirrors the FAQPage JSON-LD emitted by <SEO faq={aboutFAQs}>
          so the DOM text and structured data agree (VAL-AEO-004). */}
      <FAQSection faqs={aboutFAQs} />

      <NewsletterCTA
        source="about"
        heading="Want to follow Christian's work?"
        blurb="I write about building with AI, the road from the military to tech, and lessons in leadership. Get new pieces in your inbox."
      />
    </div>
  );
};

export default About;
