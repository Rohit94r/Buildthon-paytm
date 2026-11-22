"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Field, Input, Select } from "@/components/ui";
import { ApiError, errorMessage, post, setActiveWorkspace } from "@/lib/api";
import { enterDemo } from "@/lib/demo/mode";
import { useIsDemo } from "@/lib/hooks";
import type { RegisterRequest } from "@/lib/platform-ops-types";
import type { Me } from "@/lib/types";
import { INDUSTRIES } from "@/lib/workspace";

export default function RegisterPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const demo = useIsDemo();
  const [form, setForm] = useState<RegisterRequest>({ company: "", name: "", email: "", password: "", industry: "other", website: "" });
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [pending, setPending] = useState(false);
  const set = (k: keyof RegisterRequest) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password.length < 10) {
      setError("Use at least 10 characters for the password.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const me = await post<Me>("/auth/register", { ...form, website: form.website || undefined });
      setActiveWorkspace(me.tenant.slug);
      qc.clear();
      qc.setQueryData(["me"], me);
      router.replace("/?welcome=1");
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 403 || err.code === "signup_disabled")) setDisabled(true);
      else setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="bg-grid flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[460px]">
        <div className="mb-7 text-center">
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Create your workspace</h1>
          <p className="mt-1 text-[13.5px] text-ink-2">Activate agents, chain them into workflows and run them from your own site.</p>
          {demo ? <p className="mt-2 text-xs text-muted">Demo mode: this creates a sample workspace in your browser only.</p> : null}
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-md">
          {disabled ? (
            <div className="space-y-4 text-center">
              <p className="text-[13.5px] text-ink-2">Sign-up is turned off on this LayerFlow server. Ask your administrator for an invite, or explore the demo.</p>
              <Button variant="primary" size="lg" className="w-full" onClick={() => enterDemo("/register")}>
                Try it in the demo <ArrowRight className="size-4" />
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <Field label="Company">
                <Input required value={form.company} onChange={(e) => set("company")(e.target.value)} placeholder="Acme Media" className="h-10" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Industry">
                  <Select value={form.industry} onChange={(e) => set("industry")(e.target.value)} className="h-10">
                    {INDUSTRIES.map((i) => (
                      <option key={i.value} value={i.value}>
                        {i.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Website" hint="Optional">
                  <Input value={form.website} onChange={(e) => set("website")(e.target.value)} placeholder="acme.com" className="h-10" />
                </Field>
              </div>
              <Field label="Your name">
                <Input required autoComplete="name" value={form.name} onChange={(e) => set("name")(e.target.value)} className="h-10" />
              </Field>
              <Field label="Work email">
                <Input required type="email" autoComplete="username" value={form.email} onChange={(e) => set("email")(e.target.value)} className="h-10" />
              </Field>
              <Field label="Password" hint="At least 10 characters">
                <Input required type="password" autoComplete="new-password" minLength={10} value={form.password} onChange={(e) => set("password")(e.target.value)} className="h-10" />
              </Field>
              {error ? (
                <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">
                  {error}
                </p>
              ) : null}
              <Button type="submit" variant="primary" size="lg" loading={pending} className="w-full">
                Create workspace
              </Button>
            </form>
          )}
        </div>
        <p className="mt-6 text-center text-[13px] text-muted">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
