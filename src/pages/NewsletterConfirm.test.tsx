import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import NewsletterConfirm from './NewsletterConfirm';

beforeEach(() => window.history.replaceState({}, '', `/newsletter/confirm#${'a'.repeat(43)}`));
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

it('removes the token from the address and waits for explicit confirmation before activation', async () => {
  const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ source: 'blueprint' }) });
  vi.stubGlobal('fetch', request);
  render(
    <HelmetProvider>
      <MemoryRouter>
        <NewsletterConfirm />
      </MemoryRouter>
    </HelmetProvider>,
  );
  expect(window.location.hash).toBe('');
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm subscription' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Blueprint waitlist'));
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ confirmationToken: 'a'.repeat(43) });
});

it('explains an expired link without claiming the subscription succeeded', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  render(
    <HelmetProvider>
      <MemoryRouter>
        <NewsletterConfirm />
      </MemoryRouter>
    </HelmetProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Confirm subscription' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('expired or already been used'));
});
