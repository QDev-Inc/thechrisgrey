import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Every interaction in this file uses `delay: null`: with the default delay,
 * user.type() inserts an artificial wait between each keystroke's event
 * sequence, and the multi-intent tests type ~100 characters into a page that
 * is already expensive to render. Under the full suite's parallel workers that
 * pushed the slowest tests past the 5s default timeout intermittently - the
 * nightly flaky-test detector caught exactly that. The events still fire in
 * full order per keystroke; only the artificial pause between them is skipped.
 */
const setupUser = () => userEvent.setup({ delay: null });
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import Contact from './Contact';

const { mockGetTurnstileToken } = vi.hoisted(() => ({
  mockGetTurnstileToken: vi.fn(),
}));

vi.mock('../utils/turnstile', () => ({
  getTurnstileToken: mockGetTurnstileToken,
}));

const renderContactAt = (url: string) => {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[url]}>
        <Contact />
      </MemoryRouter>
    </HelmetProvider>,
  );
};

describe('Contact query-param handoff (Alti draft_message)', () => {
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTurnstileToken.mockResolvedValue('turnstile-token');
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('prefills Subject and Message from decoded query params', () => {
    renderContactAt(
      '/contact?subject=Speaking%20inquiry&message=Hi%20Christian%2C%20we%27d%20love%20to%20host%20you.&intent=speaking',
    );

    expect(screen.getByLabelText(/subject/i)).toHaveValue('Speaking inquiry');
    expect(screen.getByLabelText(/message \*/i)).toHaveValue("Hi Christian, we'd love to host you.");
  });

  it('selects the intent from the query param', () => {
    renderContactAt('/contact?intent=podcast');

    expect(screen.getByLabelText(/reaching out about/i)).toHaveValue('podcast');
  });

  it('falls back to the general intent when the intent param is unrecognized', () => {
    renderContactAt('/contact?intent=<script>alert(1)</script>');

    expect(screen.getByLabelText(/reaching out about/i)).toHaveValue('general');
    expect(screen.queryByLabelText(/event date/i)).not.toBeInTheDocument();
  });

  it('keeps the canonical link pointing at /contact for query-string variants', async () => {
    renderContactAt('/contact?subject=Test&message=Test&intent=speaking');

    await vi.waitFor(() => {
      const canonical = document.head.querySelector('link[rel="canonical"]');
      expect(canonical).toHaveAttribute('href', 'https://thechrisgrey.com/contact');
    });
  });
});

describe('Contact multi-intent flow', () => {
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('does not render event-specific fields for the default intent', () => {
    renderContactAt('/contact');

    expect(screen.queryByLabelText(/event date/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/audience size/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/event format/i)).not.toBeInTheDocument();
  });

  it('renders event-specific fields when intent=speaking is in the URL', () => {
    renderContactAt('/contact?intent=speaking');

    expect(screen.getByLabelText(/event date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/audience size/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/event format/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/organization/i)).toBeInTheDocument();
  });

  it('reveals event-specific fields when the user selects the speaking intent', async () => {
    const user = setupUser();
    renderContactAt('/contact');

    await user.selectOptions(screen.getByLabelText(/reaching out about/i), 'speaking');

    expect(screen.getByLabelText(/event date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/audience size/i)).toBeInTheDocument();
  });

  it('hides event-specific fields again when switching away from speaking', async () => {
    const user = setupUser();
    renderContactAt('/contact?intent=speaking');

    await user.selectOptions(screen.getByLabelText(/reaching out about/i), 'consulting');

    expect(screen.queryByLabelText(/event date/i)).not.toBeInTheDocument();
  });

  it('includes intent and event details in the submitted payload', async () => {
    const user = setupUser();
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ message: 'Success' }),
    } as Response);
    renderContactAt(
      '/contact?subject=Keynote%20request&message=We%20would%20love%20to%20host%20you%20at%20our%20summit.&intent=speaking',
    );

    await user.type(screen.getByLabelText(/name \*/i), 'Event Organizer');
    await user.type(screen.getByLabelText(/email \*/i), 'organizer@example.com');
    await user.type(screen.getByLabelText(/organization/i), 'Acme Summit');
    await user.type(screen.getByLabelText(/event date/i), '2026-09-15');
    await user.selectOptions(screen.getByLabelText(/audience size/i), '200-500');
    await user.selectOptions(screen.getByLabelText(/event format/i), 'Keynote');

    await user.click(screen.getByRole('button', { name: /send message/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse(options?.body as string);
    expect(body.subject).toBe('Keynote request');
    expect(body.message).toContain('We would love to host you at our summit.');
    expect(body.details).toContain('Intent: Speaking engagement');
    expect(body.details).toContain('Organization: Acme Summit');
    expect(body.details).toContain('Event date: 2026-09-15');
    expect(body.details).toContain('Audience size: 200-500');
    expect(body.details).toContain('Event format: Keynote');
    expect(body.turnstileToken).toBe('turnstile-token');
  });

  it('clears event-specific fields after a successful submission', async () => {
    const user = setupUser();
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ message: 'Success' }),
    } as Response);
    renderContactAt('/contact?intent=speaking');

    await user.type(screen.getByLabelText(/name \*/i), 'Event Organizer');
    await user.type(screen.getByLabelText(/email \*/i), 'organizer@example.com');
    await user.type(screen.getByLabelText(/message \*/i), 'A valid message about a speaking event.');
    await user.type(screen.getByLabelText(/organization/i), 'Acme Summit');
    await user.type(screen.getByLabelText(/event date/i), '2026-09-15');

    await user.click(screen.getByRole('button', { name: /send message/i }));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    expect(screen.getByLabelText(/organization/i)).toHaveValue('');
    expect(screen.getByLabelText(/event date/i)).toHaveValue('');
    expect(screen.getByLabelText(/message \*/i)).toHaveValue('');
  });

  it('still blocks submission and shows inline errors when required fields are empty', async () => {
    const user = setupUser();
    renderContactAt('/contact?intent=speaking');

    await user.click(screen.getByRole('button', { name: /send message/i }));

    await waitFor(() => {
      expect(screen.getByText('Name must be between 2 and 100 characters')).toBeInTheDocument();
    });
    expect(screen.getByText('Please enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Message must be between 10 and 5000 characters')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
