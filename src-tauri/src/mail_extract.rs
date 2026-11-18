//! Picks the verification code out of one email with plain text rules, no AI:
//! a code is a short run of digits next to a word like "验证码", and numbers
//! that read as a date, a time, an amount or a phone number are left alone.

use mail_parser::MessageParser;

/// An email counts only if its subject or body has one of these (lowercase).
const CODE_WORDS: [&str; 13] = [
    "验证码",
    "校验码",
    "动态码",
    "动态密码",
    "确认码",
    "安全码",
    "verification code",
    "security code",
    "login code",
    "sign-in code",
    "one-time code",
    "one-time password",
    "passcode",
];
/// The code sits next to one of these; every word in `CODE_WORDS` contains one.
const NEAR_WORDS: [&str; 2] = ["code", "码"];
const CODE_DIGITS: std::ops::RangeInclusive<usize> = 4..=8;
/// How far, in characters, a code may sit after a near word or before it.
const MAX_GAP_AFTER: usize = 40;
const MAX_GAP_BEFORE: usize = 30;
/// A code before its word ("123456 is your code") is less usual than after it.
const BEFORE_PENALTY: usize = 2;
/// Right before the digits, these make them part of something else: a decimal, a time, a date, a colour, money, a phone number.
const NOT_CODE_BEFORE: &[char] = &['.', ',', ':', '/', '#', '_', '+', '¥', '￥', '$'];
/// Right after the digits: a time, a date, a percentage, an amount.
const NOT_CODE_AFTER: &[char] = &[':', '/', '%', '_', '@', '元', '年', '月', '日', '号'];
const MONEY: &[char] = &['¥', '￥', '$'];
/// Shown when the email names no sender.
const UNKNOWN_SENDER: &str = "邮件";

#[derive(Debug, PartialEq, Eq)]
pub enum Verdict {
    Code(String),
    /// A verification email whose code these rules cannot find, e.g. one with letters in it.
    Unrecognized,
    NotCode,
}

pub struct Reading {
    pub sender: String,
    pub verdict: Verdict,
}

/// Decodes a raw message (any charset, plain text or HTML) and looks for a code. None when it is not an email.
pub fn read_message(raw: &[u8]) -> Option<Reading> {
    let message = MessageParser::default().parse(raw)?;
    let sender = message
        .from()
        .and_then(|from| from.first())
        .and_then(|first| first.name().or(first.address()))
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or(UNKNOWN_SENDER)
        .to_owned();
    let subject = message.subject().unwrap_or_default();
    let body = message.body_text(0).unwrap_or_default();
    Some(Reading { sender, verdict: find_code(subject, &body) })
}

pub fn find_code(subject: &str, body: &str) -> Verdict {
    let subject = normalize(subject);
    let body = normalize(body);
    let is_code_mail = CODE_WORDS.iter().any(|word| subject.contains(word) || body.contains(word));
    if !is_code_mail {
        return Verdict::NotCode;
    }
    let subject: Vec<char> = subject.chars().collect();
    let body: Vec<char> = body.chars().collect();
    near_word(&subject)
        .or_else(|| near_word(&body))
        .or_else(|| own_line(&body))
        .map_or(Verdict::Unrecognized, Verdict::Code)
}

/// Lowercase, each line trimmed with its runs of spaces made one, blank lines dropped.
fn normalize(text: &str) -> String {
    text.to_lowercase()
        .lines()
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

struct Candidate {
    start: usize,
    end: usize,
    digits: String,
}

/// Every run of 4 to 8 digits that reads as a code on its own; "123 456" and "123-456" count as one.
fn candidates(text: &[char]) -> Vec<Candidate> {
    let mut found = Vec::new();
    let mut index = 0;
    while index < text.len() {
        if !text[index].is_ascii_digit() {
            index += 1;
            continue;
        }
        let start = index;
        let mut end = digits_end(text, start);
        let mut digits: String = text[start..end].iter().collect();
        if end - start == 3
            && matches!(text.get(end), Some(' ' | '-'))
            && digits_end(text, end + 1) == end + 4
        {
            digits.extend(&text[end + 1..end + 4]);
            end += 4;
        }
        if CODE_DIGITS.contains(&digits.len()) && free_before(text, start) && free_after(text, end) {
            found.push(Candidate { start, end, digits });
        }
        index = end;
    }
    found
}

fn digits_end(text: &[char], from: usize) -> usize {
    let mut end = from;
    while text.get(end).is_some_and(char::is_ascii_digit) {
        end += 1;
    }
    end
}

fn free_before(text: &[char], start: usize) -> bool {
    let Some(&before) = start.checked_sub(1).and_then(|index| text.get(index)) else {
        return true;
    };
    if before.is_ascii_alphanumeric() || NOT_CODE_BEFORE.contains(&before) {
        return false;
    }
    // "2026-11" or "010-1234" go on from a number; Google's "G-482913" is a code.
    if before == '-' {
        return !start.checked_sub(2).and_then(|index| text.get(index)).is_some_and(char::is_ascii_digit);
    }
    // "¥ 1288": money written with a space.
    !text[..start].iter().rev().find(|c| !c.is_whitespace()).is_some_and(|c| MONEY.contains(c))
}

fn free_after(text: &[char], end: usize) -> bool {
    let Some(&after) = text.get(end) else {
        return true;
    };
    if after.is_ascii_alphanumeric() || NOT_CODE_AFTER.contains(&after) {
        return false;
    }
    // "3.14", "1,000", "11-18": the number goes on.
    !(matches!(after, '.' | ',' | '-') && text.get(end + 1).is_some_and(char::is_ascii_digit))
}

/// Start and end of every near word in `text`.
fn near_words(text: &[char]) -> Vec<(usize, usize)> {
    let mut found = Vec::new();
    for word in NEAR_WORDS {
        let word: Vec<char> = word.chars().collect();
        for (start, window) in text.windows(word.len()).enumerate() {
            if window == word.as_slice() {
                found.push((start, start + word.len()));
            }
        }
    }
    found
}

/// The candidate closest to a near word, preferring one that comes after it.
fn near_word(text: &[char]) -> Option<String> {
    let words = near_words(text);
    candidates(text)
        .into_iter()
        .filter_map(|candidate| {
            words
                .iter()
                .filter_map(|&(word_start, word_end)| {
                    if candidate.start >= word_end {
                        let gap = candidate.start - word_end;
                        (gap <= MAX_GAP_AFTER).then_some(gap)
                    } else if candidate.end <= word_start {
                        let gap = word_start - candidate.end;
                        (gap <= MAX_GAP_BEFORE).then_some(gap * BEFORE_PENALTY)
                    } else {
                        None
                    }
                })
                .min()
                .map(|score| (score, candidate))
        })
        .min_by_key(|(score, candidate)| (*score, candidate.start))
        .map(|(_, candidate)| candidate.digits)
}

/// A code shown large on a line of its own, far from any word.
fn own_line(text: &[char]) -> Option<String> {
    text.split(|c| *c == '\n').find_map(|line| match candidates(line).as_slice() {
        [only] if only.start == 0 && only.end == line.len() => Some(only.digits.clone()),
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::{Verdict, find_code, read_message};

    fn code(subject: &str, body: &str) -> Verdict {
        find_code(subject, body)
    }

    fn found(text: &str) -> Verdict {
        Verdict::Code(text.into())
    }

    #[test]
    fn finds_a_chinese_code_after_its_word() {
        assert_eq!(code("网易邮箱验证码", "您的验证码是：384920，10分钟内有效。"), found("384920"));
    }

    #[test]
    fn finds_a_code_in_the_subject_first() {
        assert_eq!(code("G-482913 is your Google verification code", "Someone signed in."), found("482913"));
        assert_eq!(code("582013 是你的登录验证码", ""), found("582013"));
    }

    #[test]
    fn finds_an_english_code() {
        assert_eq!(code("Please verify your device", "Verification code: 123456\nIf you did not try to sign in, ignore this."), found("123456"));
    }

    #[test]
    fn joins_a_code_written_in_two_groups() {
        assert_eq!(code("Your security code", "Your security code is 123 456."), found("123456"));
        assert_eq!(code("Your security code", "Your security code is 123-456."), found("123456"));
    }

    #[test]
    fn skips_amounts_dates_times_and_phone_numbers() {
        let body = "订单金额 ¥1288，2026-11-18 10:30 发至 13800138000，验证码：6621";
        assert_eq!(code("", body), found("6621"));
        assert_eq!(code("", "金额 1288元，验证码见下\n4417"), found("4417"));
        assert_eq!(code("", "验证码 ¥ 9999 无效，7788"), found("7788"));
    }

    #[test]
    fn takes_a_code_alone_on_its_line() {
        assert_eq!(code("你的登录验证码", "请在页面中输入：\n\n   739201  \n\n如非本人操作请忽略。这是一封很长很长很长很长很长很长很长很长很长很长的说明"), found("739201"));
    }

    #[test]
    fn says_so_when_a_verification_email_has_no_readable_code() {
        assert_eq!(code("Your verification code", "Your verification code is AB7KQZ."), Verdict::Unrecognized);
    }

    #[test]
    fn ignores_mail_without_a_code_word() {
        assert_eq!(code("Black Friday 2026", "Save 50% on 1000 items, order 123456 today"), Verdict::NotCode);
    }

    /// A 163-style HTML email in GBK, base64-encoded, with a stylesheet, a date and a time.
    const GBK_MAIL: &str = "From: =?GBK?B?zfjS19PKvP7W0NDE?= <service@netease.com>\r\n\
Subject: =?GBK?B?zfjS19PKz+TR6dakwus=?=\r\n\
MIME-Version: 1.0\r\n\
Content-Type: text/html; charset=GBK\r\n\
Content-Transfer-Encoding: base64\r\n\
\r\n\
PGh0bWw+PGhlYWQ+PHN0eWxlPi5je2NvbG9yOiMzMzMzMzM7Zm9udC1zaXplOjE2cHh9PC9zdHls\r\n\
ZT48L2hlYWQ+PGJvZHk+PHA+1/C+tLXE08O7p6O6PC9wPjxwPsT6tcTR6dakwuvKx6O6PHNwYW4g\r\n\
Y2xhc3M9ImMiPjM4NDkyMDwvc3Bhbj6jrDEwt9bW08Ta09DQp6GjPC9wPjxwPjIwMjYtMTEtMTgg\r\n\
MTA6MzA8L3A+PC9ib2R5PjwvaHRtbD4=\r\n";

    #[test]
    fn reads_a_gbk_html_email() {
        let reading = read_message(GBK_MAIL.as_bytes()).expect("a message");
        assert_eq!(reading.sender, "网易邮件中心");
        assert_eq!(reading.verdict, found("384920"));
    }

    #[test]
    fn falls_back_to_the_address_when_there_is_no_name() {
        let raw = "From: noreply@github.com\r\nSubject: [GitHub] Please verify your device\r\n\r\nVerification code: 902114\r\n";
        let reading = read_message(raw.as_bytes()).expect("a message");
        assert_eq!(reading.sender, "noreply@github.com");
        assert_eq!(reading.verdict, found("902114"));
    }
}
