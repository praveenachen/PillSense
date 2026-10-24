import { SignInButton } from "@clerk/nextjs";

export function AuthRequired({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-950">
      <h2 className="text-lg font-semibold">Sign in required</h2>
      <p className="mt-2 text-sm leading-6">{message}</p>
      <div className="mt-4">
        <SignInButton mode="modal">
          <button type="button" className="rounded-full bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700">
            Sign in to PillSense
          </button>
        </SignInButton>
      </div>
    </div>
  );
}
