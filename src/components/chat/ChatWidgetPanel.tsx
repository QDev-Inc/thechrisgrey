import { useState } from 'react';
import { useFocusTrap, useChatEngine, usePageContext } from '../../hooks';
import { useViewTransitionNavigate } from '../../hooks/useViewTransitionNavigate';
// Imported from the hook module rather than the barrel: the confirmation copy
// lives beside the forget implementation so both surfaces prompt with one string.
import { FORGET_CONFIRMATION } from '../../hooks/useChatEngine';
import { typography } from '../../utils/typography';
import { getSuggestionsForPage } from '../../utils/pageContext';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import ChatSuggestions from './ChatSuggestions';
import ForgetStatusBanner, { type ForgetStatus } from './ForgetStatusBanner';
import TypingIndicator from './TypingIndicator';
import Icon from '../icons/Icon';

interface ChatWidgetPanelProps {
  onClose: () => void;
}

// Starter chip that asks Alti to list whatever it has stored about the visitor
// (VAL-ENG-013). Surfaced as a distinct, always-present affordance alongside the
// page-specific starter chips so a returning visitor can audit their stored
// facts without typing. The backend answers from VISITOR MEMORY in the system
// prompt; after /forget it reports no stored facts.
const MEMORY_INSPECTION_PROMPT = 'What do you know about me?';

const ChatWidgetPanel = ({ onClose }: ChatWidgetPanelProps) => {
  // useViewTransitionNavigate, not raw useNavigate: expanding into /chat is the
  // one navigation this panel owns, and it should crossfade like every other
  // route change on the site instead of hard-cutting.
  const navigate = useViewTransitionNavigate();
  const { containerRef, handleKeyDown } = useFocusTrap(true);
  const pageContext = usePageContext();
  const contextualSuggestions = getSuggestionsForPage(pageContext.currentPage);

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

  // Distinct, in-panel confirmation for /forget (VAL-ENG-013). Kept separate
  // from the clear/reset control's behavior: clear only drops the local
  // transcript; forget-me wipes server-side facts AND client identifiers and
  // surfaces its own confirmation banner so the visitor knows memory is gone.
  const [forgetStatus, setForgetStatus] = useState<ForgetStatus | null>(null);

  const handleExpand = () => {
    onClose();
    navigate('/chat');
  };

  const handlePanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    handleKeyDown(e);
  };

  const onForgetMe = async () => {
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
    <>
      <div className="fixed inset-0 z-30 bg-black/50 sm:hidden" onClick={onClose} aria-hidden="true" />
      <div
        ref={containerRef}
        onKeyDown={handlePanelKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label="Alti - Altivum's AI Agent"
        className="fixed bottom-[calc(6rem+var(--consent-bottom,0px))] right-4 sm:right-6 z-40 w-[calc(100vw-2rem)] h-[calc(100dvh-11rem-var(--consent-bottom,0px))] sm:w-[400px] sm:h-[560px] bg-altivum-navy border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-widget-open"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-altivum-dark/60 backdrop-blur-xs shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-white text-sm" style={typography.smallText}>
              Alti<sup className="text-[8px]">TM</sup>
            </span>
          </div>
          <div className="flex items-center gap-1">
            {/* Forget-me (VAL-ENG-013): always present and DISTINCT from the
                clear/reset control below. Clear only drops the local transcript;
                forget-me wipes server-side facts AND client identifiers and
                surfaces its own confirmation banner. A returning visitor can
                forget without first sending a message, so it is not gated on
                hasUserMessages. Disabled while the delete is in flight so
                impatient repeat clicks cannot stack concurrent /forget requests
                against the same partition. */}
            <button
              onClick={onForgetMe}
              disabled={isForgetting}
              className="p-1.5 text-altivum-silver hover:text-white rounded-sm transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-altivum-silver"
              aria-label="Forget me"
              title="Forget me — delete everything Alti has saved about you"
            >
              <Icon name="delete_sweep" className="text-lg" />
            </button>
            {hasUserMessages && (
              <button
                onClick={handleClearConversation}
                className="p-1.5 text-altivum-silver hover:text-white rounded-sm transition-colors duration-200"
                aria-label="Clear conversation"
              >
                <Icon name="refresh" className="text-lg" />
              </button>
            )}
            <button
              onClick={handleExpand}
              className="p-1.5 text-altivum-silver hover:text-white rounded-sm transition-colors duration-200"
              aria-label="Open full chat"
            >
              <Icon name="open_in_full" className="text-lg" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-altivum-silver hover:text-white rounded-sm transition-colors duration-200"
              aria-label="Close chat"
            >
              <Icon name="close" className="text-lg" />
            </button>
          </div>
        </div>

        {/* Forget-me confirmation banner — distinct from the clear/reset control
            and its behavior. Shown only after a /forget attempt. Shared with
            /chat so a privacy action reports identically on both surfaces;
            shrink-0 keeps it out of this panel's flex-column shrink budget. */}
        <ForgetStatusBanner status={forgetStatus} onDismiss={() => setForgetStatus(null)} className="shrink-0" />

        {/* Messages */}
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto" data-lenis-prevent>
          <div className="px-4 py-4">
            <div className="space-y-4" role="log" aria-live="polite" aria-label="Chat messages">
              {messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  role={message.role}
                  content={message.content}
                  isStreaming={message.id === streamingMessageId}
                  isSystem={message.isSystem}
                  drafts={message.drafts}
                  toolActivity={message.toolActivity}
                  memoryEvents={message.memoryEvents}
                  surface="widget"
                />
              ))}
              {isTyping && <TypingIndicator />}
            </div>
          </div>

          {showSuggestions && (
            <>
              {/* Memory-inspection affordance (VAL-ENG-013): a distinct, always-
                  present starter chip that asks Alti to list the facts it has
                  stored about the visitor. Rendered above the page-specific
                  starter chips and styled with a gold accent so it reads as a
                  transparency/GDPR affordance rather than a topic suggestion.
                  After /forget, Alti reports no stored facts. */}
              <div className="px-4 pt-4">
                <button
                  onClick={() => handleSuggestionSelect(MEMORY_INSPECTION_PROMPT)}
                  className="w-full px-4 py-2 border border-altivum-gold/40 rounded-full text-altivum-gold hover:bg-altivum-gold/10 transition-all duration-200 text-sm touch-manipulation flex items-center justify-center gap-2"
                >
                  <Icon name="psychology" className="text-sm" aria-hidden="true" />
                  <span>{MEMORY_INSPECTION_PROMPT}</span>
                </button>
              </div>
              <ChatSuggestions onSelect={handleSuggestionSelect} suggestions={contextualSuggestions} />
            </>
          )}
        </div>

        {/* Input */}
        <ChatInput onSend={handleSend} disabled={isTyping || isStreaming} />
      </div>
    </>
  );
};

export default ChatWidgetPanel;
