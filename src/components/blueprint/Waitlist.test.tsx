import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockGetTurnstileToken } = vi.hoisted(() => ({
  mockGetTurnstileToken: vi.fn(),
}));

vi.mock('../../utils/turnstile', () => ({
  getTurnstileToken: mockGetTurnstileToken,
}));

/**
 * The Waitlist component reads `import.meta.env.VITE_NEWSLETTER_ENDPOINT`
 * at module-load time. To exercise the fetch-driven success/error branches
 * we stub the env var, reset the module registry, then dynamically import
 * BOTH the testing library render and the component inside one helper so
 * they share a single React instance (avoids "Invalid hook call").
 */
const TEST_ENDPOINT = 'https://example.com/newsletter';

async function renderWaitlist(props: Record<string, unknown> = {}, endpoint: string = TEST_ENDPOINT) {
  // Clear any prior env stub first: vi.stubEnv(key, '') is a no-op when the
  // key already holds a stubbed non-empty value, which would leak the previous
  // test's endpoint into the "not configured" case. Reset the module registry
  // so the fresh dynamic import re-reads the value (the component captures
  // VITE_NEWSLETTER_ENDPOINT in a module-level const at load time).
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.stubEnv('VITE_NEWSLETTER_ENDPOINT', endpoint);
  const { render } = await import('@testing-library/react');
  const { Waitlist } = await import('./Waitlist');
  return render(<Waitlist {...props} />);
}

const mockFetch = vi.fn();

describe('Waitlist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTurnstileToken.mockResolvedValue('turnstile-token');
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('initial render', () => {
    it('renders the default heading and subheading', async () => {
      const { getByText } = await renderWaitlist();
      expect(getByText('Join the Blueprint waitlist')).toBeInTheDocument();
      expect(getByText(/Get early access to Pro tier/i)).toBeInTheDocument();
    });

    it('renders custom heading and subheading when provided', async () => {
      const { getByText } = await renderWaitlist({
        heading: 'Custom heading',
        subheading: 'Custom subheading',
      });
      expect(getByText('Custom heading')).toBeInTheDocument();
      expect(getByText('Custom subheading')).toBeInTheDocument();
    });

    it('renders an email input and a submit button', async () => {
      const { getByPlaceholderText, getByRole } = await renderWaitlist();
      expect(getByPlaceholderText('you@example.com')).toBeInTheDocument();
      expect(getByRole('button', { name: /join waitlist/i })).toBeInTheDocument();
    });
  });

  describe('client-side validation', () => {
    it('blocks submit and shows an error for an invalid email', async () => {
      const { getByPlaceholderText, getByRole } = await renderWaitlist();

      const input = getByPlaceholderText('you@example.com');
      // fireEvent-style direct submit bypasses native email/required validation.
      const { fireEvent } = await import('@testing-library/react');
      fireEvent.change(input, { target: { value: 'not-an-email' } });
      fireEvent.submit(input.closest('form')!);

      expect(getByRole('alert')).toHaveTextContent(/please enter a valid email address/i);
      // fetch must never be invoked for an invalid email.
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('clears the error once the user edits the field again', async () => {
      const user = userEvent.setup();
      const { getByPlaceholderText, getByRole, queryByRole } = await renderWaitlist();

      const input = getByPlaceholderText('you@example.com');
      const { fireEvent } = await import('@testing-library/react');
      fireEvent.change(input, { target: { value: 'bad' } });
      fireEvent.submit(input.closest('form')!);

      expect(getByRole('alert')).toBeInTheDocument();

      await user.type(input, 'x');
      expect(queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('endpoint not configured', () => {
    it('shows a not-configured error and never calls fetch', async () => {
      const user = userEvent.setup();
      const { getByPlaceholderText, getByRole } = await renderWaitlist({}, '');

      await user.type(getByPlaceholderText('you@example.com'), 'visitor@example.com');
      await user.click(getByRole('button', { name: /join waitlist/i }));

      expect(getByRole('alert')).toHaveTextContent(/waitlist is not configured yet/i);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('successful submit', () => {
    it('posts to the endpoint and shows the success message', async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ message: 'ok' }),
      });

      const { getByPlaceholderText, getByRole, findByRole } = await renderWaitlist();

      await user.type(getByPlaceholderText('you@example.com'), 'visitor@example.com');
      await user.click(getByRole('button', { name: /join waitlist/i }));

      const status = await findByRole('status');
      expect(status).toHaveTextContent(/you're on the list/i);

      // Verify the request payload and endpoint.
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe(TEST_ENDPOINT);
      expect(calledInit).toMatchObject({ method: 'POST' });
      expect(JSON.parse(calledInit.body as string)).toEqual({
        email: 'visitor@example.com',
        source: 'blueprint',
        turnstileToken: 'turnstile-token',
      });
    });

    it('hides the form after a successful submit', async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });

      const { getByPlaceholderText, getByRole, findByRole, queryByRole } = await renderWaitlist();

      await user.type(getByPlaceholderText('you@example.com'), 'visitor@example.com');
      await user.click(getByRole('button', { name: /join waitlist/i }));

      await findByRole('status');
      expect(queryByRole('button', { name: /join waitlist/i })).not.toBeInTheDocument();
    });
  });

  describe('failed submit', () => {
    it('shows the 429 rate-limit message', async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: () => Promise.resolve({}),
      });

      const { getByPlaceholderText, getByRole, findByRole } = await renderWaitlist();

      await user.type(getByPlaceholderText('you@example.com'), 'visitor@example.com');
      await user.click(getByRole('button', { name: /join waitlist/i }));

      const alert = await findByRole('alert');
      expect(alert).toHaveTextContent(/too many attempts/i);
    });

    it('surfaces the server-provided error message on a non-ok response', async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Server exploded' }),
      });

      const { getByPlaceholderText, getByRole, findByRole } = await renderWaitlist();

      await user.type(getByPlaceholderText('you@example.com'), 'visitor@example.com');
      await user.click(getByRole('button', { name: /join waitlist/i }));

      const alert = await findByRole('alert');
      expect(alert).toHaveTextContent('Server exploded');
    });

    it('shows a network error when fetch rejects', async () => {
      const user = userEvent.setup();
      mockFetch.mockRejectedValueOnce(new Error('boom'));

      const { getByPlaceholderText, getByRole, findByRole } = await renderWaitlist();

      await user.type(getByPlaceholderText('you@example.com'), 'visitor@example.com');
      await user.click(getByRole('button', { name: /join waitlist/i }));

      const alert = await findByRole('alert');
      expect(alert).toHaveTextContent(/network error/i);
    });
  });

  describe('loading state', () => {
    it('disables the input and button while the request is in flight', async () => {
      const user = userEvent.setup();
      let resolveFetch: (value: unknown) => void;
      mockFetch.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
      );

      const { getByPlaceholderText, getByRole, findByRole } = await renderWaitlist();

      const input = getByPlaceholderText('you@example.com');
      await user.type(input, 'visitor@example.com');
      await user.click(getByRole('button', { name: /join waitlist/i }));

      expect(getByPlaceholderText('you@example.com')).toBeDisabled();
      expect(getByRole('button', { name: /joining/i })).toBeDisabled();

      // Resolve the in-flight request and let the success state settle so the
      // pending promise does not leak (and no act() warning is emitted).
      resolveFetch!({ ok: true, status: 200, json: () => Promise.resolve({}) });
      await findByRole('status');
    });
  });
});
