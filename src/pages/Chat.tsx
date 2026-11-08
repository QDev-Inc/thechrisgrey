import { useCallback, useRef, useState } from 'react';
import { SEO } from '../components/SEO';
import Breadcrumbs from '../components/Breadcrumbs';
import { typography } from '../utils/typography';
import ChatMessage from '../components/chat/ChatMessage';
import ChatInput, { type ChatInputHandle } from '../components/chat/ChatInput';
import ChatSuggestions from '../components/chat/ChatSuggestions';
import ForgetStatusBanner, { type ForgetStatus } from '../components/chat/ForgetStatusBanner';
import CapabilityIntro from '../components/chat/CapabilityIntro';
import TypingIndicator from '../components/chat/TypingIndicator';
import ErrorBoundary from '../components/ErrorBoundary';
import { ChatErrorFallback } from '../components/ErrorFallbacks';
import { useChatEngine, usePageContext, CHAT_STORAGE_KEY } from '../hooks';
// Imported from the hook module rather than the barrel: the confirmation copy
// lives beside the forget implementation so both surfaces prompt with one string.
import { FORGET_CONFIRMATION } from '../hooks/useChatEngine';
import { getSuggestionsForPage } from '../utils/pageContext';
import Icon from '../components/icons/Icon';

const breadcrumbs = [
  { name: 'Home', url: 'https://thechrisgrey.com' },
  { name: 'Alti', url: 'https://thechrisgrey.com/chat' },
];

const ChatContent = () => {
  const pageContext = usePageContext();
  // /chat starter chips are context-specific (tool-powered prompts declared on
  // the /chat route in routes.ts), not the generic DEFAULT_SUGGESTIONS fallback
  // (VAL-ENG-011). getSuggestionsForPage resolves the /chat entry directly.
  const chatSuggestions = getSuggestionsForPage(pageContext.currentPage);
  const {
    messages,
    isTyping,
    isStreaming,
    isForgetting,
    streamingMessageId,
    messagesContainerRef,
    hasUserMessages,
    showSuggestions,
    handleSend,
    handleClearConversation,
    handleSuggestionSelect,
    handleForgetMemory,
  } = useChatEngine(pageContext);

  const chatInputRef = useRef<ChatInputHandle>(null);
  const handleUseExample = useCallback((example: string) => {
    chatInputRef.current?.prefill(example);
  }, []);

  // Outcome goes to the in-page banner, not window.alert: a privacy action gets
  // the same designed, dismissible report on both surfaces (see the widget's
  // header banner), and a thread-blocking browser dialog never sits over the
  // conversation. The confirm prompt stays native — it is the destructive gate.
  const [forgetStatus, setForgetStatus] = useState<ForgetStatus | null>(null);

  const onForget = async () => {
    if (!window.confirm(FORGET_CONFIRMATION)) return;
    setForgetStatus({ ok: true, message: 'Clearing your saved facts…' });
    const result = await handleForgetMemory();
    if (result.ok) {
      setForgetStatus({
        ok: true,
        message: `Done — I've forgotten ${result.deleted ?? 0} saved item(s). Next time we talk, I'll start fresh.`,
      });
    } else {
      setForgetStatus({
        ok: false,
        message: `Unable to clear right now: ${result.error || 'Unknown error.'} Please try again.`,
      });
    }
  };

  return (
    // h-screen gives the app-like layout: header and composer are fixed chrome and
    // the conversation scrolls between them. Only those two are non-shrinkable, so
    // the composer stays on screen at any viewport height — see the note on the
    // scroller below for why the capability rail is not a third fixed child.
    //
    // overflow-y-auto is a deliberate backstop rather than the primary mechanism.
    // This shell was overflow-hidden, and when its children outgrew 100vh the
    // composer was clipped past the edge with no way to scroll to it — the chat
    // input was simply unreachable below ~972px of viewport height. Failing over to
    // a scroll keeps that class of bug from ever making the input unreachable again.
    // data-lenis-prevent lets it take the wheel/touch gesture natively rather than
    // having site-wide Lenis hijack it.
    <div
      className="h-[calc(100dvh-var(--consent-bottom,0px))] pt-20 flex flex-col bg-altivum-dark overflow-y-auto"
      data-lenis-prevent
    >
      <SEO
        title="Alti - Altivum's AI Agent"
        description="Meet Alti, Altivum's AI agent. Have a conversation about Christian Perez's journey from Green Beret to tech founder, Altivum Inc, The Vector Podcast, and more."
        keywords="Alti, AI agent, Christian Perez, conversation, Altivum, veteran entrepreneur"
        url="https://thechrisgrey.com/chat"
        breadcrumbs={breadcrumbs}
        noindex={true}
      />

      {/* Header */}
      <div className="border-b border-white/10 bg-altivum-dark/80 backdrop-blur-xs">
        <div className="max-w-4xl mx-auto px-6 py-6 flex items-start justify-between">
          <div>
            {/* Visible breadcrumb trail — mirrors the BreadcrumbList JSON-LD
                emitted by <SEO> above. Sits above the Alti heading so the
                current-page crumb anchors the visitor within the site. */}
            <Breadcrumbs items={breadcrumbs} className="mb-3" />
            <h1 className="text-white mb-2" style={typography.cardTitleLarge}>
              Alti<sup className="text-xs">TM</sup>
            </h1>
            <p className="text-altivum-silver" style={typography.smallText}>
              Ask me anything about Christian, Altivum, the podcast, or his book.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {hasUserMessages && (
              <button
                onClick={handleClearConversation}
                className="flex items-center gap-2 px-4 py-2 text-altivum-silver hover:text-white border border-white/20 hover:border-white/40 rounded-sm transition-colors duration-200 text-sm"
                aria-label="Clear conversation"
              >
                <Icon name="refresh" className="text-base" />
                <span className="hidden sm:inline">Clear</span>
              </button>
            )}
            {/* Disabled while the delete is in flight so impatient repeat clicks
                cannot stack concurrent /forget requests against the partition. */}
            <button
              onClick={onForget}
              disabled={isForgetting}
              className="flex items-center gap-2 px-4 py-2 text-altivum-silver hover:text-white border border-white/20 hover:border-white/40 rounded-sm transition-colors duration-200 text-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-altivum-silver"
              aria-label="Forget what I told Alti"
            >
              <Icon name="delete_sweep" className="text-base" />
              <span className="hidden sm:inline">Forget me</span>
            </button>
          </div>
        </div>
      </div>

      <ForgetStatusBanner status={forgetStatus} onDismiss={() => setForgetStatus(null)} />

      {/* Messages Container — data-lenis-prevent lets this inner scroller take the
          wheel/touch natively; without it site-wide Lenis hijacks the gesture and the
          conversation can't be scrolled. min-h-0 is required: a flex child defaults to
          min-height:auto, so without it this pane refuses to shrink below its content
          and pushes the composer out of the shell on short viewports. */}
      <div ref={messagesContainerRef} className="flex-1 min-h-0 overflow-y-auto" data-lenis-prevent>
        {/* Capability rail — surfaces Alti's tool-driven powers without forcing trial-and-error.
            Initially expanded on cold start (no user messages yet) so first-time visitors
            discover it; collapses to a one-line chip the moment they engage.

            It lives inside the scroller rather than beside it because it is content, not
            chrome: as a fixed sibling its expanded height (~400px) combined with the header
            and composer exceeded 100vh, which pushed the composer out of the shell entirely
            on 1366x768 and 1280x720 laptops. Only the header and composer are chrome now, so
            the composer stays pinned and reachable at any viewport height. */}
        <CapabilityIntro onUseExample={handleUseExample} initiallyExpanded={showSuggestions} />

        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="space-y-6" role="log" aria-live="polite" aria-label="Chat messages">
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                role={message.role}
                content={message.content}
                isStreaming={message.id === streamingMessageId}
                isSystem={message.isSystem}
                drafts={message.drafts}
                uiBlocks={message.uiBlocks}
                toolActivity={message.toolActivity}
                memoryEvents={message.memoryEvents}
                surface="page"
              />
            ))}
            {isTyping && <TypingIndicator />}
          </div>
        </div>

        {/* Suggestions */}
        {showSuggestions && (
          <div className="max-w-4xl mx-auto">
            <ChatSuggestions onSelect={handleSuggestionSelect} suggestions={chatSuggestions} />
          </div>
        )}
      </div>

      {/* Input Area */}
      <ChatInput ref={chatInputRef} onSend={handleSend} disabled={isTyping || isStreaming} />
    </div>
  );
};

// Clear chat storage on error reset
const handleChatErrorReset = () => {
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(CHAT_STORAGE_KEY);
  }
};

const Chat = () => {
  return (
    // showHomeButton is deliberately NOT passed: ErrorBoundary returns `fallback`
    // before it ever consults that prop, so passing it reads as configuration
    // that does nothing. ChatErrorFallback owns its own affordances.
    <ErrorBoundary
      fallback={<ChatErrorFallback onRetry={handleChatErrorReset} />}
      onReset={handleChatErrorReset}
      pageName="Chat"
    >
      <ChatContent />
    </ErrorBoundary>
  );
};

export default Chat;
