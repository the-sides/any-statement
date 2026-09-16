import { describe, expect, test } from "bun:test";
import { describeViewer } from "@/lib/viewer";

describe("describeViewer", () => {
  test("reports a session's address", () => {
    expect(describeViewer({ demo: false, email: "owner@example.com" })).toEqual({
      status: "signed-in",
      email: "owner@example.com"
    });
  });

  test("reports the demo tenant even when a session exists", () => {
    // `getCurrentUserId()` answers with DEMO_USER_ID in that build, so naming
    // the signed-in address would label rows the page cannot read.
    expect(describeViewer({ demo: true, email: "owner@example.com" })).toEqual({
      status: "demo",
      email: ""
    });
  });

  test("treats a missing or blank address as signed out", () => {
    expect(describeViewer({ demo: false, email: undefined }).status).toBe(
      "signed-out"
    );
    expect(describeViewer({ demo: false, email: "   " }).status).toBe(
      "signed-out"
    );
  });
});
