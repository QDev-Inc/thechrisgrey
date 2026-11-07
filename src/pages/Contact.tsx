import { SEO } from '../components/SEO';
import Breadcrumbs from '../components/Breadcrumbs';
import { typography } from '../utils/typography';
import { isValidEmail } from '../utils/validators';
import { useState, useEffect, FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { contactFAQs, buildContactPageSchema } from '../utils/schemas';
import { SOCIAL_LINKS } from '../constants/links';
import { useFocusTrap } from '../hooks';
import SocialIcon from '../components/SocialIcon';
import { trackEvent } from '../utils/analytics';
import Testimonials from '../components/Testimonials';
import { createLogger } from '../utils/logger';
import { withTraceId } from '../utils/traceId';
import { getTurnstileToken } from '../utils/turnstile';
import DirectAnswerSummary from '../components/aeo/DirectAnswerSummary';
import FAQSection from '../components/aeo/FAQSection';
import { AEO_SUMMARIES } from '../data/aeoSummaries';
import { slugify } from '../utils/slugify';
import Icon from '../components/icons/Icon';

const log = createLogger('Contact');

const breadcrumbs = [
  { name: 'Home', url: 'https://thechrisgrey.com' },
  { name: 'Contact', url: 'https://thechrisgrey.com/contact' },
];

type FieldName = 'name' | 'email' | 'message';

const CONTACT_INTENTS = [
  { value: 'general', label: 'General inquiry' },
  { value: 'speaking', label: 'Speaking engagement' },
  { value: 'podcast', label: 'Podcast invitation' },
  { value: 'consulting', label: 'Consulting inquiry' },
  { value: 'collaboration', label: 'Collaboration' },
  { value: 'media', label: 'Media / press' },
] as const;

type ContactIntent = (typeof CONTACT_INTENTS)[number]['value'];

const isContactIntent = (value: string): value is ContactIntent =>
  CONTACT_INTENTS.some((intent) => intent.value === value);

const AUDIENCE_SIZES = ['Under 50', '50-200', '200-500', '500+'] as const;
const EVENT_FORMATS = ['Keynote', 'Panel discussion', 'Workshop', 'Podcast recording', 'Other'] as const;

const EMPTY_EVENT_DETAILS = { organization: '', eventDate: '', audienceSize: '', eventFormat: '' };

const SELECT_CLASS =
  'w-full px-0 py-4 bg-transparent border-b-2 border-white/10 text-white focus:border-altivum-gold focus:outline-hidden transition-all duration-300 rounded-none appearance-none cursor-pointer';

type ContactChannel = {
  href: string;
  external?: boolean;
  title: string;
  detail: string;
} & ({ kind: 'icon'; icon: string } | { kind: 'svg'; platform: string });

const CONTACT_CHANNELS: ContactChannel[] = [
  { kind: 'icon', icon: 'phone', href: SOCIAL_LINKS.phone, title: 'Phone', detail: '(615) 219-9425' },
  {
    kind: 'icon',
    icon: 'email',
    href: SOCIAL_LINKS.altivumEmail,
    title: 'General Inquiries',
    detail: 'info@altivum.ai',
  },
  {
    kind: 'icon',
    icon: 'business_center',
    href: SOCIAL_LINKS.altivumLogicEmail,
    title: 'Altivum Logic Services',
    detail: 'logic@altivum.ai',
  },
  {
    kind: 'icon',
    icon: 'person',
    href: SOCIAL_LINKS.email,
    title: 'Direct Email',
    detail: 'christian.perez@altivum.ai',
  },
  {
    kind: 'svg',
    platform: 'linkedin',
    href: SOCIAL_LINKS.linkedin,
    external: true,
    title: 'LinkedIn',
    detail: 'Connect professionally',
  },
  {
    kind: 'svg',
    platform: 'github',
    href: SOCIAL_LINKS.github,
    external: true,
    title: 'GitHub',
    detail: 'View open-source projects',
  },
];

const Contact = () => {
  const [searchParams] = useSearchParams();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: '',
    website: '', // honeypot field
  });
  const [intent, setIntent] = useState<ContactIntent>('general');
  const [eventDetails, setEventDetails] = useState(EMPTY_EVENT_DETAILS);
  const [formStatus, setFormStatus] = useState<{
    type: 'idle' | 'loading' | 'error';
    message: string;
  }>({ type: 'idle', message: '' });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const { containerRef: modalRef, handleKeyDown: handleModalKeyDown } = useFocusTrap(showSuccessModal);

  // Prefill from the Alti draft_message handoff (/contact?subject=...&message=...&intent=...).
  // State is adjusted during render (not in an effect) so a repeat handoff while the page
  // is already mounted still prefills. URLSearchParams.get returns decoded values; sliced
  // to the same caps the inputs enforce.
  const paramsKey = searchParams.toString();
  const [appliedParamsKey, setAppliedParamsKey] = useState<string | null>(null);
  if (appliedParamsKey !== paramsKey) {
    setAppliedParamsKey(paramsKey);
    const subjectParam = searchParams.get('subject');
    const messageParam = searchParams.get('message');
    const intentParam = searchParams.get('intent');
    if (subjectParam || messageParam) {
      setFormData((prev) => ({
        ...prev,
        subject: subjectParam ? subjectParam.slice(0, 200) : prev.subject,
        message: messageParam ? messageParam.slice(0, 5000) : prev.message,
      }));
    }
    if (intentParam && isContactIntent(intentParam)) {
      setIntent(intentParam);
    }
  }

  // Dirty-form detection
  const isDirty = !!(
    formData.name.trim() ||
    formData.email.trim() ||
    formData.subject.trim() ||
    formData.message.trim() ||
    Object.values(eventDetails).some((value) => value.trim())
  );

  // Browser beforeunload guard for tab close/refresh
  useEffect(() => {
    if (!isDirty && formStatus.type !== 'loading') return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty, formStatus.type]);

  // Keyboard escape handler for success modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showSuccessModal) {
        setShowSuccessModal(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [showSuccessModal]);

  const validateForm = (): Partial<Record<FieldName, string>> => {
    const errors: Partial<Record<FieldName, string>> = {};
    const name = formData.name.trim();
    if (name.length < 2 || name.length > 100) {
      errors.name = 'Name must be between 2 and 100 characters';
    }
    if (!isValidEmail(formData.email)) {
      errors.email = 'Please enter a valid email address';
    }
    const message = formData.message.trim();
    if (message.length < 10 || message.length > 5000) {
      errors.message = 'Message must be between 10 and 5000 characters';
    }
    return errors;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    // Client-side validation — set per-field errors and focus the first invalid field
    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const order: FieldName[] = ['name', 'email', 'message'];
      const firstInvalid = order.find((f) => errors[f]);
      if (firstInvalid) {
        document.getElementById(firstInvalid)?.focus();
      }
      return;
    }
    setFieldErrors({});

    setFormStatus({ type: 'loading', message: 'Sending...' });

    const intentLabel = CONTACT_INTENTS.find((option) => option.value === intent)?.label ?? intent;
    const detailLines = [
      intent !== 'general' ? `Intent: ${intentLabel}` : '',
      ...(intent === 'speaking'
        ? [
            eventDetails.organization.trim() && `Organization: ${eventDetails.organization.trim()}`,
            eventDetails.eventDate.trim() && `Event date: ${eventDetails.eventDate.trim()}`,
            eventDetails.audienceSize && `Audience size: ${eventDetails.audienceSize}`,
            eventDetails.eventFormat && `Event format: ${eventDetails.eventFormat}`,
          ]
        : []),
    ].filter(Boolean);
    const detailBlock = detailLines.length > 0 ? `${detailLines.join('\n')}\n\n` : '';

    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      const turnstileToken = await getTurnstileToken();
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 10_000);
      const response = await fetch(
        import.meta.env.VITE_CONTACT_ENDPOINT,
        withTraceId({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: formData.name.trim(),
            email: formData.email.trim(),
            message: `Subject: ${formData.subject.trim() || 'No subject'}\n\n${detailBlock}${formData.message.trim()}`,
            website: formData.website, // honeypot
            turnstileToken,
          }),
          signal: controller.signal,
        }),
      );

      const result = await response.json();

      if (response.ok) {
        setFormData({ name: '', email: '', subject: '', message: '', website: '' });
        setEventDetails(EMPTY_EVENT_DETAILS);
        setFormStatus({ type: 'idle', message: '' });
        setShowSuccessModal(true);
        trackEvent('Contact Submit');
      } else if (response.status === 429) {
        setFormStatus({
          type: 'error',
          message: 'Too many requests. Please try again in a few minutes.',
        });
      } else {
        setFormStatus({
          type: 'error',
          message: result.error || 'Failed to send message. Please try again.',
        });
      }
    } catch (error) {
      log.error('send_failed', { error: error instanceof Error ? error.message : String(error) });
      if (error instanceof Error && error.name === 'AbortError') {
        setFormStatus({
          type: 'error',
          message: 'Request timed out. Please try again.',
        });
      } else {
        setFormStatus({
          type: 'error',
          message: 'Network error. Please check your connection and try again.',
        });
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  const handleEventDetailChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setEventDetails((prev) => ({ ...prev, [name]: value }));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    // Clear this field's validation error as the user corrects it
    if (fieldErrors[name as FieldName]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[name as FieldName];
        return next;
      });
    }
  };

  return (
    <div className="min-h-screen pt-20">
      <SEO
        title="Contact & Speaking"
        description="Book Christian Perez for speaking engagements, podcasts, or media interviews. Topics include cloud & AI strategy, veteran entrepreneurship, and leadership."
        keywords="contact Christian Perez, speaking engagements, keynote speaker, veteran speaker, cloud consulting, AI integration services, podcast guest, media appearances"
        url="https://thechrisgrey.com/contact"
        imageAlt="Contact Christian Perez — speaking engagements, media inquiries, and Altivum Logic consulting"
        faq={contactFAQs}
        breadcrumbs={breadcrumbs}
        structuredData={[buildContactPageSchema()]}
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
              Let's Connect
            </h1>
            <div className="h-px w-24 bg-altivum-gold mb-8"></div>

            {/* Direct-answer summary — first viewport, before the first H2 (VAL-AEO-001, VAL-AEO-002). */}
            <DirectAnswerSummary text={AEO_SUMMARIES['/contact']} className="max-w-2xl" />
          </div>
        </div>
      </section>

      {/* Speaking & Media Section */}
      <div className="h-px bg-linear-to-r from-transparent via-altivum-gold/15 to-transparent" />
      <section className="py-20 bg-altivum-navy/30">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
            {/* Speaking Topics */}
            <div>
              <h2 id={slugify('Speaking & Media')} className="text-white mb-6" style={typography.sectionHeader}>
                Speaking & Media
              </h2>
              <p className="text-altivum-silver mb-8" style={typography.bodyText}>
                Available for keynotes, panels, podcasts, and media appearances on topics including:
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  { icon: 'cloud', title: 'Cloud & AI Strategy', desc: 'Enterprise transformation and emerging tech' },
                  { icon: 'military_tech', title: 'Veteran Transition', desc: 'Military to civilian career success' },
                  { icon: 'rocket_launch', title: 'Entrepreneurship', desc: 'Building veteran-owned businesses' },
                  { icon: 'psychology', title: 'Leadership', desc: 'Special Operations lessons for business' },
                ].map((topic) => (
                  <div
                    key={topic.title}
                    className="p-5 bg-altivum-dark/50 border border-white/5 hover:border-altivum-gold/30 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-altivum-gold/5 transition-all duration-300"
                  >
                    <Icon name={topic.icon} className="text-altivum-gold mb-3 block" />
                    <h3 id={slugify(topic.title)} className="text-white text-sm font-medium mb-1">
                      {topic.title}
                    </h3>
                    <p className="text-altivum-silver text-xs">{topic.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Event Types & Press Kit */}
            <div className="lg:pt-16">
              <h3 id={slugify('Event Types')} className="text-white mb-6" style={typography.cardTitleLarge}>
                Event Types
              </h3>
              <ul className="space-y-3 mb-10">
                {[
                  'Keynote presentations',
                  'Panel discussions',
                  'Podcast guest appearances',
                  'Corporate workshops',
                  'Media interviews',
                  'Veteran organization events',
                ].map((item) => (
                  <li key={item} className="flex items-center text-altivum-silver">
                    <Icon name="arrow_forward" className="text-altivum-gold mr-3 text-sm" />
                    {item}
                  </li>
                ))}
              </ul>

              {/* Press Kit Download */}
              <div className="p-6 bg-altivum-dark border border-altivum-gold/20">
                <h4 className="text-white mb-2" style={typography.cardTitleSmall}>
                  For Event Organizers
                </h4>
                <p className="text-altivum-silver text-sm mb-4">
                  Download press materials including bio and headshots for promotional use.
                </p>
                <a
                  href="/press-kit.zip"
                  download
                  className="inline-flex items-center gap-2 px-5 py-3 bg-altivum-gold/10 border border-altivum-gold text-altivum-gold text-sm font-medium uppercase tracking-wider hover:bg-altivum-gold hover:text-altivum-dark transition-all duration-300"
                >
                  <Icon name="download" className="text-lg" />
                  Download Press Kit
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>
      <div className="h-px bg-linear-to-r from-transparent via-altivum-gold/15 to-transparent" />

      {/* Contact Form Section */}
      <section className="py-24 bg-altivum-dark">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
            {/* Contact Form */}
            <div>
              <h2 id={slugify('Send a Message')} className="text-white mb-8" style={typography.sectionHeader}>
                Send a Message
              </h2>
              <form className="space-y-10" onSubmit={handleSubmit} noValidate>
                <div className="group">
                  <label
                    htmlFor="intent"
                    className="block text-xs font-medium text-altivum-silver mb-3 uppercase tracking-widest"
                  >
                    I'm Reaching Out About
                  </label>
                  <select
                    id="intent"
                    name="intent"
                    value={intent}
                    onChange={(e) => setIntent(e.target.value as ContactIntent)}
                    className={SELECT_CLASS}
                  >
                    {CONTACT_INTENTS.map((option) => (
                      <option key={option.value} value={option.value} className="bg-altivum-navy">
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                {intent === 'speaking' && (
                  <fieldset className="space-y-8 border border-altivum-gold/20 p-6">
                    <legend className="px-2 text-xs font-medium text-altivum-gold uppercase tracking-widest">
                      Event Details
                    </legend>
                    <div className="group">
                      <label
                        htmlFor="organization"
                        className="block text-xs font-medium text-altivum-silver mb-3 uppercase tracking-widest"
                      >
                        Organization
                      </label>
                      <input
                        type="text"
                        id="organization"
                        name="organization"
                        value={eventDetails.organization}
                        onChange={handleEventDetailChange}
                        maxLength={200}
                        className="w-full px-0 py-4 bg-transparent border-b-2 border-white/10 text-white placeholder-white/70 focus:border-altivum-gold transition-all duration-300 rounded-none"
                        placeholder="Who's hosting the event?"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                      <div className="group">
                        <label
                          htmlFor="eventDate"
                          className="block text-xs font-medium text-altivum-silver mb-3 uppercase tracking-widest"
                        >
                          Event Date
                        </label>
                        <input
                          type="date"
                          id="eventDate"
                          name="eventDate"
                          value={eventDetails.eventDate}
                          onChange={handleEventDetailChange}
                          className="w-full px-0 py-4 bg-transparent border-b-2 border-white/10 text-white focus:border-altivum-gold transition-all duration-300 rounded-none [color-scheme:dark]"
                        />
                      </div>
                      <div className="group">
                        <label
                          htmlFor="audienceSize"
                          className="block text-xs font-medium text-altivum-silver mb-3 uppercase tracking-widest"
                        >
                          Audience Size
                        </label>
                        <select
                          id="audienceSize"
                          name="audienceSize"
                          value={eventDetails.audienceSize}
                          onChange={handleEventDetailChange}
                          className={SELECT_CLASS}
                        >
                          <option value="" className="bg-altivum-navy">
                            Select a range
                          </option>
                          {AUDIENCE_SIZES.map((size) => (
                            <option key={size} value={size} className="bg-altivum-navy">
                              {size}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="group">
                      <label
                        htmlFor="eventFormat"
                        className="block text-xs font-medium text-altivum-silver mb-3 uppercase tracking-widest"
                      >
                        Event Format
                      </label>
                      <select
                        id="eventFormat"
                        name="eventFormat"
                        value={eventDetails.eventFormat}
                        onChange={handleEventDetailChange}
                        className={SELECT_CLASS}
                      >
                        <option value="" className="bg-altivum-navy">
                          Select a format
                        </option>
                        {EVENT_FORMATS.map((format) => (
                          <option key={format} value={format} className="bg-altivum-navy">
                            {format}
                          </option>
                        ))}
                      </select>
                    </div>
                  </fieldset>
                )}

                <div className="group">
                  <label
                    htmlFor="name"
                    className="block text-xs font-medium text-altivum-gold mb-3 uppercase tracking-widest"
                  >
                    Name *
                  </label>
                  <input
                    type="text"
                    id="name"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    required
                    minLength={2}
                    maxLength={100}
                    aria-invalid={fieldErrors.name ? true : undefined}
                    aria-describedby={fieldErrors.name ? 'name-error' : undefined}
                    className="w-full px-0 py-4 bg-transparent border-b-2 border-white/10 text-white placeholder-white/70 focus:border-altivum-gold transition-all duration-300 rounded-none"
                    placeholder="Your name"
                  />
                  {fieldErrors.name && (
                    <p id="name-error" className="mt-2 text-sm text-red-400" role="alert">
                      {fieldErrors.name}
                    </p>
                  )}
                </div>

                <div className="group">
                  <label
                    htmlFor="email"
                    className="block text-xs font-medium text-altivum-gold mb-3 uppercase tracking-widest"
                  >
                    Email *
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    required
                    maxLength={255}
                    aria-invalid={fieldErrors.email ? true : undefined}
                    aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                    className="w-full px-0 py-4 bg-transparent border-b-2 border-white/10 text-white placeholder-white/70 focus:border-altivum-gold transition-all duration-300 rounded-none"
                    placeholder="your@email.com"
                  />
                  {fieldErrors.email && (
                    <p id="email-error" className="mt-2 text-sm text-red-400" role="alert">
                      {fieldErrors.email}
                    </p>
                  )}
                </div>

                <div className="group">
                  <label
                    htmlFor="subject"
                    className="block text-xs font-medium text-altivum-silver mb-3 uppercase tracking-widest"
                  >
                    Subject
                  </label>
                  <input
                    type="text"
                    id="subject"
                    name="subject"
                    value={formData.subject}
                    onChange={handleChange}
                    maxLength={200}
                    className="w-full px-0 py-4 bg-transparent border-b-2 border-white/10 text-white placeholder-white/70 focus:border-altivum-gold transition-all duration-300 rounded-none"
                    placeholder="What's this about?"
                  />
                </div>

                <div className="group">
                  <label
                    htmlFor="message"
                    className="block text-xs font-medium text-altivum-gold mb-3 uppercase tracking-widest"
                  >
                    Message *
                  </label>
                  <textarea
                    id="message"
                    name="message"
                    value={formData.message}
                    onChange={handleChange}
                    required
                    minLength={10}
                    maxLength={5000}
                    rows={6}
                    aria-invalid={fieldErrors.message ? true : undefined}
                    aria-describedby={fieldErrors.message ? 'message-error' : undefined}
                    className="w-full px-0 py-4 bg-transparent border-b-2 border-white/10 text-white placeholder-white/70 focus:border-altivum-gold transition-all duration-300 resize-none rounded-none"
                    placeholder="Tell me what you're thinking..."
                  ></textarea>
                  {fieldErrors.message && (
                    <p id="message-error" className="mt-2 text-sm text-red-400" role="alert">
                      {fieldErrors.message}
                    </p>
                  )}
                </div>

                {/* Honeypot field - hidden from users */}
                <div
                  style={{ position: 'absolute', left: '-9999px', opacity: 0, pointerEvents: 'none' }}
                  aria-hidden="true"
                >
                  <label htmlFor="website">Website (leave blank)</label>
                  <input
                    type="text"
                    id="website"
                    name="website"
                    value={formData.website}
                    onChange={handleChange}
                    tabIndex={-1}
                    autoComplete="off"
                  />
                </div>

                {/* Status Message */}
                {formStatus.message && (
                  <div
                    className={`p-5 rounded-xs backdrop-blur-xs transition-all duration-300 ${
                      formStatus.type === 'error'
                        ? 'bg-red-900/30 border-l-4 border-red-500 text-red-300'
                        : 'bg-altivum-blue/30 border-l-4 border-altivum-gold text-altivum-gold'
                    }`}
                    role="alert"
                  >
                    {formStatus.message}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={formStatus.type === 'loading'}
                  className={`group relative px-12 py-5 font-medium uppercase tracking-wider text-sm overflow-hidden transition-all duration-300 ${
                    formStatus.type === 'loading'
                      ? 'bg-altivum-slate/50 text-altivum-silver cursor-not-allowed'
                      : 'bg-altivum-gold text-altivum-dark hover:bg-white hover:shadow-[0_0_30px_rgba(197,165,114,0.3)]'
                  }`}
                >
                  <span className="relative z-10">{formStatus.type === 'loading' ? 'Sending...' : 'Send Message'}</span>
                  {formStatus.type !== 'loading' && (
                    <span className="absolute inset-0 bg-white transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left"></span>
                  )}
                </button>
              </form>
            </div>

            {/* Contact Information */}
            <div className="space-y-12 lg:pt-20">
              <div>
                <h2 id={slugify('Other Ways to Connect')} className="text-white mb-6" style={typography.cardTitleLarge}>
                  Other Ways to Connect
                </h2>
                <p className="text-altivum-silver" style={typography.bodyText}>
                  Prefer a different communication method? I'm available through various channels and typically respond
                  within 24-48 hours.
                </p>
              </div>

              {/* Contact Cards */}
              <div className="space-y-6">
                {CONTACT_CHANNELS.map((channel) => (
                  <a
                    key={channel.title}
                    href={channel.href}
                    {...(channel.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                    className="block group"
                  >
                    <div className="flex items-start gap-6">
                      <div className="w-12 h-12 flex items-center justify-center text-altivum-gold/50 group-hover:text-altivum-gold transition-colors">
                        {channel.kind === 'icon' ? (
                          <Icon name={channel.icon} className="text-3xl" />
                        ) : (
                          <SocialIcon platform={channel.platform} />
                        )}
                      </div>
                      <div>
                        <h3
                          id={slugify(channel.title)}
                          className="text-white mb-1 group-hover:text-altivum-gold transition-colors"
                          style={typography.cardTitleSmall}
                        >
                          {channel.title}
                        </h3>
                        <p className="text-altivum-silver text-sm">{channel.detail}</p>
                      </div>
                    </div>
                  </a>
                ))}
              </div>

              {/* Location & Availability */}
              <div
                className="pt-8 border-t border-white/3"
                style={{ borderImage: 'linear-gradient(to right, transparent, rgba(197,165,114,0.15), transparent) 1' }}
              >
                <h3 id={slugify('Availability')} className="text-white mb-4" style={typography.cardTitleSmall}>
                  Availability
                </h3>
                <ul className="space-y-3">
                  <li className="flex items-center text-altivum-silver">
                    <Icon name="check_circle" className="text-altivum-gold mr-3 text-sm" />
                    Virtual consultations available
                  </li>
                  <li className="flex items-center text-altivum-silver">
                    <Icon name="check_circle" className="text-altivum-gold mr-3 text-sm" />
                    Speaking engagements
                  </li>
                  <li className="flex items-center text-altivum-silver">
                    <Icon name="check_circle" className="text-altivum-gold mr-3 text-sm" />
                    Podcast guest appearances
                  </li>
                  <li className="flex items-center text-altivum-silver">
                    <Icon name="check_circle" className="text-altivum-gold mr-3 text-sm" />
                    Strategic consulting
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Social proof for speaking/consulting (renders only once real testimonials exist) */}
      <Testimonials eyebrow="Trusted by" heading="What clients and partners say" />

      {/* Visible FAQ — mirrors the FAQPage JSON-LD emitted by <SEO faq={contactFAQs}>
          so the DOM text and structured data agree (VAL-AEO-004). */}
      <FAQSection faqs={contactFAQs} />

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
            aria-labelledby="contact-modal-title"
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
                <Icon name="check_circle" className="text-altivum-gold text-4xl" />
              </div>

              <h3 id="contact-modal-title" className="text-white mb-4" style={typography.cardTitleLarge}>
                Thank You!
              </h3>

              <p className="text-altivum-silver mb-8" style={typography.bodyText} role="status" aria-live="polite">
                Thanks for contacting me. I'll reach back as soon as possible.
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

      {/* Leave Page Confirmation Modal */}
    </div>
  );
};

export default Contact;
