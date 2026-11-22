"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Sparkles, WifiOff } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Field, Input } from "@/components/ui";
import { ApiError, api, errorMessage, get, post } from "@/lib/api";
import { enterDemo, isDemoMode } from "@/lib/demo/mode";
import type { Me } from "@/lib/types";

function useAfterSignIn() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  return async () => {
    qc.setQueryData(["me"], undefined);
    await qc.invalidateQueries({ queryKey: ["me"] });
    const next = params.get("next");
    router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
  };
}

function SignInForm() {
  const afterSignIn = useAfterSignIn();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const me = await post<Omit<Me, "provider">>("/auth/login", { email, password });
      await afterSignIn();
      void me;
    } catch (err) {
      setError(err instanceof ApiError && err.code === "rate_limited" ? "Too many attempts. Wait a few minutes and try again." : errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" aria-describedby={error ? "login-error" : undefined}>
      <Field label="Email">
        <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-10" />
      </Field>
      <Field label="Password">
        <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="h-10" />
      </Field>
      {error ? (
        <p id="login-error" role="alert" className="rounded-md bg-bad-soft px-3 py-2 text-[13px] text-bad">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="md" loading={pending} className="w-full">
        Sign in
      </Button>
    </form>
  );
}

function CreateAdminForm() {
  const afterSignIn = useAfterSignIn();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 10) {
      setError("Use at least 10 characters for the password.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const me = await post<Omit<Me, "provider">>("/auth/setup", { name: name || undefined, email, password });
      await afterSignIn();
      void me;
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" aria-describedby={error ? "setup-error" : undefined}>
      <p className="text-[13px] text-muted">
        First run — this creates the owner account for this instance. There is no other account yet.
      </p>
      <Field label="Your name">
        <Input type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className="h-10" placeholder="Optional" />
      </Field>
      <Field label="Email">
        <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-10" />
      </Field>
      <Field label="Password" hint="At least 10 characters">
        <Input type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} className="h-10" />
      </Field>
      <Field label="Confirm password">
        <Input type="password" autoComplete="new-password" required minLength={10} value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-10" />
      </Field>
      {error ? (
        <p id="setup-error" role="alert" className="rounded-md bg-bad-soft px-3 py-2 text-[13px] text-bad">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="md" loading={pending} className="w-full">
        Create account
      </Button>
    </form>
  );
}

function AuthForm({ onUnreachable }: { onUnreachable: () => void }) {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    get<{ needs_setup: boolean }>("/auth/setup")
      .then((status) => {
        if (!cancelled) setNeedsSetup(status.needs_setup);
      })
      .catch((err) => {
        if (cancelled) return;
        setNeedsSetup(false);
        if (err instanceof ApiError && (err.status === 0 || err.status >= 500)) onUnreachable();
      });
    return () => {
      cancelled = true;
    };
  }, [onUnreachable]);

  if (needsSetup === null) return <p className="py-8 text-center text-[13px] text-muted">Loading…</p>;
  return needsSetup ? <CreateAdminForm /> : <SignInForm />;
}

function DemoCard({ unreachable }: { unreachable: boolean }) {
  return (
    <div className={`mt-4 rounded-2xl border p-4 ${unreachable ? "border-warn/40 bg-warn-soft" : "border-line bg-surface"}`}>
      {unreachable ? (
        <p className="mb-3 flex items-start gap-2 text-[13px] text-warn">
          <WifiOff className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong className="font-semibold">The LayerFlow API isn&apos;t reachable.</strong> Start the backend to sign in, or explore the full product with sample data. No backend needed.
          </span>
        </p>
      ) : (
        <p className="mb-3 text-[13px] text-ink-2">See it in action with three sample clients: a news site, a college portal and a hackathon finder. No account needed.</p>
      )}
      <Button variant={unreachable ? "primary" : "secondary"} size="lg" className="w-full" icon={<Sparkles className="size-4" />} onClick={() => enterDemo("/")}>
        Explore the live demo
        <ArrowRight className="size-4" />
      </Button>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const qc = useQueryClient();

  // If auth is already available (a real session or DISABLE_AUTH=true on the API), skip the
  // login screen and go straight to the dashboard.
  const [unreachable, setUnreachable] = useState(false);
  const markUnreachable = useCallback(() => setUnreachable(true), []);

  useEffect(() => {
    if (isDemoMode()) {
      router.replace("/");
      return;
    }
    api<Me>("/auth/me", { redirectOn401: false })
      .then((me) => {
        qc.setQueryData(["me"], me);
        router.replace("/");
      })
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 0 || err.status >= 500)) setUnreachable(true);
      });
  }, [qc, router]);

  return (
    <div className="bg-grid flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-7 flex flex-col items-center text-center">
          <span className="mb-4 flex size-10 items-center justify-center rounded-xl bg-ink text-bg shadow-md">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M4 7h10M4 12h16M4 17h7" />
            </svg>
          </span>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Sign in to LayerFlow</h1>
          <p className="mt-1 text-[13.5px] text-ink-2">AI agents for every client: activate, chain and run.</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-md">
          <Suspense fallback={null}>
            <AuthForm onUnreachable={markUnreachable} />
          </Suspense>
        </div>
        <DemoCard unreachable={unreachable} />
        <p className="mt-6 text-center text-[13px] text-muted">
          New company?{" "}
          <Link href="/register" className="font-medium text-accent hover:underline">
            Create a workspace
          </Link>
        </p>
      </div>
    </div>
  );
}
