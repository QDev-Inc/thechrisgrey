import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import ToolDraftCard from './ToolDraftCard';

function LocationSpy({ onLocation }: { onLocation: (loc: string) => void }) {
  const loc = useLocation();
  onLocation(`${loc.pathname}${loc.search}${loc.hash}`);
  return null;
}

function renderWithRouter(ui: React.ReactElement, onLocation?: (loc: string) => void) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              {onLocation ? <LocationSpy onLocation={onLocation} /> : null}
              {ui}
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ToolDraftCard — navigate', () => {
  it('renders path and reason', () => {
    renderWithRouter(
      <ToolDraftCard
        action={{ kind: 'draft_action', action: 'navigate', path: '/podcast', reason: 'Christian hosts it.' }}
      />,
    );
    expect(screen.getByText(/\/podcast/)).toBeInTheDocument();
    expect(screen.getByText(/Christian hosts it/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Take me there/i })).toBeInTheDocument();
  });

  it('navigates and dismisses on accept', () => {
    let current = '/';
    renderWithRouter(
      <ToolDraftCard action={{ kind: 'draft_action', action: 'navigate', path: '/about', reason: 'To learn more.' }} />,
      (loc) => {
        current = loc;
      },
    );
    fireEvent.click(screen.getByRole('button', { name: /Take me there/i }));
    expect(current).toBe('/about');
    expect(screen.queryByRole('button', { name: /Take me there/i })).not.toBeInTheDocument();
  });

  it('dismisses without navigating', () => {
    const onDismiss = vi.fn();
    renderWithRouter(
      <ToolDraftCard
        action={{ kind: 'draft_action', action: 'navigate', path: '/altivum', reason: 'reason' }}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Dismiss/i }));
    expect(onDismiss).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Take me there/i })).not.toBeInTheDocument();
  });
});

describe('ToolDraftCard — contact', () => {
  const baseAction = {
    kind: 'draft_action' as const,
    action: 'contact' as const,
    subject: 'Podcast appearance',
    body: 'Long body text',
    intent: 'podcast' as const,
  };

  it('renders subject, body, and intent label', () => {
    renderWithRouter(<ToolDraftCard action={baseAction} />);
    expect(screen.getByText(/Podcast invitation/i)).toBeInTheDocument();
    expect(screen.getByText(/Podcast appearance/)).toBeInTheDocument();
    expect(screen.getByText(/Long body text/)).toBeInTheDocument();
  });

  it('navigates to contact without private draft content in the URL', () => {
    let current = '/';
    renderWithRouter(<ToolDraftCard action={baseAction} />, (loc) => {
      current = loc;
    });
    fireEvent.click(screen.getByRole('button', { name: /Review & send/i }));
    expect(current).toBe('/contact');
  });
});

describe('ToolDraftCard — newsletter', () => {
  it('renders the pitch and an inline capture form (subscribe without leaving chat)', () => {
    let current = '/';
    renderWithRouter(
      <ToolDraftCard action={{ kind: 'draft_action', action: 'newsletter', pitch: 'Weekly insights' }} />,
      (loc) => {
        current = loc;
      },
    );
    expect(screen.getByText(/Weekly insights/)).toBeInTheDocument();
    // The compact NewsletterForm is rendered inline (the old behavior navigated to
    // /contact#newsletter — a page with no form — so capture silently failed).
    expect(screen.getByPlaceholderText('Enter your email address')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /subscribe/i })).toBeInTheDocument();
    // No navigation away from the conversation.
    expect(current).toBe('/');
  });

  it('offers a dismiss control', () => {
    renderWithRouter(<ToolDraftCard action={{ kind: 'draft_action', action: 'newsletter', pitch: 'pitch' }} />);
    expect(screen.getByRole('button', { name: /not now/i })).toBeInTheDocument();
  });
});

describe('ToolDraftCard — citation', () => {
  it('renders title, excerpt, and read button', () => {
    renderWithRouter(
      <ToolDraftCard
        action={{
          kind: 'draft_action',
          action: 'citation',
          slug: 'building-alti',
          title: 'Building Alti',
          excerpt: 'How I wired up the agent.',
          url: 'https://thechrisgrey.com/blog/building-alti',
        }}
      />,
    );
    expect(screen.getByText(/Building Alti/)).toBeInTheDocument();
    expect(screen.getByText(/How I wired up the agent/)).toBeInTheDocument();
  });

  it('navigates to blog post on accept', () => {
    let current = '/';
    renderWithRouter(
      <ToolDraftCard
        action={{
          kind: 'draft_action',
          action: 'citation',
          slug: 'a-post',
          title: 'Title',
          excerpt: '',
          url: 'https://thechrisgrey.com/blog/a-post',
        }}
      />,
      (loc) => {
        current = loc;
      },
    );
    fireEvent.click(screen.getByRole('button', { name: /Read the post/i }));
    expect(current).toBe('/blog/a-post');
  });
});

describe('ToolDraftCard — blog_search_results', () => {
  const sampleResults = [
    {
      slug: 'going-agentic',
      title: 'Going Agentic',
      excerpt: 'How Alti became a tool-user.',
      url: 'https://thechrisgrey.com/blog/going-agentic',
    },
    {
      slug: 'strands-a-tour',
      title: 'Strands, A Tour',
      excerpt: 'Walkthrough of the SDK.',
      url: 'https://thechrisgrey.com/blog/strands-a-tour',
    },
  ];

  it('renders query and all result titles', () => {
    renderWithRouter(
      <ToolDraftCard
        action={{
          kind: 'draft_action',
          action: 'blog_search_results',
          query: 'strands',
          results: sampleResults,
        }}
      />,
    );
    expect(screen.getByText(/Posts matching/i)).toBeInTheDocument();
    expect(screen.getByText('Going Agentic')).toBeInTheDocument();
    expect(screen.getByText('Strands, A Tour')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Read this post/i })).toHaveLength(2);
  });

  it('navigates to clicked post slug', () => {
    let current = '/';
    renderWithRouter(
      <ToolDraftCard
        action={{
          kind: 'draft_action',
          action: 'blog_search_results',
          query: 'agents',
          results: sampleResults,
        }}
      />,
      (loc) => {
        current = loc;
      },
    );
    const buttons = screen.getAllByRole('button', { name: /Read this post/i });
    fireEvent.click(buttons[1]);
    expect(current).toBe('/blog/strands-a-tour');
  });

  it('dismisses all on Dismiss all click', () => {
    const onDismiss = vi.fn();
    renderWithRouter(
      <ToolDraftCard
        action={{
          kind: 'draft_action',
          action: 'blog_search_results',
          query: 'agents',
          results: sampleResults,
        }}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Dismiss all/i }));
    expect(onDismiss).toHaveBeenCalled();
    expect(screen.queryByText('Going Agentic')).not.toBeInTheDocument();
  });

  it('renders nothing when results array is empty', () => {
    const { container } = renderWithRouter(
      <ToolDraftCard
        action={{
          kind: 'draft_action',
          action: 'blog_search_results',
          query: 'nothing',
          results: [],
        }}
      />,
    );
    expect(container.querySelector('[aria-label="Blog search results"]')).toBeNull();
  });

  it('omits excerpt paragraph when excerpt is empty', () => {
    const { container } = renderWithRouter(
      <ToolDraftCard
        action={{
          kind: 'draft_action',
          action: 'blog_search_results',
          query: 'test',
          results: [
            {
              slug: 'no-excerpt',
              title: 'No Excerpt',
              excerpt: '',
              url: 'https://thechrisgrey.com/blog/no-excerpt',
            },
          ],
        }}
      />,
    );
    expect(screen.getByText('No Excerpt')).toBeInTheDocument();
    const listItems = container.querySelectorAll('li');
    expect(listItems).toHaveLength(1);
    expect(listItems[0].querySelector('.italic')).toBeNull();
  });
});

describe('ToolDraftCard — podcast_citation', () => {
  const baseAction = {
    kind: 'draft_action' as const,
    action: 'podcast_citation' as const,
    videoId: 'ndX9SkIY7Mc',
    startSeconds: 725,
    episodeTitle: 'Brittinie Wick on Women Veterans',
    quote: 'Women veterans are too often invisible after service.',
    timestampLabel: '12:05',
    url: 'https://www.youtube.com/watch?v=ndX9SkIY7Mc&t=725s',
  };

  it('renders episode title, quote, and a timestamped play button', () => {
    renderWithRouter(<ToolDraftCard action={baseAction} />);
    expect(screen.getByText(/From The Vector Podcast/i)).toBeInTheDocument();
    expect(screen.getByText('Brittinie Wick on Women Veterans')).toBeInTheDocument();
    expect(screen.getByText(/Women veterans are too often invisible/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Play at 12:05/i })).toBeInTheDocument();
  });

  it('opens the timestamped YouTube URL in a new tab on play', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderWithRouter(<ToolDraftCard action={baseAction} />);
    fireEvent.click(screen.getByRole('button', { name: /Play at 12:05/i }));
    expect(openSpy).toHaveBeenCalledWith(
      'https://www.youtube.com/watch?v=ndX9SkIY7Mc&t=725s',
      '_blank',
      'noopener,noreferrer',
    );
    expect(screen.queryByRole('button', { name: /Play at 12:05/i })).not.toBeInTheDocument();
    openSpy.mockRestore();
  });

  it('dismisses without opening a tab', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const onDismiss = vi.fn();
    renderWithRouter(<ToolDraftCard action={baseAction} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: /Dismiss/i }));
    expect(onDismiss).toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});

describe('ToolDraftCard — model-supplied target validation', () => {
  // The server allowlists these targets today (validation.mjs, searchPodcast.mjs).
  // These guards make a server regression degrade the card to inert text rather
  // than turning navigate()/window.open() into an open-redirect sink.

  it('drops the navigate control when the path is not internal', () => {
    renderWithRouter(
      <ToolDraftCard
        action={{
          kind: 'draft_action',
          action: 'navigate',
          path: 'https://evil.example/phish',
          reason: 'Trust me.',
        }}
      />,
    );
    expect(screen.queryByRole('button', { name: /Take me there/i })).not.toBeInTheDocument();
    // The card still explains itself and can still be dismissed.
    expect(screen.getByText(/Trust me/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Dismiss/i })).toBeInTheDocument();
  });

  it('drops the navigate control for a protocol-relative path', () => {
    renderWithRouter(
      <ToolDraftCard action={{ kind: 'draft_action', action: 'navigate', path: '//evil.example', reason: 'reason' }} />,
    );
    expect(screen.queryByRole('button', { name: /Take me there/i })).not.toBeInTheDocument();
  });

  it('drops the read control when a citation slug is not slug-shaped', () => {
    renderWithRouter(
      <ToolDraftCard
        action={{
          kind: 'draft_action',
          action: 'citation',
          slug: '../admin',
          title: 'Escaping Title',
          excerpt: 'quote',
          url: 'https://thechrisgrey.com/blog/x',
        }}
      />,
    );
    expect(screen.queryByRole('button', { name: /Read the post/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Escaping Title/)).toBeInTheDocument();
  });

  it('filters blog search results down to slug-shaped entries', () => {
    renderWithRouter(
      <ToolDraftCard
        action={{
          kind: 'draft_action',
          action: 'blog_search_results',
          query: 'agents',
          results: [
            { slug: 'going-agentic', title: 'Going Agentic', excerpt: '', url: 'https://x/1' },
            { slug: '../../admin', title: 'Escape Hatch', excerpt: '', url: 'https://x/2' },
          ],
        }}
      />,
    );
    expect(screen.getByText('Going Agentic')).toBeInTheDocument();
    expect(screen.queryByText('Escape Hatch')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Read this post/i })).toHaveLength(1);
  });

  it('renders nothing when every blog search result has an unusable slug', () => {
    const { container } = renderWithRouter(
      <ToolDraftCard
        action={{
          kind: 'draft_action',
          action: 'blog_search_results',
          query: 'agents',
          results: [{ slug: 'HTTPS://evil.example', title: 'Nope', excerpt: '', url: 'https://x/1' }],
        }}
      />,
    );
    expect(container.querySelector('[aria-label="Blog search results"]')).toBeNull();
  });

  it('drops the play control when the podcast URL is not an https YouTube URL', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderWithRouter(
      <ToolDraftCard
        action={{
          kind: 'draft_action',
          action: 'podcast_citation',
          videoId: 'x',
          startSeconds: 0,
          episodeTitle: 'Some Episode',
          quote: 'a quote',
          timestampLabel: '00:10',
          url: 'https://evil.example/watch?v=x',
        }}
      />,
    );
    expect(screen.queryByRole('button', { name: /Play at/i })).not.toBeInTheDocument();
    expect(screen.getByText('Some Episode')).toBeInTheDocument();
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it('keeps the play control for a youtu.be share link', () => {
    renderWithRouter(
      <ToolDraftCard
        action={{
          kind: 'draft_action',
          action: 'podcast_citation',
          videoId: 'ndX9SkIY7Mc',
          startSeconds: 725,
          episodeTitle: 'Episode',
          quote: '',
          timestampLabel: '12:05',
          url: 'https://youtu.be/ndX9SkIY7Mc?t=725',
        }}
      />,
    );
    expect(screen.getByRole('button', { name: /Play at 12:05/i })).toBeInTheDocument();
  });
});
