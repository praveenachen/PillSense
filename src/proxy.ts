import { clerkMiddleware } from "@clerk/nextjs/server";

// Establish Clerk request auth for App Router server code. The current M0 page
// shells remain public; future private routes must call auth.protect() here and
// still authorize every Convex function independently.
export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    "/(api|trpc)(.*)",
  ],
};
