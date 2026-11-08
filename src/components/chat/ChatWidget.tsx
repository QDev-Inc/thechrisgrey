import { useState, lazy, Suspense } from 'react';
import ChatWidgetButton from './ChatWidgetButton';
import ErrorBoundary from '../ErrorBoundary';
import Icon from '../icons/Icon';
import { typography } from '../../utils/typography';
import { isMotionDisabled } from '../../utils/motion';
import { trackEvent } from '../../utils/analytics';

// The chat panel (message list, input, suggestions, focus trap, chat engine)
// is only mounted when the visitor opens the widget, so it is code-split into
// its own chunk (VAL-PERF-013): the "chat widget shell" (the dialog UI) is a
// separate dynamic chunk that is not in the initial critical request chain.
// The button stays statically imported so the always-visible launcher renders
// immediately and is prerendered. The 3D mascot (AltiMascot) and three-vendor
// library are already separate lazy chunks via ChatWidgetButton.
const ChatWidgetPanel = lazy(() => import('./ChatWidgetPanel'));

// Panel geometry, shared by the real dialog and both stand-ins below so a cold
// chunk fetch or a render throw occupies exactly the box the dialog will. Keep
// in sync with ChatWidgetPanel's container.
const PANEL_SHELL =
  'fixed bottom-[calc(6rem+var(--consent-bottom,0px))] right-4 sm:right-6 z-40 w-[calc(100vw-2rem)] h-[calc(100dvh-11rem-var(--consent-bottom,0px))] sm:w-[400px] sm:h-[560px] bg-altivum-navy border border-white/10 rounded-2xl shadow-2xl';

// The sessionStorage key owned by useChatEngine (CHAT_STORAGE_KEY), mirrored here
// as a literal on purpose: importing it would pull the chat engine — and with it
// sessionToken, chatEvents and the logger — into the eager widget chunk, undoing
// the code-split above. ChatWidget.test.tsx asserts against the real exported key
// so a rename cannot drift silently.
const CHAT_TRANSCRIPT_KEY = 'chat-messages';

// Panel-shaped placeholder for the chunk fetch. A null fallback rendered nothing
// at all, so on a cold or throttled network the click flipped aria-expanded to
// true with no dialog anywhere and focus still sitting on the launcher.
const PanelLoadingFallback = () => (
  <div className={`${PANEL_SHELL} flex items-center justify-center`} role="status" aria-label="Loading chat">
    <div
      className={`w-8 h-8 border-2 border-altivum-gold/30 border-t-altivum-gold rounded-full ${
        isMotionDisabled() ? '' : 'animate-spin'
      }`}
      aria-hidden="true"
    />
  </div>
);

// Compact, in-place failure state — deliberately not the full-viewport
// ChatErrorFallback used by /chat, which would black out the page behind a
// 400x560 widget.
const PanelErrorFallback = ({ onRestart }: { onRestart: () => void }) => (
  <div className={`${PANEL_SHELL} flex flex-col items-center justify-center gap-4 px-6 text-center`} role="alert">
    <Icon name="chat" className="text-altivum-gold text-3xl" aria-hidden="true" />
    <p className="text-altivum-silver" style={typography.smallText}>
      Chat is unavailable right now. Starting fresh usually fixes it.
    </p>
    <button
      onClick={onRestart}
      className="px-5 py-2 bg-altivum-gold text-altivum-dark font-medium uppercase tracking-wider text-xs hover:bg-white transition-colors duration-300"
    >
      Start fresh
    </button>
  </div>
);

const ChatWidget = () => {
  const [isOpen, setIsOpen] = useState(false);

  const toggle = () => {
    // Fire the engagement goal only on open (not on close). Read isOpen from the
    // closure rather than inside the updater — StrictMode double-invokes updaters,
    // which would double-count the event.
    if (!isOpen) trackEvent('Chat Opened', { surface: 'widget' });
    setIsOpen((prev) => !prev);
  };

  // Mirrors /chat's recovery contract (Chat.tsx): drop the persisted transcript
  // before retrying. The widget and /chat share one sessionStorage transcript, so
  // a message payload that makes ChatMessage throw re-hydrates and re-throws on
  // every reopen otherwise — and the only escape hatch would be walking to /chat
  // and pressing its "Restart Chat" button. Cleared on the explicit retry rather
  // than at catch time so a transient chunk failure doesn't discard a real
  // conversation the visitor can still recover by reopening.
  const restartAfterPanelError = () => {
    try {
      window.sessionStorage.removeItem(CHAT_TRANSCRIPT_KEY);
    } catch {
      // Storage denied (private mode / blocked cookies) — closing the panel
      // still returns the visitor to a usable launcher.
    }
    setIsOpen(false);
  };

  return (
    <div data-vt-persist="chat-widget">
      {isOpen && (
        // The widget is the app's only subtree outside the route boundary in
        // App.tsx, so before this an unresolved chunk or a throw in
        // ChatWidgetPanel / ChatMessage / ToolDraftCard unmounted the entire
        // React root to a blank page. The boundary sits INSIDE the isOpen
        // branch, not around it: closing unmounts it, so the next open always
        // starts from a fresh, unlatched boundary. It is deliberately not keyed
        // by pathname — the widget is persistent across navigations
        // (data-vt-persist) and holds isOpen, which a pathname key would drop on
        // every route change.
        <ErrorBoundary fallback={<PanelErrorFallback onRestart={restartAfterPanelError} />} pageName="Chat Widget">
          <Suspense fallback={<PanelLoadingFallback />}>
            <ChatWidgetPanel onClose={() => setIsOpen(false)} />
          </Suspense>
        </ErrorBoundary>
      )}
      <ChatWidgetButton isOpen={isOpen} onClick={toggle} />
    </div>
  );
};

export default ChatWidget;
