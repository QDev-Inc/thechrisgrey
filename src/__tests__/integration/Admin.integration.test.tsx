import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';

// Mock the Cognito SDK
const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: class {
    send = mockSend;
  },
  InitiateAuthCommand: class {
    constructor(public params: unknown) {}
  },
  RespondToAuthChallengeCommand: class {
    constructor(public params: unknown) {}
  },
  AssociateSoftwareTokenCommand: class {
    constructor(public params: unknown) {}
  },
  VerifySoftwareTokenCommand: class {
    constructor(public params: unknown) {}
  },
  GlobalSignOutCommand: class {
    constructor(public params: unknown) {}
  },
}));

import Admin from '../../pages/Admin';

const mockEntries = [
  {
    _id: 'entry-1',
    _createdAt: '2026-01-01T00:00:00Z',
    _updatedAt: '2026-01-02T00:00:00Z',
    title: 'Early Life',
    category: 'biography',
    content: 'Christian grew up in a military family.',
    isActive: true,
    sortOrder: 1,
  },
  {
    _id: 'entry-2',
    _createdAt: '2026-01-01T00:00:00Z',
    _updatedAt: '2026-01-02T00:00:00Z',
    title: 'Green Beret Training',
    category: 'military',
    content: 'Details about Special Forces training.',
    isActive: true,
    sortOrder: 1,
  },
  {
    _id: 'entry-3',
    _createdAt: '2026-01-01T00:00:00Z',
    _updatedAt: '2026-01-02T00:00:00Z',
    title: 'Draft Entry',
    category: 'career',
    content: 'Unpublished draft content.',
    isActive: false,
    sortOrder: 2,
  },
];

const renderAdmin = () => {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/admin']}>
        <Admin />
      </MemoryRouter>
    </HelmetProvider>,
  );
};

describe('Admin Page Integration', () => {
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('Login form rendering', () => {
    it('shows login form when not authenticated', async () => {
      renderAdmin();

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: /admin/i })).toBeInTheDocument();
      });

      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    });

    it('shows Knowledge Base Management subtitle', async () => {
      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('Knowledge Base Management')).toBeInTheDocument();
      });
    });
  });

  describe('Login flow', () => {
    it('calls Cognito with email and password on submit', async () => {
      const user = userEvent.setup();
      mockSend.mockResolvedValue({
        AuthenticationResult: {
          AccessToken: 'mock-access-token',
          IdToken: 'mock-id-token',
          RefreshToken: 'mock-refresh-token',
          ExpiresIn: 3600,
        },
      });

      // Mock the entries fetch after login
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ entries: mockEntries }),
      } as Response);

      renderAdmin();

      await waitFor(() => {
        expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText(/email/i), 'admin@example.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /sign in/i }));

      await waitFor(() => {
        expect(mockSend).toHaveBeenCalledTimes(1);
      });
    });

    it('transitions to admin dashboard after successful login', async () => {
      const user = userEvent.setup();
      mockSend.mockResolvedValue({
        AuthenticationResult: {
          AccessToken: 'mock-access-token',
          IdToken: 'mock-id-token',
          RefreshToken: 'mock-refresh-token',
          ExpiresIn: 3600,
        },
      });

      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ entries: mockEntries }),
      } as Response);

      renderAdmin();

      await waitFor(() => {
        expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText(/email/i), 'admin@example.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /sign in/i }));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /knowledge base/i })).toBeInTheDocument();
      });
    });

    it('shows error when login fails with invalid credentials', async () => {
      const user = userEvent.setup();
      const notAuthError = new Error('Incorrect username or password');
      notAuthError.name = 'NotAuthorizedException';
      mockSend.mockRejectedValue(notAuthError);

      renderAdmin();

      await waitFor(() => {
        expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText(/email/i), 'wrong@example.com');
      await user.type(screen.getByLabelText(/password/i), 'wrongpass');
      await user.click(screen.getByRole('button', { name: /sign in/i }));

      await waitFor(() => {
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('Invalid email or password');
      });
    });
  });

  describe('Admin dashboard after login', () => {
    const loginAndRenderDashboard = async () => {
      // Set valid tokens in sessionStorage to skip login
      const tokens = {
        accessToken: 'mock-access-token',
        idToken: 'mock-id-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: Date.now() + 3600000,
      };
      sessionStorage.setItem('admin-auth', JSON.stringify(tokens));

      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ entries: mockEntries }),
      } as Response);

      renderAdmin();

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /knowledge base/i })).toBeInTheDocument();
      });
    };

    it('displays KB entries grouped by category', async () => {
      await loginAndRenderDashboard();

      await waitFor(() => {
        expect(screen.getByText('Early Life')).toBeInTheDocument();
        expect(screen.getByText('Green Beret Training')).toBeInTheDocument();
        expect(screen.getByText('Draft Entry')).toBeInTheDocument();
      });
    });

    it('displays stats bar with total, active, and inactive counts', async () => {
      await loginAndRenderDashboard();

      await waitFor(() => {
        expect(screen.getByText('Total Entries')).toBeInTheDocument();
        expect(screen.getByText('Active')).toBeInTheDocument();
        // "Inactive" appears in both the stats bar label and entry status badges
        const inactiveElements = screen.getAllByText('Inactive');
        expect(inactiveElements.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('renders the Publish to KB button', async () => {
      await loginAndRenderDashboard();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /publish to kb/i })).toBeInTheDocument();
      });
    });

    it('renders the Add Entry button', async () => {
      await loginAndRenderDashboard();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add entry/i })).toBeInTheDocument();
      });
    });

    it('renders the Logout button', async () => {
      await loginAndRenderDashboard();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /logout/i })).toBeInTheDocument();
      });
    });

    it('renders Site Health expandable section', async () => {
      await loginAndRenderDashboard();

      await waitFor(() => {
        expect(screen.getByText('Site Health')).toBeInTheDocument();
      });
    });
  });

  describe('Create entry flow', () => {
    it('shows entry form when Add Entry button is clicked', async () => {
      const tokens = {
        accessToken: 'mock-access-token',
        idToken: 'mock-id-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: Date.now() + 3600000,
      };
      sessionStorage.setItem('admin-auth', JSON.stringify(tokens));

      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ entries: mockEntries }),
      } as Response);

      const user = userEvent.setup();
      renderAdmin();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add entry/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /add entry/i }));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /new entry/i })).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Entry title')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Entry content (plain text)')).toBeInTheDocument();
      });
    });

    it('hides the form when Cancel is clicked', async () => {
      const tokens = {
        accessToken: 'mock-access-token',
        idToken: 'mock-id-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: Date.now() + 3600000,
      };
      sessionStorage.setItem('admin-auth', JSON.stringify(tokens));

      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ entries: mockEntries }),
      } as Response);

      const user = userEvent.setup();
      renderAdmin();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add entry/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /add entry/i }));

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Entry title')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /cancel/i }));

      await waitFor(() => {
        expect(screen.queryByPlaceholderText('Entry title')).not.toBeInTheDocument();
      });
    });
  });

  describe('Delete entry flow', () => {
    it('shows confirmation when delete button is clicked', async () => {
      const tokens = {
        accessToken: 'mock-access-token',
        idToken: 'mock-id-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: Date.now() + 3600000,
      };
      sessionStorage.setItem('admin-auth', JSON.stringify(tokens));

      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ entries: mockEntries }),
      } as Response);

      const user = userEvent.setup();
      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('Early Life')).toBeInTheDocument();
      });

      // Click the first delete button
      const deleteButtons = screen.getAllByRole('button', { name: /^delete$/i });
      await user.click(deleteButtons[0]);

      // Confirmation buttons should appear
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm delete/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /cancel delete/i })).toBeInTheDocument();
      });
    });

    it('cancels delete when cancel button is clicked', async () => {
      const tokens = {
        accessToken: 'mock-access-token',
        idToken: 'mock-id-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: Date.now() + 3600000,
      };
      sessionStorage.setItem('admin-auth', JSON.stringify(tokens));

      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ entries: mockEntries }),
      } as Response);

      const user = userEvent.setup();
      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('Early Life')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByRole('button', { name: /^delete$/i });
      await user.click(deleteButtons[0]);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /cancel delete/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /cancel delete/i }));

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /confirm delete/i })).not.toBeInTheDocument();
      });
    });
  });

  describe('Publish flow', () => {
    it('calls the publish endpoint and shows success message', async () => {
      const tokens = {
        accessToken: 'mock-access-token',
        idToken: 'mock-id-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: Date.now() + 3600000,
      };
      sessionStorage.setItem('admin-auth', JSON.stringify(tokens));

      let callCount = 0;
      fetchSpy.mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          // First call: fetchEntries
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ entries: mockEntries }),
          } as Response);
        }
        // Second call: publish
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              message: 'Published',
              entryCount: 2,
              documentSize: 2048,
              publishedAt: '2026-01-01T00:00:00Z',
            }),
        } as Response);
      });

      const user = userEvent.setup();
      renderAdmin();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /publish to kb/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /publish to kb/i }));

      await waitFor(() => {
        expect(screen.getByText(/Published 2 entries/i)).toBeInTheDocument();
      });
    });
  });

  describe('Logout flow', () => {
    it('calls Cognito sign out and clears session storage on logout', async () => {
      const tokens = {
        accessToken: 'mock-access-token',
        idToken: 'mock-id-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: Date.now() + 3600000,
      };
      sessionStorage.setItem('admin-auth', JSON.stringify(tokens));

      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ entries: mockEntries }),
      } as Response);

      // Mock the Cognito GlobalSignOut
      mockSend.mockResolvedValue({});

      const user = userEvent.setup();
      renderAdmin();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /logout/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /logout/i }));

      // Verify Cognito GlobalSignOut was called
      await waitFor(() => {
        expect(mockSend).toHaveBeenCalled();
      });

      // Session storage should be cleared
      expect(sessionStorage.getItem('admin-auth')).toBeNull();
    });
  });
});
