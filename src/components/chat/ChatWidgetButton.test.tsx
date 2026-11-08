import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatWidgetButton from './ChatWidgetButton';

// Mock AltiMascot since Three.js Canvas doesn't work in jsdom. It records the
// context-loss callback so the recovery path can be driven from a test.
const mascot = vi.hoisted(() => ({ onContextLost: null as (() => void) | null }));
vi.mock('./AltiMascot', () => ({
  default: ({ onContextLost }: { onContextLost?: () => void }) => {
    mascot.onContextLost = onContextLost ?? null;
    return <div data-testid="alti-mascot" />;
  },
}));

// WebGL capability gate — controllable per test.
import { checkWebGLSupport } from '../../utils/checkWebGL';
vi.mock('../../utils/checkWebGL', () => ({
  checkWebGLSupport: vi.fn(() => true),
}));
const mockedCheckWebGL = vi.mocked(checkWebGLSupport);

// Build-time prerender flag — controllable per test, default false (browser).
import { isPrerender } from '../../utils/prerender';
vi.mock('../../utils/prerender', () => ({
  isPrerender: vi.fn(() => false),
}));
const mockedIsPrerender = vi.mocked(isPrerender);

/**
 * The 3D mount is deferred off the critical path, so it only appears once the
 * browser goes idle or the visitor aims at the launcher. Tests that care about
 * the mascot take the intent path; the idle path has its own case below.
 */
const signalIntent = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.hover(screen.getByRole('button'));
};

describe('ChatWidgetButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mascot.onContextLost = null;
    mockedCheckWebGL.mockReturnValue(true);
    mockedIsPrerender.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should render with "Open chat" label when closed', () => {
    render(<ChatWidgetButton isOpen={false} onClick={vi.fn()} />);
    const button = screen.getByRole('button', { name: /open chat/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('should render with "Close chat" label when open', () => {
    render(<ChatWidgetButton isOpen={true} onClick={vi.fn()} />);
    const button = screen.getByRole('button', { name: /close chat/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('should expose a non-empty accessible name on the launcher', () => {
    render(<ChatWidgetButton isOpen={false} onClick={vi.fn()} />);
    const button = screen.getByRole('button', { name: /open chat/i });
    expect(button.getAttribute('aria-label')).toBeTruthy();
    expect(button.getAttribute('aria-label')!.length).toBeGreaterThan(0);
  });

  it('should render a tooltip element describing the launcher action', () => {
    render(<ChatWidgetButton isOpen={false} onClick={vi.fn()} />);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toBeInTheDocument();
    // Tooltip text is non-empty and reflects the closed state affordance.
    expect(tooltip.textContent).toBeTruthy();
    expect(tooltip.textContent).toMatch(/chat/i);
  });

  it('should associate the launcher button with the tooltip via aria-describedby', () => {
    render(<ChatWidgetButton isOpen={false} onClick={vi.fn()} />);
    const button = screen.getByRole('button', { name: /open chat/i });
    const tooltip = screen.getByRole('tooltip');
    const describedById = button.getAttribute('aria-describedby');
    expect(describedById).toBe(tooltip.id);
    expect(tooltip.id).toBeTruthy();
  });

  it('drops aria-describedby when open, so the description does not repeat the name', () => {
    // Open state: aria-label and the tooltip are both the literal "Close chat",
    // which a screen reader would otherwise announce twice in a row.
    render(<ChatWidgetButton isOpen={true} onClick={vi.fn()} />);
    const button = screen.getByRole('button', { name: /close chat/i });
    expect(button).not.toHaveAttribute('aria-describedby');
  });

  it('should show a "Chat with Alti" tooltip when closed and a "Close chat" tooltip when open', () => {
    const { rerender } = render(<ChatWidgetButton isOpen={false} onClick={vi.fn()} />);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Chat with Alti');

    rerender(<ChatWidgetButton isOpen={true} onClick={vi.fn()} />);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Close chat');
  });

  // jsdom does not load the stylesheet (vitest runs with css: false), so for
  // these two the variant itself is the contract under test.
  describe('reveal conditions', () => {
    it('reveals the tooltip on keyboard focus only, never on programmatic focus', () => {
      render(<ChatWidgetButton isOpen={false} onClick={vi.fn()} />);
      const tooltip = screen.getByRole('tooltip');

      // group-focus-within matched the focus useFocusTrap programmatically
      // restores to the launcher on close, so every mouse user who closed the
      // chat got the tooltip pinned open beside a button with no focus ring.
      expect(tooltip.className).toContain('peer-focus-visible:opacity-100');
      expect(tooltip.className).not.toContain('focus-within');
      expect(tooltip.className).toContain('group-hover:opacity-100');
    });

    it('lights the platform glow from the whole launcher, not the model raycast', async () => {
      const user = userEvent.setup();
      const { container } = render(<ChatWidgetButton isOpen={false} onClick={vi.fn()} />);
      await signalIntent(user);
      await screen.findByTestId('alti-mascot');

      // The glow used to be React state fed by an R3F pointer event, i.e. a
      // raycast against the mesh — strictly smaller than the button the tooltip
      // reacts to, and unreachable by keyboard.
      const activeGlow = container.querySelector('[class*="group-hover:opacity-100"][class*="rounded-[50%]"]');
      expect(activeGlow).not.toBeNull();
      expect(activeGlow!.className).toContain('group-has-[:focus-visible]:opacity-100');
    });
  });

  it('should call onClick when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<ChatWidgetButton isOpen={false} onClick={onClick} />);

    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  describe('deferred 3D mount', () => {
    it('paints the static stand-in first and keeps the 3D chunk off the initial load', () => {
      render(<ChatWidgetButton isOpen={false} onClick={vi.fn()} />);

      // Nothing has signalled intent and the browser has not gone idle, so the
      // three/drei chunk and the 1.15MB GLB must not be requested yet.
      expect(screen.getByTestId('alti-fallback')).toBeInTheDocument();
      expect(screen.queryByTestId('alti-mascot')).not.toBeInTheDocument();
    });

    it('mounts the 3D mascot once the visitor aims at the launcher', async () => {
      const user = userEvent.setup();
      render(<ChatWidgetButton isOpen={false} onClick={vi.fn()} />);

      await signalIntent(user);

      expect(await screen.findByTestId('alti-mascot')).toBeInTheDocument();
      expect(screen.queryByTestId('alti-fallback')).not.toBeInTheDocument();
    });

    it('mounts the 3D mascot on keyboard focus as well as pointer intent', async () => {
      const user = userEvent.setup();
      render(<ChatWidgetButton isOpen={false} onClick={vi.fn()} />);

      await user.tab();
      expect(screen.getByRole('button')).toHaveFocus();

      expect(await screen.findByTestId('alti-mascot')).toBeInTheDocument();
    });

    it('does not download the 3D mascot without visitor intent', async () => {
      expect(typeof window.requestIdleCallback).toBe('undefined');
      vi.useFakeTimers();
      render(<ChatWidgetButton isOpen={false} onClick={vi.fn()} />);
      expect(screen.queryByTestId('alti-mascot')).not.toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(30000);
      });

      expect(screen.queryByTestId('alti-mascot')).not.toBeInTheDocument();
    });
  });

  it('mounts the 3D mascot when WebGL is supported', async () => {
    const user = userEvent.setup();
    mockedCheckWebGL.mockReturnValue(true);
    render(<ChatWidgetButton isOpen={false} onClick={vi.fn()} />);
    await signalIntent(user);

    expect(await screen.findByTestId('alti-mascot')).toBeInTheDocument();
    expect(screen.queryByTestId('alti-fallback')).not.toBeInTheDocument();
  });

  it('renders a static fallback (not the 3D mascot) when WebGL is unsupported, and stays clickable', async () => {
    const user = userEvent.setup();
    mockedCheckWebGL.mockReturnValue(false);
    const onClick = vi.fn();
    render(<ChatWidgetButton isOpen={false} onClick={onClick} />);
    await signalIntent(user);

    expect(screen.getByTestId('alti-fallback')).toBeInTheDocument();
    expect(screen.queryByTestId('alti-mascot')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('skips the 3D mascot during a build-time prerender crawl, even with WebGL', async () => {
    const user = userEvent.setup();
    mockedCheckWebGL.mockReturnValue(true);
    mockedIsPrerender.mockReturnValue(true);
    render(<ChatWidgetButton isOpen={false} onClick={vi.fn()} />);
    await signalIntent(user);

    expect(screen.getByTestId('alti-fallback')).toBeInTheDocument();
    expect(screen.queryByTestId('alti-mascot')).not.toBeInTheDocument();
  });

  it('falls back to the static stand-in when the WebGL context is lost after mount', async () => {
    const user = userEvent.setup();
    render(<ChatWidgetButton isOpen={false} onClick={vi.fn()} />);
    await signalIntent(user);
    expect(await screen.findByTestId('alti-mascot')).toBeInTheDocument();

    // three.js preventDefaults webglcontextlost and then renders nothing, so
    // without this the launcher would just go blank with no route back.
    expect(mascot.onContextLost).toBeTypeOf('function');
    await act(async () => {
      mascot.onContextLost!();
    });

    expect(screen.getByTestId('alti-fallback')).toBeInTheDocument();
    expect(screen.queryByTestId('alti-mascot')).not.toBeInTheDocument();
  });

  it('shows a close glyph in the static stand-in when the panel is open', () => {
    mockedCheckWebGL.mockReturnValue(false);
    const { rerender } = render(<ChatWidgetButton isOpen={false} onClick={vi.fn()} />);
    expect(screen.getByTestId('alti-fallback').querySelector('[data-material-icon]')).toHaveAttribute(
      'data-material-icon',
      'support_agent',
    );

    // The fallback is the launcher's entire visual on blocklisted GPUs, so it
    // has to express open/closed too — it used to render the same icon either way.
    rerender(<ChatWidgetButton isOpen={true} onClick={vi.fn()} />);
    expect(screen.getByTestId('alti-fallback').querySelector('[data-material-icon]')).toHaveAttribute(
      'data-material-icon',
      'close',
    );
  });

  it('shows a legible close cue over the 3D mascot when the panel is open', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ChatWidgetButton isOpen={false} onClick={vi.fn()} />);
    await signalIntent(user);
    await screen.findByTestId('alti-mascot');

    const button = screen.getByRole('button');
    expect(button.querySelector('[data-material-icon="close"]')).toBeNull();

    rerender(<ChatWidgetButton isOpen={true} onClick={vi.fn()} />);
    const closeGlyph = button.querySelector('[data-material-icon="close"]');
    expect(closeGlyph).not.toBeNull();
    // Not the sub-legible 10px glyph that used to sit inside the glow platform.
    expect(closeGlyph).toHaveClass('text-xl');
  });
});
