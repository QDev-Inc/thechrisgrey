import { memo, useState } from 'react';
import { typography } from '../../utils/typography';
import { useViewTransitionNavigate } from '../../hooks/useViewTransitionNavigate';
import { isInternalPath, isSafeBlogSlug, isTrustedVideoUrl } from '../../utils/chatLinks';
import type { DraftAction } from '../../utils/chatEvents';
import NewsletterForm from '../NewsletterForm';
import Icon from '../icons/Icon';

interface ToolDraftCardProps {
  action: DraftAction;
  onDismiss?: () => void;
  onAccept?: () => void;
}

function IconButton({
  icon,
  label,
  onClick,
  variant = 'primary',
  disabled,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'ghost';
  disabled?: boolean;
}) {
  const base =
    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm min-h-[36px] transition-all active:scale-[0.98] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-altivum-gold focus-visible:outline-offset-2';
  const styles =
    variant === 'primary'
      ? 'bg-altivum-gold/10 text-altivum-gold border border-altivum-gold/40 hover:bg-altivum-gold/20'
      : 'text-altivum-silver border border-white/10 hover:bg-white/5';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${styles} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <Icon name={icon} className="text-base leading-none" />
      <span>{label}</span>
    </button>
  );
}

const ToolDraftCard = memo(function ToolDraftCard({ action, onDismiss, onAccept }: ToolDraftCardProps) {
  // useViewTransitionNavigate, not raw useNavigate: agent-driven navigations
  // crossfade like every ViewTransitionLink on the site, and the hook already
  // handles reduced-motion and browsers without startViewTransition.
  const navigate = useViewTransitionNavigate();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  const accepted = () => {
    setDismissed(true);
    onAccept?.();
  };

  if (action.action === 'navigate') {
    // Targets arrive over the stream as unchecked model output. When one fails
    // the guard the card still explains itself, minus the control that would
    // act on it — see src/utils/chatLinks.ts.
    const canOpen = isInternalPath(action.path);
    return (
      <div
        className="max-w-[90%] md:max-w-[80%] px-5 py-4 bg-white/5 border border-altivum-gold/30 rounded-2xl animate-fade-in"
        role="group"
        aria-label="Navigation suggestion"
      >
        <p className="text-altivum-silver flex items-start gap-2 mb-1" style={typography.smallText}>
          <Icon name="open_in_new" className="text-altivum-gold/70 text-lg mt-0.5 shrink-0" />
          <span>Suggested navigation</span>
        </p>
        <p className="text-altivum-gold mb-1" style={typography.bodyText}>
          Open <span className="font-medium">{action.path}</span>
        </p>
        <p className="text-altivum-silver/80 mb-3" style={typography.smallText}>
          {action.reason}
        </p>
        <div className="flex gap-2">
          {canOpen ? (
            <IconButton
              icon="arrow_forward"
              label="Take me there"
              onClick={() => {
                navigate(action.path);
                accepted();
              }}
            />
          ) : null}
          <IconButton icon="close" label="Dismiss" variant="ghost" onClick={dismiss} />
        </div>
      </div>
    );
  }

  if (action.action === 'contact') {
    const intentLabel: Record<string, string> = {
      speaking: 'Speaking invitation',
      podcast: 'Podcast invitation',
      consulting: 'Consulting inquiry',
      collaboration: 'Collaboration',
      media: 'Media / press',
      general: 'General inquiry',
    };
    const openContact = () => {
      navigate('/contact', {
        state: { draft: { subject: action.subject, message: action.body, intent: action.intent } },
      });
      accepted();
    };
    return (
      <div
        className="max-w-[90%] md:max-w-[80%] px-5 py-4 bg-white/5 border border-altivum-gold/30 rounded-2xl animate-fade-in"
        role="group"
        aria-label="Message draft"
      >
        <p className="text-altivum-silver flex items-start gap-2 mb-2" style={typography.smallText}>
          <Icon name="draft" className="text-altivum-gold/70 text-lg mt-0.5 shrink-0" />
          <span>{intentLabel[action.intent] || 'Draft message'}</span>
        </p>
        <p className="text-altivum-gold mb-1" style={typography.bodyText}>
          {action.subject}
        </p>
        <p className="text-altivum-silver/80 mb-3 whitespace-pre-wrap" style={typography.smallText}>
          {action.body}
        </p>
        <p className="text-altivum-silver/80 mb-3" style={typography.smallText}>
          You'll be sent to the contact form to review and send.
        </p>
        <div className="flex gap-2">
          <IconButton icon="edit" label="Review & send" onClick={openContact} />
          <IconButton icon="close" label="Dismiss" variant="ghost" onClick={dismiss} />
        </div>
      </div>
    );
  }

  if (action.action === 'newsletter') {
    // Render the capture form INLINE so the visitor can subscribe without leaving
    // the conversation. (Previously this navigated to /contact#newsletter — a page
    // with no newsletter form — so the agent's primary capture action did nothing.)
    return (
      <div
        className="max-w-[90%] md:max-w-[80%] px-5 py-4 bg-white/5 border border-altivum-gold/30 rounded-2xl animate-fade-in"
        role="group"
        aria-label="Newsletter suggestion"
      >
        <p className="text-altivum-silver flex items-start gap-2 mb-1" style={typography.smallText}>
          <Icon name="mail" className="text-altivum-gold/70 text-lg mt-0.5 shrink-0" />
          <span>Subscribe to Christian's updates</span>
        </p>
        <p className="text-altivum-silver/80 mb-4" style={typography.smallText}>
          {action.pitch}
        </p>
        <NewsletterForm variant="compact" source="chat" />
        <div className="flex gap-2 mt-3">
          <IconButton icon="close" label="Not now" variant="ghost" onClick={dismiss} />
        </div>
      </div>
    );
  }

  if (action.action === 'citation') {
    const canOpen = isSafeBlogSlug(action.slug);
    const openPost = () => {
      navigate(`/blog/${action.slug}`);
      accepted();
    };
    return (
      <div
        className="max-w-[90%] md:max-w-[80%] px-5 py-4 bg-white/5 border border-altivum-gold/30 rounded-2xl animate-fade-in"
        role="group"
        aria-label="Blog citation"
      >
        <p className="text-altivum-silver flex items-start gap-2 mb-1" style={typography.smallText}>
          <Icon name="article" className="text-altivum-gold/70 text-lg mt-0.5 shrink-0" />
          <span>From the blog</span>
        </p>
        <p className="text-altivum-gold mb-1" style={typography.bodyText}>
          {action.title}
        </p>
        {action.excerpt ? (
          <p className="text-altivum-silver/80 mb-3 italic" style={typography.smallText}>
            "{action.excerpt}"
          </p>
        ) : null}
        <div className="flex gap-2">
          {canOpen ? <IconButton icon="open_in_new" label="Read the post" onClick={openPost} /> : null}
          <IconButton icon="close" label="Dismiss" variant="ghost" onClick={dismiss} />
        </div>
      </div>
    );
  }

  if (action.action === 'podcast_citation') {
    // searchPodcast.mjs builds this URL from a hardcoded youtube.com prefix; the
    // parse keeps that a server DETAIL rather than the only thing standing
    // between a model-authored string and window.open().
    const canPlay = isTrustedVideoUrl(action.url);
    const playAtTimestamp = () => {
      window.open(action.url, '_blank', 'noopener,noreferrer');
      accepted();
    };
    return (
      <div
        className="max-w-[90%] md:max-w-[80%] px-5 py-4 bg-white/5 border border-altivum-gold/30 rounded-2xl animate-fade-in"
        role="group"
        aria-label="Podcast citation"
      >
        <p className="text-altivum-silver flex items-start gap-2 mb-1" style={typography.smallText}>
          <Icon name="podcasts" className="text-altivum-gold/70 text-lg mt-0.5 shrink-0" />
          <span>From The Vector Podcast</span>
        </p>
        <p className="text-altivum-gold mb-2" style={typography.bodyText}>
          {action.episodeTitle}
        </p>
        {action.quote ? (
          <p className="text-altivum-silver/80 mb-3 italic" style={typography.smallText}>
            "{action.quote}"
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {canPlay ? (
            <button
              type="button"
              onClick={playAtTimestamp}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm min-h-[36px] transition-all active:scale-[0.98] bg-altivum-gold/10 text-altivum-gold border border-altivum-gold/40 hover:bg-altivum-gold/20 hover:shadow-[0_0_20px_rgba(197,165,114,0.3)] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-altivum-gold focus-visible:outline-offset-2"
            >
              <Icon name="play_circle" className="text-base leading-none" />
              <span>Play at {action.timestampLabel}</span>
            </button>
          ) : null}
          <IconButton icon="close" label="Dismiss" variant="ghost" onClick={dismiss} />
        </div>
      </div>
    );
  }

  if (action.action === 'blog_search_results') {
    const results = action.results.filter((r) => isSafeBlogSlug(r.slug));
    if (results.length === 0) return null;
    const openPost = (slug: string) => {
      navigate(`/blog/${slug}`);
      accepted();
    };
    return (
      <div
        className="max-w-[90%] md:max-w-[80%] px-5 py-4 bg-white/5 border border-altivum-gold/30 rounded-2xl animate-fade-in"
        role="group"
        aria-label="Blog search results"
      >
        <p className="text-altivum-silver flex items-start gap-2 mb-2" style={typography.smallText}>
          <Icon name="menu_book" className="text-altivum-gold/70 text-lg mt-0.5 shrink-0" />
          <span>
            Posts matching <span className="text-altivum-gold">"{action.query}"</span>
          </span>
        </p>
        <ul className="space-y-3 mb-3">
          {results.map((result) => (
            <li key={result.slug} className="border-l-2 border-altivum-gold/40 pl-3">
              <p className="text-altivum-gold" style={typography.bodyText}>
                {result.title}
              </p>
              {result.excerpt ? (
                <p className="text-altivum-silver/80 mb-2 italic" style={typography.smallText}>
                  "{result.excerpt}"
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => openPost(result.slug)}
                className="inline-flex items-center gap-1 text-sm text-altivum-gold hover:underline focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-altivum-gold focus-visible:outline-offset-2 rounded-sm"
              >
                <Icon name="open_in_new" className="text-base leading-none" />
                <span>Read this post</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <IconButton icon="close" label="Dismiss all" variant="ghost" onClick={dismiss} />
        </div>
      </div>
    );
  }

  return null;
});

export default ToolDraftCard;
