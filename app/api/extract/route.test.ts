import { describe, expect, test } from "bun:test";
import { POST } from "@/app/api/extract/route";

describe("POST /api/extract", () => {
  test("rejects oversized multipart requests before parsing form data", async () => {
    const request = new Request("http://localhost/api/extract", {
      method: "POST",
      headers: {
        "content-length": String(14 * 1024 * 1024),
        "content-type": "multipart/form-data; boundary=test"
      }
    });

    Object.defineProperty(request, "formData", {
      value: async () => {
        throw new Error("formData should not be called for oversized uploads");
      }
    });

    const response = await POST(request);
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(413);
    expect(payload.error).toBe(
      "Statement file is too large. The current limit is 12 MB."
    );
  });
});
