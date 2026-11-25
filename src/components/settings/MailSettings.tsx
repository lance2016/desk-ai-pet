import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Chevron } from "./Chevron";
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

/** The row on 「小工具」 into this page, with how many mailboxes are set up. */
export function MailEntryRow({ icon, onOpen }: { icon: ReactNode; onOpen: () => void }) {
  const [addresses, setAddresses] = useState<string[] | undefined>(undefined);
  useEffect(() => { mailCodePlatform.accounts().then(setAddresses).catch((reason: unknown) => { console.warn("Could not read the mailboxes", reason); setAddresses([]); }); }, []);
  const summary = addresses === undefined ? "检查中" : addresses.length === 0 ? "还没加邮箱，加一个 163 邮箱才能查收" : addresses.length === 1 ? `已配置 ${addresses[0]}` : `已配置 ${addresses.length} 个邮箱，查收时一起找`;
  return <button type="button" className="settings-row settings-link" onClick={onOpen}>{icon}<span className="settings-row__body"><strong>163 邮箱</strong><span>{summary}</span></span><Chevron /></button>;
}

/** 「小工具 › 查收验证码」: the 163 mailboxes the pet looks in, and a way to see why a code was missed. */
export function MailSettings() {
  const [addresses, setAddresses] = useState<string[] | undefined>(undefined);
  const [draftAddress, setDraftAddress] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  /** Open while no mailbox is saved, and behind "添加" after. */
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    mailCodePlatform.accounts()
      .then((saved) => { setAddresses(saved); if (saved.length === 0) setExpanded(true); })
      .catch((reason: unknown) => { setAddresses([]); setExpanded(true); setStatus(saveError(reason, "读取邮箱设置")); });
  }, []);
  const saved = addresses ?? [];

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draftAddress.trim() || !password.trim()) return;
    setBusy(true); setStatus("正在连接 163 邮箱…");
    try {
      await mailCodePlatform.saveAccount(draftAddress, password);
      const added = draftAddress.trim().toLowerCase();
      setAddresses([...saved.filter((address) => address !== added), added]); setDraftAddress(""); setPassword(""); setExpanded(false);
      setStatus(`已连上 ${added}。要验证码时，右键点宠物，选「查收验证码」。`);
    } catch (reason) { setStatus(saveError(reason, "保存")); }
    finally { setBusy(false); }
  };
  const remove = async (removed: string) => {
    setBusy(true); setStatus("");
    try {
      await mailCodePlatform.removeAccount(removed);
      const left = saved.filter((address) => address !== removed);
      setAddresses(left); if (left.length === 0) setExpanded(true); setStatus(`已移除 ${removed}。`);
    }
    catch (reason) { setStatus(saveError(reason, "移除")); }
    finally { setBusy(false); }
  };
  const open163 = () => void systemPlatform.openLink(MAIL_163).catch((reason: unknown) => { console.error("Could not open 163 mail", reason); setStatus("没能打开网页，可以自己在浏览器里打开 mail.163.com。"); });

  return <div className="settings-section">
    <div className="settings-section__intro"><h2>163 邮箱</h2><p>右键点宠物选「查收验证码」，它在这些邮箱里找到验证码并复制好</p></div>
    <article className="settings-card ai-settings mail-settings">
      <div className="ai-settings__head">
        <div><strong>邮箱</strong><span>{saved.length > 1 ? `已配置 ${saved.length} 个，查收时一起找` : "可以加几个，查收时一起找"}</span></div>
        <span className={saved.length ? "ai-badge is-ready" : "ai-badge"}>{addresses === undefined ? "检查中" : saved.length ? "已配置" : "未配置"}</span>
        {saved.length > 0 && <button type="button" className="ui-button ui-button--small" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>{expanded ? "收起" : "添加"}</button>}
      </div>
      {saved.length > 0 && <ul className="mail-accounts">
        {saved.map((address) => <li key={address}>
          <span>{address}</span>
          <ConfirmButton className="ui-button ui-button--small" disabled={busy} confirm={{ message: `移除 ${address}？`, detail: "这个邮箱的地址和授权码会从钥匙串里删掉，之后不再查它的验证码。", action: "移除" }} onConfirm={() => void remove(address)}>移除</ConfirmButton>
        </li>)}
      </ul>}
      {expanded && <>
        <form className="mail-form" onSubmit={(event) => void save(event)}>
          <label htmlFor="mail-address">邮箱地址</label>
          <input className="ui-field ui-field--small" id="mail-address" type="email" autoComplete="off" spellCheck={false} value={draftAddress} onChange={(event) => setDraftAddress(event.currentTarget.value)} placeholder="name@163.com" />
          <label htmlFor="mail-password">授权码</label>
          <input className="ui-field ui-field--small" id="mail-password" type="password" autoComplete="off" value={password} onChange={(event) => setPassword(event.currentTarget.value)} placeholder="粘贴 163 给的授权码，不是登录密码" />
          <button type="submit" className="is-primary" disabled={busy || !draftAddress.trim() || !password.trim()}>{busy ? "连接中…" : "连接并保存"}</button>
        </form>
        <ol className="mail-steps">
          <li>登录网页版 163 邮箱，打开「设置 → POP3/SMTP/IMAP」，开启「IMAP/SMTP 服务」。</li>
          <li>按提示用手机验证，复制页面给出的授权码。</li>
          <li>回到这里粘贴，点「连接并保存」。已加过的邮箱再填一次，会换成新的授权码。</li>
        </ol>
        <p>只在你查收时读最新几封邮件，不标已读，不保存，也不发给 AI。</p>
        <div className="ai-settings__actions">
          <button type="button" className="ai-settings__link" onClick={open163}>打开 163 邮箱 ↗</button>
        </div>
      </>}
      {status && <p className="ai-settings__status" role="status">{status}</p>}
    </article>
    <p className="settings-footnote">会一起查所有加过的邮箱，取最新的一条。邮件没到会接着等，最多 2 分钟。目前只支持 163 邮箱。</p>
    <details className="ai-disclosure ai-disclosure--standalone mail-try">
      <summary><span><strong>认不出验证码？</strong><small>把邮件贴进来，看看卡在哪一步</small></span></summary>
      <MailCodeTester />
    </details>
  </div>;
}
