import { useEffect, useState, type FormEvent } from "react";
import { mailCodePlatform } from "../../platform/mailCode";
import { systemPlatform } from "../../platform/system";
import { ConfirmButton } from "../ConfirmButton";
import { MailCodeTester } from "./MailCodeTester";

/** Where IMAP is switched on and the authorization code is made: the 163 web mail. */
const MAIL_163 = "https://mail.163.com/";
const HAS_CHINESE = /[一-鿿]/;

/** The native side words its errors for the user; anything else is logged and replaced. */
function saveError(reason: unknown, doing: string): string {
  console.error(`Mailbox ${doing} failed`, reason);
  const text = String(reason).replace(/^Error:\s*/, "");
  return HAS_CHINESE.test(text) ? text : `${doing}失败，请再试一次。`;
}

export function MailSettings() {
  const [address, setAddress] = useState<string | null | undefined>(undefined);
  const [draftAddress, setDraftAddress] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  /** Open while no mailbox is saved, and behind "更换" after. */
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    mailCodePlatform.account()
      .then((saved) => { setAddress(saved); if (!saved) setExpanded(true); })
      .catch((reason: unknown) => { setAddress(null); setExpanded(true); setStatus(saveError(reason, "读取邮箱设置")); });
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draftAddress.trim() || !password.trim()) return;
    setBusy(true); setStatus("正在连接 163 邮箱…");
    try {
      await mailCodePlatform.saveAccount(draftAddress, password);
      setAddress(draftAddress.trim().toLowerCase()); setDraftAddress(""); setPassword(""); setExpanded(false);
      setStatus("已连上。要验证码时，右键点宠物，选「查收验证码」。");
    } catch (reason) { setStatus(saveError(reason, "保存")); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setStatus("");
    try { await mailCodePlatform.removeAccount(); setAddress(null); setExpanded(true); setStatus("已移除邮箱。"); }
    catch (reason) { setStatus(saveError(reason, "移除")); }
    finally { setBusy(false); }
  };
  const open163 = () => void systemPlatform.openLink(MAIL_163).catch((reason: unknown) => { console.error("Could not open 163 mail", reason); setStatus("没能打开网页，可以自己在浏览器里打开 mail.163.com。"); });

  // Rendered inside the "小工具" page, so it brings no section of its own.
  return <>
    <div className="settings-section__intro"><h2>查收验证码</h2><p>网站把验证码发到邮箱后，右键点宠物，选「查收验证码」。宠物会找到最新的验证码，复制好告诉你。</p></div>
    <article className="settings-card ai-settings mail-settings">
      <div className="ai-settings__head">
        <div><strong>163 邮箱</strong><span>{address ?? "填邮箱地址和授权码，连上后才会保存"}</span></div>
        <span className={address ? "ai-badge is-ready" : "ai-badge"}>{address === undefined ? "检查中" : address ? "已连上" : "未配置"}</span>
        {address && <button type="button" className="settings-button settings-button--small" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>{expanded ? "收起" : "更换"}</button>}
      </div>
      {expanded && <>
        <form onSubmit={(event) => void save(event)}>
          <label htmlFor="mail-address">邮箱地址</label>
          <div className="ai-settings__key"><input id="mail-address" type="email" autoComplete="off" spellCheck={false} value={draftAddress} onChange={(event) => setDraftAddress(event.currentTarget.value)} placeholder="name@163.com" /></div>
          <label htmlFor="mail-password">授权码</label>
          <div className="ai-settings__key"><input id="mail-password" type="password" autoComplete="off" value={password} onChange={(event) => setPassword(event.currentTarget.value)} placeholder="粘贴 163 给的授权码，不是登录密码" /><button type="submit" className="is-primary" disabled={busy || !draftAddress.trim() || !password.trim()}>{busy ? "连接中…" : "连接并保存"}</button></div>
        </form>
        <ol className="mail-steps">
          <li>登录网页版 163 邮箱，打开「设置 → POP3/SMTP/IMAP」，开启「IMAP/SMTP 服务」。</li>
          <li>按提示用手机验证，复制页面给出的授权码。</li>
          <li>回到这里粘贴，点「连接并保存」。</li>
        </ol>
        <p>授权码存在钥匙串里。宠物只在你查收时读收件箱里最新的几封邮件，只读，不会标成已读；邮件内容不保存，也不发给 AI。</p>
        <div className="ai-settings__actions">
          {address && <ConfirmButton disabled={busy} confirm={{ message: "移除 163 邮箱？", detail: "邮箱地址和授权码会从钥匙串里删掉，之后要重新填写才能查收验证码。", action: "移除" }} onConfirm={() => void remove()}>移除邮箱</ConfirmButton>}
          <button type="button" className="ai-settings__link" onClick={open163}>打开 163 邮箱 ↗</button>
        </div>
      </>}
      {status && <p className="ai-settings__status" role="status">{status}</p>}
    </article>
    <p className="settings-footnote">还没收到就接着等，最多 2 分钟；想停下就点宠物脚下的「等验证码」，或菜单里的「停止等验证码」。目前只支持 163 邮箱。</p>
    <div className="settings-section__intro settings-section__intro--spaced"><h2>试试能不能认出</h2><p>某封邮件没被认出来时，把它贴在这里，看看是哪一步没过。不用连邮箱，内容不保存。</p></div>
    <MailCodeTester />
  </>;
}
