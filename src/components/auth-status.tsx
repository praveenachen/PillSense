"use client";

import { useAuth } from "@clerk/nextjs";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

function StatusDot({ ready }: { ready: boolean }) {
  return <span className={`size-2 rounded-full ${ready ? "bg-emerald-500" : "bg-amber-500"}`} />;
}

export function AuthStatus() {
  const { isLoaded: clerkLoaded, isSignedIn } = useAuth();
  const { isLoading: convexLoading, isAuthenticated: convexAuthenticated } = useConvexAuth();
  const confirmation = useQuery(
    api.auth.confirmation,
    convexAuthenticated ? {} : "skip",
  );

  const clerkLabel = !clerkLoaded
    ? "Clerk loading"
    : isSignedIn
      ? "Clerk signed in"
      : "Clerk signed out";
  const convexLabel = convexLoading
    ? "Convex validating"
    : confirmation?.authenticated
      ? "Convex authenticated"
      : "Convex signed out";

  return (
    <aside aria-label="Temporary authentication status" className="flex flex-wrap gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
      <span className="flex items-center gap-2">
        <StatusDot ready={Boolean(clerkLoaded && isSignedIn)} />
        {clerkLabel}
      </span>
      <span className="flex items-center gap-2">
        <StatusDot ready={Boolean(confirmation?.authenticated)} />
        {convexLabel}
      </span>
    </aside>
  );
}
