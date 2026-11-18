import { describe, expect, it } from "vitest";
import { locateCode } from "./MailCodeTester";

describe("locateCode", () => {
  it("finds the code with a little context, on one line", () => {
    expect(locateCode("Dear lance,\n\nYour code is: 57743. Use it to access your account.", "57743")).toEqual({
      before: "Dear lance, Your code is: ",
      code: "57743",
      after: ". Use it to access your accoun…",
    });
  });

  it("finds a code written in two groups", () => {
    expect(locateCode("security code 123 456", "123456")?.code).toBe("123 456");
    expect(locateCode("security code 123-456", "123456")?.code).toBe("123-456");
  });

  it("does not take the digits out of a longer number", () => {
    expect(locateCode("order 9123456 and code 123456", "123456")?.before).toBe("order 9123456 and code ");
    expect(locateCode("order 91234567", "123456")).toBeNull();
  });
});
