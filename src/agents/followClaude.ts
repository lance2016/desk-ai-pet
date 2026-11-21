import { activityUpdateSchema } from "../activity/Activity";
import { agentPlatform } from "../platform/agents";
import type { ActivityUpdate } from "../types";
import { recordWork } from "../worklog/store";
import { ClaudeSessions } from "./ClaudeSessions";

/** How often sessions still going are looked at for an interruption or a long silence. */
const CHECK_EVERY_MS = 5000;
const NO_FOLDER = "Claude";

/**
 * Follows Claude Code through its hooks and hands each change to `report` as
 * an activity. A turn long enough to be told about goes into the work log.
 * Returns a function that stops following.
 */
export function followClaude(report: (update: ActivityUpdate) => void): () => void {
  const sessions = new ClaudeSessions();
  const send = (update: ActivityUpdate | null) => {
    if (update === null) return;
    // The label and the text come from a folder name outside the pet.
    const parsed = activityUpdateSchema.safeParse(update);
    if (parsed.success) report(parsed.data);
    else console.warn("Dropping an agent activity that does not fit", parsed.error);
  };
  const stopListening = agentPlatform.onReport((hook) => {
    const update = sessions.report(hook, Date.now());
    send(update);
    if (update?.state === "done") void recordWork([{ kind: "agent_turn_done", text: hook.project || NO_FOLDER, before: null, itemId: null }], "agent");
  });
  const timer = setInterval(() => {
    sessions.expire(Date.now()).forEach(send);
    for (const { session, since } of sessions.checks()) {
      agentPlatform.interrupted(session, since)
        .then((stopped) => { if (stopped) send(sessions.interrupted(session, since)); })
        .catch((error: unknown) => console.warn("Could not check an agent session for an interruption", error));
    }
  }, CHECK_EVERY_MS);
  return () => { stopListening(); clearInterval(timer); };
}
