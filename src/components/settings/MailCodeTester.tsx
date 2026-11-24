import { useEffect, useRef, useState } from "react";
import { mailCodePlatform, type MailCodeTrial } from "../../platform/mailCode";

/** Longest subject or body taken. Must match `MAX_TRY_CHARS` in `src-tauri/src/mail_code.rs`. */
export const TRY_TEXT_LIMIT = 50_000;
/** Typing settles for this long before the rules run. */
const TRY_DELAY_MS = 250;
/** Characters of context shown on each side of the code. */
const SNIPPET_CONTEXT = 30;

export interface CodeSpot {
  before: string;
  code: string;
  after: string;
}

/**
 * Where `code` sits in the pasted text, with a little context on each side, so
 * the user sees which number was taken. "123 456" and "123-456" count, as the rules read them.
 */
export function locateCode(text: string, code: string): CodeSpot | null {
  const pattern = new RegExp(`(?<!\\d)${code.split("").join("[ -]?")}(?!\\d)`);
  const match = pattern.exec(text);
  if (!match) return null;
  const flat = (part: string) => part.replace(/\s+/g, " ");
  const start = Math.max(0, match.index - SNIPPET_CONTEXT);
  const end = Math.min(text.length, match.index + match[0].length + SNIPPET_CONTEXT);
  return {
    before: (start > 0 ? "…" : "") + flat(text.slice(start, match.index)),
    code: match[0],
    after: flat(text.slice(match.index + match[0].length, end)) + (end < text.length ? "…" : ""),
  };
}

type Outcome = { kind: "idle" } | { kind: "error"; message: string } | MailCodeTrial;

function Result({ outcome, subject, body }: { outcome: Outcome; subject: string; body: string }) {
  switch (outcome.kind) {
    case "idle":
      return <p className="mail-tester__hint">粘贴一封邮件的标题和正文，这里马上显示宠物能不能认出验证码。</p>;
    case "error":
      return <p className="mail-tester__result is-error">{outcome.message}</p>;
    case "found": {
      const spot = locateCode(subject, outcome.code) ?? locateCode(body, outcome.code);
      return (
        <div className="mail-tester__result is-found">
          <strong>认出了验证码 <span className="mail-tester__code">{outcome.code}</span></strong>
          <span>按「{outcome.word}」判断这是验证码邮件。</span>
          {spot && <q className="mail-tester__spot">{spot.before}<mark>{spot.code}</mark>{spot.after}</q>}
        </div>
      );
    }
    case "unrecognized":
      return (
        <div className="mail-tester__result is-unrecognized">
          <strong>是验证码邮件，但没认出码</strong>
          <span>按「{outcome.word}」判断这是验证码邮件，但附近没有 4～8 位的数字。字母和数字混在一起的码目前认不出，查收时宠物会提醒你去邮箱看。</span>
        </div>
      );
    case "not_code":
      return (
        <div className="mail-tester__result is-skipped">
          <strong>不像验证码邮件</strong>
          <span>标题和正文里都没有「验证码」「verification code」「your code」这类词，查收时会跳过这封。</span>
        </div>
      );
  }
}

/** "认不出验证码？": runs the same rules as "查收验证码" on pasted text, as the user types. */
export function MailCodeTester() {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  /** Bumped for every run, so an answer that comes back late cannot replace a newer one. */
  const latest = useRef(0);

  useEffect(() => {
    const run = ++latest.current;
    if (!subject.trim() && !body.trim()) {
      setOutcome({ kind: "idle" });
      return;
    }
    const timer = setTimeout(() => {
      mailCodePlatform.tryText(subject, body)
        .then((trial) => { if (run === latest.current) setOutcome(trial); })
        .catch((reason: unknown) => {
          console.error("Trying the code rules failed", reason);
          const text = String(reason).replace(/^Error:\s*/, "");
          if (run === latest.current) setOutcome({ kind: "error", message: /[一-鿿]/.test(text) ? text : "没能识别，请再试一次。" });
        });
    }, TRY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [subject, body]);

  return (
    <div className="mail-tester">
      <label htmlFor="mail-tester-subject">标题<span>（可选）</span></label>
      <input className="ui-field ui-field--small" id="mail-tester-subject" type="text" spellCheck={false} maxLength={TRY_TEXT_LIMIT} value={subject} onChange={(event) => setSubject(event.currentTarget.value)} placeholder="例如：Your login code" />
      <label htmlFor="mail-tester-body">正文</label>
      <textarea id="mail-tester-body" spellCheck={false} maxLength={TRY_TEXT_LIMIT} value={body} onChange={(event) => setBody(event.currentTarget.value)} placeholder="把邮件正文复制过来" />
      <div role="status" aria-live="polite"><Result outcome={outcome} subject={subject} body={body} /></div>
    </div>
  );
}
