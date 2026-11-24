import { describe, expect, it } from "vitest";
import { MAIL_CODE_ACTIVITY, mailCodeActivity } from "./mailCodeActivity";

describe("mailCodeActivity", () => {
  it("runs, and can be stopped, while it waits for mail", () => {
    expect(mailCodeActivity({ kind: "waiting" })).toEqual({ activity: { id: MAIL_CODE_ACTIVITY, state: "running", label: "等验证码", icon: "mail", cancellable: true } });
  });

  it("is done with the code once one is found, and keeps it up for the user to type", () => {
    expect(mailCodeActivity({ kind: "found", code: "384920", sender: "网易邮件中心", copied: true }).activity).toMatchObject({ state: "done", text: "验证码 384920，已复制（网易邮件中心）", keep: true });
    expect(mailCodeActivity({ kind: "found", code: "1234", sender: "GitHub", copied: false }).activity.text).toBe("验证码 1234（GitHub），没能复制，手动输一下吧");
  });

  it("fails with the reason when no code came", () => {
    expect(mailCodeActivity({ kind: "unrecognized", sender: "GitHub" }).activity).toMatchObject({ state: "failed", text: "收到一封验证码邮件（GitHub），但我没认出码，去邮箱看一眼吧" });
    expect(mailCodeActivity({ kind: "timeout" }).activity).toMatchObject({ state: "failed", text: "一直没等到验证码，可以再点一次查收" });
    expect(mailCodeActivity({ kind: "failed", message: "连不上 163 邮箱，检查一下网络。" }).activity).toMatchObject({ state: "failed", text: "连不上 163 邮箱，检查一下网络。" });
  });

  it("just goes away when the user stops it", () => {
    expect(mailCodeActivity({ kind: "cancelled" })).toEqual({ activity: { id: MAIL_CODE_ACTIVITY, state: "cancelled", label: "等验证码", icon: "mail" } });
  });

  it("goes away with a passing line when no mailbox is set up", () => {
    const { activity, say } = mailCodeActivity({ kind: "unset" });
    expect(activity.state).toBe("cancelled");
    expect(say).toBe("先在设置里加个 163 邮箱吧");
  });
});
