"use client";

import {
  SignInButton,
  SignOutButton,
  SignUpButton,
  UserButton,
  useUser,
} from "@clerk/nextjs";

const buttonClass =
  "rounded-full border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:border-teal-400 hover:text-teal-700";

export function AuthControls() {
  const { isLoaded, isSignedIn, user } = useUser();

  if (!isLoaded) {
    return <span className="text-sm text-slate-500">Loading account…</span>;
  }

  if (!isSignedIn) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <SignInButton mode="modal">
          <button type="button" className={buttonClass}>Sign in</button>
        </SignInButton>
        <SignUpButton mode="modal">
          <button type="button" className="rounded-full bg-teal-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-teal-700">Sign up</button>
        </SignUpButton>
      </div>
    );
  }

  const displayName = user.fullName ?? user.firstName ?? "Signed-in user";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <UserButton />
      <span className="max-w-40 truncate text-sm font-medium text-slate-700">{displayName}</span>
      <SignOutButton>
        <button type="button" className={buttonClass}>Sign out</button>
      </SignOutButton>
    </div>
  );
}
