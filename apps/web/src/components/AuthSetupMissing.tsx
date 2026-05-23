import React from "react";

export function AuthSetupMissing() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <section className="w-full max-w-xl rounded-2xl border bg-card p-8 shadow-lg">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Setup required
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
          Authentication is not configured
        </h1>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          This hosted dashboard needs Clerk environment variables before sign-in can run. Configure the
          variables below in the deployment target, then redeploy.
        </p>
        <ul className="mt-5 space-y-2 rounded-xl bg-muted p-4 font-mono text-sm text-muted-foreground">
          <li>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</li>
          <li>CLERK_SECRET_KEY</li>
          <li>NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in</li>
          <li>NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up</li>
        </ul>
      </section>
    </main>
  );
}
