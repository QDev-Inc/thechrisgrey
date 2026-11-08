import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ChatWidget from './ChatWidget';
// The widget mirrors this key as a literal to keep the chat engine out of its
// eager chunk; importing the real export here is what makes that mirror a
// checked contract instead of a comment.
import { CHAT_STORAGE_KEY } from '../../hooks/useChatEngine';

// Mock child components to isolate ChatWidget orchestration logic. The panel
// mock can be told to throw (a stale chunk, a poisoned message payload) or to
// suspend (a cold chunk fetch) so both containment paths are exercisable.
const panel = vi.hoisted(() => ({ shouldThrow: false, pending: null as Promise<void> | null }));
vi.mock('./ChatWidgetButton', () => ({
  default: ({ isOpen, onClick }: { isOpen: boolean; onClick: () => void }) => (
    <button data-testid="widget-button" onClick={onClick} aria-expanded={isOpen}>
      {isOpen ? 'Close' : 'Open'}
    </button>
  ),
}));

vi.mock('./ChatWidgetPanel', () => ({
  default: ({ onClose }: { onClose: () => void }) => {
    if (panel.shouldThrow) throw new Error('panel render failed');
    if (panel.pending) throw panel.pending;
    return (
      <div data-testid="widget-panel">
        <button onClick={onClose}>Close Panel</button>
      </div>
    );
  },
}));

describe('ChatWidget', () => {
  const renderWidget = () =>
    render(
      <MemoryRouter>
        <ChatWidget />
      </MemoryRouter>,
    );

  beforeEach(() => {
    panel.shouldThrow = false;
    panel.pending = null;
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render the button initially', () => {
    renderWidget();
    expect(screen.getByTestId('widget-button')).toBeInTheDocument();
  });

  it('should not show the panel initially', () => {
    renderWidget();
    expect(screen.queryByTestId('widget-panel')).not.toBeInTheDocument();
  });

  it('should open the panel when button is clicked', async () => {
    const user = userEvent.setup();
    renderWidget();

    await user.click(screen.getByTestId('widget-button'));
    // The panel is lazy-loaded (VAL-PERF-013), so it appears asynchronously
    // once the dynamic chunk resolves. findByTestId waits for it.
    expect(await screen.findByTestId('widget-panel')).toBeInTheDocument();
  });

  it('should close the panel when button is toggled again', async () => {
    const user = userEvent.setup();
    renderWidget();

    await user.click(screen.getByTestId('widget-button'));
    expect(await screen.findByTestId('widget-panel')).toBeInTheDocument();

    await user.click(screen.getByTestId('widget-button'));
    expect(screen.queryByTestId('widget-panel')).not.toBeInTheDocument();
  });

  it('should close the panel when onClose is called from the panel', async () => {
    const user = userEvent.setup();
    renderWidget();

    await user.click(screen.getByTestId('widget-button'));
    expect(await screen.findByTestId('widget-panel')).toBeInTheDocument();

    await user.click(screen.getByText('Close Panel'));
    expect(screen.queryByTestId('widget-panel')).not.toBeInTheDocument();
  });

  describe('panel chunk still in flight', () => {
    it('keeps the stand-in boxes identical to the real panel', () => {
      // The placeholder and the failure card are only useful if they occupy the
      // dialog's box; the widget mirrors the geometry as a literal, so a change
      // to ChatWidgetPanel's container has to land in both places.
      const here = dirname(fileURLToPath(import.meta.url));
      const shell =
        'fixed bottom-[calc(6rem+var(--consent-bottom,0px))] right-4 sm:right-6 z-40 w-[calc(100vw-2rem)] h-[calc(100dvh-11rem-var(--consent-bottom,0px))] sm:w-[400px] sm:h-[560px] bg-altivum-navy border border-white/10 rounded-2xl shadow-2xl';

      expect(readFileSync(resolve(here, 'ChatWidget.tsx'), 'utf8')).toContain(shell);
      expect(readFileSync(resolve(here, 'ChatWidgetPanel.tsx'), 'utf8')).toContain(shell);
    });

    it('renders a dialog-shaped loading placeholder instead of nothing', async () => {
      // Until this existed, aria-expanded flipped to true with no dialog on the
      // page and no focus move, so a cold-network click read as a dead click.
      panel.pending = new Promise<void>(() => {});
      const user = userEvent.setup();
      renderWidget();

      await user.click(screen.getByTestId('widget-button'));

      const placeholder = await screen.findByRole('status', { name: /loading chat/i });
      expect(placeholder).toBeInTheDocument();
      expect(screen.queryByTestId('widget-panel')).not.toBeInTheDocument();
    });
  });

  describe('panel failure containment', () => {
    it('contains a render throw so the launcher survives instead of blanking the app', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      panel.shouldThrow = true;
      const user = userEvent.setup();

      // No boundary here means the throw escapes App.tsx's route boundary and
      // React unmounts the whole root — nav, page, footer, blank screen.
      expect(() => renderWidget()).not.toThrow();
      await user.click(screen.getByTestId('widget-button'));

      expect(await screen.findByRole('button', { name: /start fresh/i })).toBeInTheDocument();
      expect(screen.getByTestId('widget-button')).toBeInTheDocument();
      errSpy.mockRestore();
    });

    it('drops the shared transcript on retry so the poisoned payload cannot re-throw', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      sessionStorage.setItem(CHAT_STORAGE_KEY, '[{"id":"poison"}]');
      panel.shouldThrow = true;
      const user = userEvent.setup();
      renderWidget();

      await user.click(screen.getByTestId('widget-button'));
      await user.click(await screen.findByRole('button', { name: /start fresh/i }));

      expect(sessionStorage.getItem(CHAT_STORAGE_KEY)).toBeNull();
      // Panel closed, launcher back to its resting state.
      expect(screen.queryByRole('button', { name: /start fresh/i })).not.toBeInTheDocument();
      expect(screen.getByTestId('widget-button')).toHaveAttribute('aria-expanded', 'false');
      errSpy.mockRestore();
    });

    it('reopens into a fresh panel after a failure, rather than a latched error state', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      panel.shouldThrow = true;
      const user = userEvent.setup();
      renderWidget();

      await user.click(screen.getByTestId('widget-button'));
      await user.click(await screen.findByRole('button', { name: /start fresh/i }));

      // The boundary lives inside the isOpen branch, so closing unmounts it and
      // the next open is not stuck showing the previous failure.
      panel.shouldThrow = false;
      await user.click(screen.getByTestId('widget-button'));

      expect(await screen.findByTestId('widget-panel')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /start fresh/i })).not.toBeInTheDocument();
      errSpy.mockRestore();
    });
  });
});
