import { useState, useCallback } from 'react';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  GlobalSignOutCommand,
  RespondToAuthChallengeCommand,
  AssociateSoftwareTokenCommand,
  VerifySoftwareTokenCommand,
  type InitiateAuthCommandOutput,
} from '@aws-sdk/client-cognito-identity-provider';

const cognitoClient = new CognitoIdentityProviderClient({
  region: 'us-east-1',
});

const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID;

const AUTH_STORAGE_KEY = 'admin-auth';

interface AuthTokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface AuthChallenge {
  name: 'SOFTWARE_TOKEN_MFA' | 'MFA_SETUP' | 'NEW_PASSWORD_REQUIRED';
  session: string;
  username: string;
  secret?: string;
}

export function useAuth() {
  const [challenge, setChallenge] = useState<AuthChallenge | null>(null);
  // Lazy initializer runs once on mount. sessionStorage is synchronous, so we
  // can resolve the auth state during the first render — no need for a mount
  // useEffect that flips isLoading after the fact (which would also trip
  // react-hooks/set-state-in-effect).
  const [state, setState] = useState<AuthState>(() => {
    const stored = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      try {
        const tokens: AuthTokens = JSON.parse(stored);
        if (tokens.expiresAt > Date.now()) {
          return { isAuthenticated: true, isLoading: false, error: null };
        }
      } catch {
        // Invalid stored data — fall through and clear it below.
      }
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
    }
    return { isAuthenticated: false, isLoading: false, error: null };
  });

  const completeAuth = useCallback(async (response: InitiateAuthCommandOutput, username: string) => {
    const result = response.AuthenticationResult;
    if (result?.AccessToken && result.IdToken) {
      const tokens: AuthTokens = {
        accessToken: result.AccessToken,
        idToken: result.IdToken,
        refreshToken: result.RefreshToken || '',
        expiresAt: Date.now() + (result.ExpiresIn || 3600) * 1000,
      };
      sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(tokens));
      setChallenge(null);
      setState({ isAuthenticated: true, isLoading: false, error: null });
      return;
    }
    const name = response.ChallengeName;
    if (
      !response.Session ||
      (name !== 'SOFTWARE_TOKEN_MFA' && name !== 'MFA_SETUP' && name !== 'NEW_PASSWORD_REQUIRED')
    ) {
      throw new Error('Unsupported authentication response');
    }
    let session = response.Session;
    let secret: string | undefined;
    if (name === 'MFA_SETUP') {
      const setup = await cognitoClient.send(new AssociateSoftwareTokenCommand({ Session: session }));
      if (!setup.Session || !setup.SecretCode) throw new Error('Authenticator setup failed');
      session = setup.Session;
      secret = setup.SecretCode;
    }
    setChallenge({ name, session, username: response.ChallengeParameters?.USER_ID_FOR_SRP || username, secret });
    setState({ isAuthenticated: false, isLoading: false, error: null });
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      setChallenge(null);
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        const command = new InitiateAuthCommand({
          AuthFlow: 'USER_PASSWORD_AUTH',
          ClientId: CLIENT_ID,
          AuthParameters: {
            USERNAME: email,
            PASSWORD: password,
          },
        });

        const response = await cognitoClient.send(command);
        await completeAuth(response, email);
      } catch (error) {
        const message =
          error instanceof Error && error.name === 'NotAuthorizedException'
            ? 'Invalid email or password'
            : 'Authentication failed. Please try again.';
        setState({ isAuthenticated: false, isLoading: false, error: message });
      }
    },
    [completeAuth],
  );

  const respondToChallenge = useCallback(
    async (value: string) => {
      if (!challenge) return;
      setState((previous) => ({ ...previous, isLoading: true, error: null }));
      try {
        let session = challenge.session;
        const responses: Record<string, string> = { USERNAME: challenge.username };
        if (challenge.name === 'MFA_SETUP') {
          const verified = await cognitoClient.send(
            new VerifySoftwareTokenCommand({ Session: session, UserCode: value.trim() }),
          );
          if (verified.Status !== 'SUCCESS' || !verified.Session) throw new Error('Invalid code');
          session = verified.Session;
        } else {
          responses[challenge.name === 'NEW_PASSWORD_REQUIRED' ? 'NEW_PASSWORD' : 'SOFTWARE_TOKEN_MFA_CODE'] = value;
        }
        const response = await cognitoClient.send(
          new RespondToAuthChallengeCommand({
            ClientId: CLIENT_ID,
            ChallengeName: challenge.name,
            Session: session,
            ChallengeResponses: responses,
          }),
        );
        await completeAuth(response, challenge.username);
      } catch {
        setState({
          isAuthenticated: false,
          isLoading: false,
          error: 'Verification failed. Check your entry and try again, or restart sign-in.',
        });
      }
    },
    [challenge, completeAuth],
  );

  const logout = useCallback(async () => {
    setChallenge(null);
    const stored = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      try {
        const tokens: AuthTokens = JSON.parse(stored);
        await cognitoClient.send(new GlobalSignOutCommand({ AccessToken: tokens.accessToken }));
      } catch {
        // Sign out locally even if remote sign out fails
      }
    }
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    setState({ isAuthenticated: false, isLoading: false, error: null });
  }, []);

  const refreshSession = useCallback(async (): Promise<string | null> => {
    const stored = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!stored) return null;

    try {
      const tokens: AuthTokens = JSON.parse(stored);
      if (!tokens.refreshToken) return null;

      const command = new InitiateAuthCommand({
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        ClientId: CLIENT_ID,
        AuthParameters: {
          REFRESH_TOKEN: tokens.refreshToken,
        },
      });

      const response = await cognitoClient.send(command);
      const result = response.AuthenticationResult;

      if (!result?.AccessToken || !result?.IdToken) return null;

      const newTokens: AuthTokens = {
        accessToken: result.AccessToken,
        idToken: result.IdToken,
        refreshToken: tokens.refreshToken,
        expiresAt: Date.now() + (result.ExpiresIn || 3600) * 1000,
      };

      sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(newTokens));
      setState({ isAuthenticated: true, isLoading: false, error: null });
      return newTokens.accessToken;
    } catch {
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
      setState({ isAuthenticated: false, isLoading: false, error: null });
      return null;
    }
  }, []);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    const stored = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!stored) return null;

    try {
      const tokens: AuthTokens = JSON.parse(stored);
      // Proactively refresh if within 5 minutes of expiry
      if (tokens.expiresAt <= Date.now() + 5 * 60 * 1000) {
        return await refreshSession();
      }
      return tokens.accessToken;
    } catch {
      return null;
    }
  }, [refreshSession]);

  return {
    isAuthenticated: state.isAuthenticated,
    isLoading: state.isLoading,
    error: state.error,
    challenge,
    respondToChallenge,
    login,
    logout,
    getAccessToken,
  };
}
