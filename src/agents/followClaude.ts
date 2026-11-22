import { activityUpdateSchema } from "../activity/Activity";
import { agentPlatform } from "../platform/agents";
import { loadCodingReactions } from "../preferences/CodingPreferences";
import type { ActivityUpdate } from "../types";
import { recordWork } from "../worklog/store";
import { CLAUDE_ACTIVITY_PREFIX, ClaudeSessions } from "./ClaudeSessions";
import { loadCodingSessions, saveCodingSessions } from "./codingStore";

/** How often sessions still going are looked at for an interruption, a missed Stop, a new title or a long silence. */
const CHECK_EVERY_MS = 5000;
const NO_FOLDER = "Claude";

/**
 * Follows Claude Code through its hooks. The sessions are kept on this Mac for
 * the coding card and panel, and across a restart; each change of a session's
 * state goes to `report` as an activity, for the pet to react to, unless the
 * user turned those reactions off. A turn long enough to be told about goes
 * into the work log. Returns a function that stops following.
 */
export function followClaude(report: (update: ActivityUpdate) => void): () => void {
  const sessions = new ClaudeSessions(loadCodingSessions());
  let saved = "";
  const keep = () => {
    const list = sessions.list();
    const next = JSON.stringify(list);
    if (next === saved) return;
    saved = next;
    try { saveCodingSessions(list); }
    catch (error) { console.warn("Could not keep the coding sessions", error); }
  };
  const send = (update: ActivityUpdate | null) => {
    keep();
    if (update === null) return;
    // With reactions off the pet lets go of whatever it was showing for the session.
    const shown: ActivityUpdate = loadCodingReactions() ? update : { id: update.id, state: "cancelled", label: update.label, icon: update.icon, noChip: true };
    // The label and the text come from a folder name outside the pet.
    const parsed = activityUpdateSchema.safeParse(shown);
    if (parsed.success) report(parsed.data);
    else console.warn("Dropping an agent activity that does not fit", parsed.error);
    if (update.state === "done") {
      const id = update.id.slice(CLAUDE_ACTIVITY_PREFIX.length);
      const project = sessions.list().find((session) => session.id === id)?.project;
      void recordWork([{ kind: "agent_turn_done", text: project || NO_FOLDER, before: null, itemId: null }], "agent");
    }
  };
  /** Asks the transcript whether the turn is over; `otherwise` runs when it is still going. */
  const check = (session: string, since: number, otherwise?: () => void) => {
    agentPlatform.turnOver(session, since)
      .then((how) => { if (how) send(sessions.turnOver(session, since, how, Date.now())); else otherwise?.(); })
      .catch((error: unknown) => console.warn("Could not check whether an agent turn is over", error));
  };
  // Sessions that were working or waiting when the pet last ran: shown again only if their transcripts do not say the turn ended meanwhile.
  for (const { session, since } of sessions.checks()) check(session, since, () => send(sessions.activity(session)));
  const stopListening = agentPlatform.onReport((hook) => send(sessions.report(hook, Date.now())));
  const timer = setInterval(() => {
    for (const update of sessions.expire(Date.now())) send(update);
    for (const { session, since } of sessions.checks()) {
      check(session, since);
      agentPlatform.title(session)
        .then((name) => { if (name && sessions.rename(session, name)) keep(); })
        .catch((error: unknown) => console.warn("Could not read an agent session's title", error));
    }
    keep();
  }, CHECK_EVERY_MS);
  return () => { stopListening(); clearInterval(timer); };
}

/** The user asked to go to a session from the pet's line about it: brings its terminal forward. Other activities are left alone. */
export function revealClaude(activityId: string): void {
  if (!activityId.startsWith(CLAUDE_ACTIVITY_PREFIX)) return;
  agentPlatform.reveal(activityId.slice(CLAUDE_ACTIVITY_PREFIX.length))
    .catch((error: unknown) => console.warn("Could not bring a Claude Code terminal forward", error));
}
