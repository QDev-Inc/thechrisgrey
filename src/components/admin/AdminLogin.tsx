import { useState, FormEvent } from 'react';
import { typography } from '../../utils/typography';
import type { AuthChallenge } from '../../hooks/useAuth';

export interface AdminLoginProps {
  onLogin: (email: string, password: string) => void;
  isLoading: boolean;
  error: string | null;
  challenge?: AuthChallenge | null;
  onChallenge?: (value: string) => void;
  onRestart?: () => void;
}

function AdminLogin({ onLogin, isLoading, error, challenge, onChallenge, onRestart }: AdminLoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verification, setVerification] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (challenge) {
      onChallenge?.(verification);
      setVerification('');
    } else {
      onLogin(email, password);
      setPassword('');
    }
  };

  return (
    <div className="min-h-screen bg-altivum-dark flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <h1 className="text-white mb-2" style={typography.sectionHeader}>
            Admin
          </h1>
          <p className="text-altivum-silver" style={typography.bodyText}>
            Knowledge Base Management
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          {challenge ? (
            <div className="space-y-5">
              {challenge.name === 'MFA_SETUP' && (
                <div className="space-y-3 text-altivum-silver text-sm">
                  <p>
                    Add a time-based account in your authenticator app using this setup key. Then enter its six-digit
                    code.
                  </p>
                  <code className="ph-no-capture block break-all rounded-lg bg-white/5 p-4 select-all">
                    {challenge.secret}
                  </code>
                </div>
              )}
              <label className="block text-altivum-silver" htmlFor="admin-verification">
                {challenge.name === 'NEW_PASSWORD_REQUIRED' ? 'New password' : 'Authenticator code'}
              </label>
              <input
                id="admin-verification"
                type={challenge.name === 'NEW_PASSWORD_REQUIRED' ? 'password' : 'text'}
                inputMode={challenge.name === 'NEW_PASSWORD_REQUIRED' ? 'text' : 'numeric'}
                autoComplete={challenge.name === 'NEW_PASSWORD_REQUIRED' ? 'new-password' : 'one-time-code'}
                pattern={challenge.name === 'NEW_PASSWORD_REQUIRED' ? undefined : '[0-9]{6}'}
                minLength={challenge.name === 'NEW_PASSWORD_REQUIRED' ? 16 : 6}
                maxLength={challenge.name === 'NEW_PASSWORD_REQUIRED' ? 256 : 6}
                required
                value={verification}
                onChange={(event) => setVerification(event.target.value)}
                className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-3 text-white focus:border-altivum-gold"
              />
              <button type="button" onClick={onRestart} className="text-sm text-altivum-gold underline min-h-11">
                Restart sign-in
              </button>
            </div>
          ) : (
            <>
              <div>
                <label
                  htmlFor="admin-email"
                  className="block text-xs font-medium text-altivum-gold mb-3 uppercase tracking-widest"
                >
                  Email
                </label>
                <input
                  id="admin-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-0 py-4 bg-transparent border-b-2 border-white/10 text-white placeholder-white/70 focus:outline-hidden focus:border-altivum-gold transition-all duration-300 rounded-none"
                  placeholder="your@email.com"
                />
              </div>

              <div>
                <label
                  htmlFor="admin-password"
                  className="block text-xs font-medium text-altivum-gold mb-3 uppercase tracking-widest"
                >
                  Password
                </label>
                <input
                  id="admin-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-0 py-4 bg-transparent border-b-2 border-white/10 text-white placeholder-white/70 focus:outline-hidden focus:border-altivum-gold transition-all duration-300 rounded-none"
                  placeholder="Enter password"
                />
              </div>
            </>
          )}

          {error && (
            <div className="p-4 bg-red-900/30 border-l-4 border-red-500 text-red-300 text-sm" role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className={`w-full py-4 font-medium uppercase tracking-wider text-sm transition-all duration-300 ${
              isLoading
                ? 'bg-altivum-slate/50 text-altivum-silver cursor-not-allowed'
                : 'bg-altivum-gold text-altivum-dark hover:bg-white'
            }`}
          >
            {isLoading ? 'Signing in...' : challenge ? 'Verify and continue' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default AdminLogin;
