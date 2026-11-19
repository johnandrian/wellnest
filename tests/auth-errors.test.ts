// Sign-in and sign-up errors told apart (src/authErrors.ts).
import { describe, expect, test } from "vitest";
import { authProblem, looksLikeEmail } from "../src/authErrors";

describe("auth errors", () => {
  test("a taken email, a wrong password, a short password, and no connection are told apart", () => {
    expect(authProblem(new Error("Account a@example.com already exists"), "signUp")).toBe("taken");
    expect(authProblem(new Error("Invalid password"), "signUp")).toBe("shortPassword");
    expect(authProblem(new Error("Server Error"), "signUp")).toBe("signUpFailed");
    expect(authProblem(new Error("InvalidSecret"), "signIn")).toBe("wrong");
    expect(authProblem(new Error("Invalid credentials"), "signIn")).toBe("wrong");
    expect(authProblem(new TypeError("Failed to fetch"), "signIn")).toBe("offline");
    expect(authProblem(new Error("Connection lost while action was in flight"), "signUp")).toBe("offline");
  });

  test("an email needs a name, an @, and a domain", () => {
    expect(looksLikeEmail(" a@example.com ")).toBe(true);
    expect(looksLikeEmail("a@example")).toBe(false);
    expect(looksLikeEmail("a example.com")).toBe(false);
  });
});
