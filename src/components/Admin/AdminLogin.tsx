import React, { useState } from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react';
import wellnessImage from '../../assets/images/wellness_vitamins_display_1793621456102.jpg';

interface AdminLoginProps {
  setupMessage?: string;
  onAuthenticated: () => void;
}

interface AuthResponse {
  authenticated?: boolean;
  configured?: boolean;
  message?: string;
}

export const AdminLogin: React.FC<AdminLoginProps> = ({ setupMessage, onAuthenticated }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/auth.php', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ action: 'login', email, password }),
      });
      const result = await response.json() as AuthResponse;

      if (!response.ok || !result.authenticated) {
        setErrorMessage(result.message || 'We could not sign you in. Check your email and password.');
        return;
      }

      setPassword('');
      onAuthenticated();
    } catch {
      setErrorMessage('The secure sign-in service could not be reached. Please try again later.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f1f7fc] px-4 py-10 sm:px-6">
      <section className="grid w-full max-w-5xl overflow-hidden rounded-[28px] border border-blue-100 bg-white shadow-[0_30px_90px_-40px_rgba(18,59,104,0.35)] lg:min-h-[610px] lg:grid-cols-[1fr_0.92fr]">
        <div className="relative hidden min-h-[610px] overflow-hidden bg-[#123b68] lg:block">
          <img
            src={wellnessImage}
            alt="Wellness supplements and botanical ingredients"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#08294d]/90 via-[#0d3d6c]/30 to-[#0d3d6c]/10" />
          <div className="absolute left-9 right-9 top-9 flex items-center gap-3 text-white">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-lg font-bold text-[#174c80]">Rx</span>
            <div>
              <p className="text-sm font-semibold">AuraCare Health</p>
              <p className="text-[10px] uppercase tracking-[0.16em] text-blue-100">Clinical operations</p>
            </div>
          </div>
          <div className="absolute bottom-10 left-9 right-9 text-white">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-blue-100">Staff workspace</p>
            <h1 className="max-w-md text-4xl font-semibold leading-tight tracking-[-0.04em]">
              Care begins with a secure connection.
            </h1>
            <p className="mt-4 max-w-md text-sm leading-6 text-blue-50/90">
              Sign in to manage pharmacy operations, products, and customer orders.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-center px-6 py-10 sm:px-12 lg:px-11">
          <div className="w-full max-w-sm">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#174c80] text-lg font-bold text-white">Rx</span>
              <div>
                <p className="text-sm font-semibold text-slate-900">AuraCare Health</p>
                <p className="text-[10px] uppercase tracking-[0.16em] text-[#356a9e]">Clinical operations</p>
              </div>
            </div>

            <div className="mb-7">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#e8f2fb] text-[#174c80]">
                <LockKeyhole className="h-5 w-5" />
              </div>
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#356a9e]">Admin sign in</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-[-0.045em] text-slate-900">Welcome back</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">Use your authorized administrator account to continue.</p>
            </div>

            {setupMessage && (
              <div role="status" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-950">
                <p className="font-semibold">Sign-in setup required</p>
                <p className="mt-1">{setupMessage}</p>
                <p className="mt-2">See the “Admin login setup” section in DEPLOYMENT.md. Do not enter a password until the server setup is complete.</p>
              </div>
            )}

            {errorMessage && (
              <div role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                {errorMessage}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="admin-email" className="mb-2 block text-sm font-medium text-slate-700">Email address</label>
                <input
                  id="admin-email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.com"
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                />
              </div>

              <div>
                <label htmlFor="admin-password" className="mb-2 block text-sm font-medium text-slate-700">Password</label>
                <div className="relative">
                  <input
                    id="admin-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 pr-12 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-400 transition hover:text-slate-700"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || Boolean(setupMessage)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#174c80] px-4 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123b68] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? 'Signing in…' : 'Sign in securely'}
                {!isSubmitting && <ArrowRight className="h-4 w-4" />}
              </button>
            </form>

            <div className="mt-7 flex items-start gap-2 border-t border-slate-100 pt-5 text-xs leading-5 text-slate-500">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#356a9e]" />
              <p>Protected by server-side authentication. Your password is never stored in this browser.</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
};
