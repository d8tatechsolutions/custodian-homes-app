/**
 * Cache-Control for public, viewer-independent API responses (marketplace).
 * Vercel's edge serves the cached copy for 30 seconds and refreshes it in the
 * background for up to 2 minutes, so busy public pages rarely reach the server.
 * Never use it on a response that depends on who is signed in.
 */
export const PUBLIC_EDGE_CACHE = "public, s-maxage=30, stale-while-revalidate=120";
