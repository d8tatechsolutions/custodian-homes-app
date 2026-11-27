import { describe, expect, it } from "vitest";
import { maskEmail, maskEmailsInText } from "@/lib/mask-email";

describe("maskEmail", () => {
  it("keeps only the first letters and the ending", () => {
    expect(maskEmail("jane.doe@example.com")).toBe("j***@e***.com");
    expect(maskEmail("a@b.co.ke")).toBe("a***@b***.ke");
  });

  it("never returns the input when it is not a normal address", () => {
    expect(maskEmail("")).toBe("***");
    expect(maskEmail("@example.com")).toBe("***");
    expect(maskEmail("no-at-sign")).toBe("***");
    expect(maskEmail("jane@localhost")).toBe("j***@l***");
  });
});

describe("maskEmailsInText", () => {
  it("masks every address inside an SMTP reply", () => {
    const reply = "550 5.1.1 <jane.doe@example.com>: Recipient rejected, cc bob@mail.co.ke";
    const masked = maskEmailsInText(reply);
    expect(masked).toBe("550 5.1.1 <j***@e***.com>: Recipient rejected, cc b***@m***.ke");
    expect(masked).not.toContain("jane.doe");
    expect(masked).not.toContain("bob@");
  });

  it("leaves text without addresses alone", () => {
    expect(maskEmailsInText("421 Service not available")).toBe("421 Service not available");
  });
});
