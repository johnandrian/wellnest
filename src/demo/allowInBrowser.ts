// Convex warns when its server functions are defined in a browser, since that's usually a mistake. The example
// dashboard does it on purpose (./server.ts), so it says so before any of them load.
if (typeof window !== "undefined") (window as unknown as { __convexAllowFunctionsInBrowser?: boolean }).__convexAllowFunctionsInBrowser = true;

export {};
