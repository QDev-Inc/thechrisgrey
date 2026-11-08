import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Mock the Cognito SDK - use vi.hoisted so the fn is available during vi.mock factory
const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock('@aws-sdk/client-cognito-identity-provider', () => {
  return {
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
  };
});

import { useAuth } from './useAuth';

describe('useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('should resolve to unauthenticated when no stored tokens', async () => {
    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should restore authentication from valid sessionStorage tokens', async () => {
    const tokens = {
      accessToken: 'access-123',
      idToken: 'id-123',
      refreshToken: 'refresh-123',
      expiresAt: Date.now() + 3600000, // 1 hour from now
    };
    sessionStorage.setItem('admin-auth', JSON.stringify(tokens));

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(true);
  });

  it('should not restore expired tokens from sessionStorage', async () => {
    const tokens = {
      accessToken: 'access-123',
      idToken: 'id-123',
      refreshToken: 'refresh-123',
      expiresAt: Date.now() - 1000, // expired
    };
    sessionStorage.setItem('admin-auth', JSON.stringify(tokens));

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(sessionStorage.getItem('admin-auth')).toBeNull();
  });

  it('should handle corrupted sessionStorage data gracefully', async () => {
    sessionStorage.setItem('admin-auth', 'invalid-json');

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(false);
  });

  describe('login', () => {
    it('should authenticate successfully with valid credentials', async () => {
      mockSend.mockResolvedValueOnce({
        AuthenticationResult: {
          AccessToken: 'new-access',
          IdToken: 'new-id',
          RefreshToken: 'new-refresh',
          ExpiresIn: 3600,
        },
      });

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.login('user@example.com', 'password123');
      });

      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.error).toBeNull();

      const stored = JSON.parse(sessionStorage.getItem('admin-auth')!);
      expect(stored.accessToken).toBe('new-access');
    });

    it('should handle missing authentication result', async () => {
      mockSend.mockResolvedValueOnce({
        AuthenticationResult: null,
      });

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.login('user@example.com', 'password');
      });

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.error).toBe('Authentication failed. Please try again.');
    });

    it('should show specific error for NotAuthorizedException', async () => {
      const error = new Error('Not authorized');
      error.name = 'NotAuthorizedException';
      mockSend.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.login('user@example.com', 'wrong-password');
      });

      expect(result.current.error).toBe('Invalid email or password');
      expect(result.current.isAuthenticated).toBe(false);
    });

    it('should show generic error for unknown errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.login('user@example.com', 'password');
      });

      expect(result.current.error).toBe('Authentication failed. Please try again.');
    });
  });

  describe('logout', () => {
    it('should clear session and set unauthenticated state', async () => {
      const tokens = {
        accessToken: 'access-123',
        idToken: 'id-123',
        refreshToken: 'refresh-123',
        expiresAt: Date.now() + 3600000,
      };
      sessionStorage.setItem('admin-auth', JSON.stringify(tokens));
      mockSend.mockResolvedValueOnce({}); // GlobalSignOut response

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.isAuthenticated).toBe(false);
      expect(sessionStorage.getItem('admin-auth')).toBeNull();
    });

    it('should clear session even if remote sign-out fails', async () => {
      const tokens = {
        accessToken: 'access-123',
        idToken: 'id-123',
        refreshToken: 'refresh-123',
        expiresAt: Date.now() + 3600000,
      };
      sessionStorage.setItem('admin-auth', JSON.stringify(tokens));
      mockSend.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.isAuthenticated).toBe(false);
      expect(sessionStorage.getItem('admin-auth')).toBeNull();
    });
  });

  describe('getAccessToken', () => {
    it('should return access token when session is valid', async () => {
      const tokens = {
        accessToken: 'access-123',
        idToken: 'id-123',
        refreshToken: 'refresh-123',
        expiresAt: Date.now() + 3600000, // well in the future
      };
      sessionStorage.setItem('admin-auth', JSON.stringify(tokens));

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      let token: string | null = null;
      await act(async () => {
        token = await result.current.getAccessToken();
      });

      expect(token).toBe('access-123');
    });

    it('should return null when not authenticated', async () => {
      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      let token: string | null = 'initial';
      await act(async () => {
        token = await result.current.getAccessToken();
      });

      expect(token).toBeNull();
    });

    it('should attempt to refresh when token is near expiry', async () => {
      const tokens = {
        accessToken: 'old-access',
        idToken: 'old-id',
        refreshToken: 'refresh-123',
        expiresAt: Date.now() + 2 * 60 * 1000, // 2 minutes from now (< 5 minute threshold)
      };
      sessionStorage.setItem('admin-auth', JSON.stringify(tokens));

      mockSend.mockResolvedValueOnce({
        AuthenticationResult: {
          AccessToken: 'refreshed-access',
          IdToken: 'refreshed-id',
          ExpiresIn: 3600,
        },
      });

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      let token: string | null = null;
      await act(async () => {
        token = await result.current.getAccessToken();
      });

      expect(token).toBe('refreshed-access');
    });
  });
});

describe('admin MFA', () => {
  beforeEach(() => {
    mockSend.mockReset();
    sessionStorage.clear();
  });
  const authResult = {
    AuthenticationResult: { AccessToken: 'access', IdToken: 'id', RefreshToken: 'refresh', ExpiresIn: 3600 },
  };
  it('requires the authenticator code before storing credentials', async () => {
    mockSend
      .mockResolvedValueOnce({ ChallengeName: 'SOFTWARE_TOKEN_MFA', Session: 'challenge-session' })
      .mockResolvedValueOnce(authResult);
    const { result } = renderHook(() => useAuth());
    await act(() => result.current.login('admin@example.com', 'password'));
    expect(result.current.isAuthenticated).toBe(false);
    expect(sessionStorage.getItem('admin-auth')).toBeNull();
    expect(result.current.challenge?.name).toBe('SOFTWARE_TOKEN_MFA');
    await act(() => result.current.respondToChallenge('123456'));
    expect(mockSend.mock.calls[1][0].params.ChallengeResponses.SOFTWARE_TOKEN_MFA_CODE).toBe('123456');
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.challenge).toBeNull();
  });
  it('enrolls an authenticator and carries the verified session into the final challenge', async () => {
    mockSend
      .mockResolvedValueOnce({ ChallengeName: 'MFA_SETUP', Session: 'start' })
      .mockResolvedValueOnce({ SecretCode: 'TESTSECRET', Session: 'associated' })
      .mockResolvedValueOnce({ Status: 'SUCCESS', Session: 'verified' })
      .mockResolvedValueOnce(authResult);
    const { result } = renderHook(() => useAuth());
    await act(() => result.current.login('admin@example.com', 'password'));
    expect(result.current.challenge?.secret).toBe('TESTSECRET');
    expect(sessionStorage.getItem('admin-auth')).toBeNull();
    await act(() => result.current.respondToChallenge('123456'));
    expect(mockSend.mock.calls[2][0].params.Session).toBe('associated');
    expect(mockSend.mock.calls[3][0].params.Session).toBe('verified');
    expect(result.current.isAuthenticated).toBe(true);
  });
  it('keeps a failed MFA challenge retryable without storing tokens', async () => {
    mockSend
      .mockResolvedValueOnce({ ChallengeName: 'SOFTWARE_TOKEN_MFA', Session: 'challenge' })
      .mockRejectedValueOnce(new Error('invalid code'));
    const { result } = renderHook(() => useAuth());
    await act(() => result.current.login('admin@example.com', 'password'));
    await act(() => result.current.respondToChallenge('000000'));
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.challenge?.session).toBe('challenge');
    expect(sessionStorage.getItem('admin-auth')).toBeNull();
  });
  it('continues from a required password change to MFA', async () => {
    mockSend
      .mockResolvedValueOnce({ ChallengeName: 'NEW_PASSWORD_REQUIRED', Session: 'password' })
      .mockResolvedValueOnce({ ChallengeName: 'SOFTWARE_TOKEN_MFA', Session: 'mfa' });
    const { result } = renderHook(() => useAuth());
    await act(() => result.current.login('admin@example.com', 'temporary'));
    await act(() => result.current.respondToChallenge('long-new-password'));
    expect(result.current.challenge?.name).toBe('SOFTWARE_TOKEN_MFA');
    expect(result.current.isAuthenticated).toBe(false);
  });
});
