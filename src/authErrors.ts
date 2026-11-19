// What went wrong when signing in or up (src/SignIn.tsx), from the error Convex Auth throws, so the message says
// what to do: a taken email, a wrong password, a password that's too short, or no connection.
export type AuthProblem = "taken" | "wrong" | "shortPassword" | "badEmail" | "offline" | "signUpFailed";

export const looksLikeEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

export function authProblem(error: unknown, flow: "signIn" | "signUp"): AuthProblem {
  const text = error instanceof Error ? error.message : String(error ?? "");
  if (/already exists/i.test(text)) return "taken";
  if (/failed to fetch|network|connection|timed? ?out|offline|websocket/i.test(text)) return "offline";
  if (flow === "signUp") return /invalid password/i.test(text) ? "shortPassword" : "signUpFailed";
  // Signing in, anything else means the email or password didn't match.
  return "wrong";
}
