import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Public product shells remain visible, while the internal Hardware Lab also
// requires Clerk authentication at the route boundary. Convex still performs
// the authoritative role and synthetic-patient scope checks independently.
const isHardwareLab = createRouteMatcher(["/hardware-lab(.*)"]);

export default clerkMiddleware(async (auth, request) => {
  if (isHardwareLab(request)) await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    "/(api|trpc)(.*)",
  ],
};
