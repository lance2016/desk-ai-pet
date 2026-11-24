import React, { Suspense, lazy, useSyncExternalStore } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ChatPage } from "./components/chat/ChatPage";
import { SettingsPage } from "./components/settings/SettingsPage";
import { LinksPanel } from "./components/links/LinksPanel";
import { NotesPanel } from "./components/notes/NotesPanel";
import { CodingPanel } from "./components/coding/CodingPanel";
import { TodayPanel } from "./components/today/TodayPanel";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { TranslationPanel } from "./components/translation/TranslationPanel";
import { SelectionFloat } from "./components/translation/SelectionFloat";
import { dropTimelessAgenda, timelessAgendaTexts } from "./agenda/AgendaStore";
import { addNote, updateNotes } from "./notes/NoteStore";
import { forwardToLog } from "./platform/diagnostics";
import { loadActiveCharacter, migrateLegacyCharacterData, subscribeActiveCharacter } from "./preferences/CharacterPreferences";
import "./ui/tokens.css";
import "./ui/controls.css";

// Only the dubbing window loads its code; the pet and the other windows never do.
const DubbingPage = lazy(() => import("./components/dubbing/DubbingPage").then((module) => ({ default: module.DubbingPage })));

const view = new URLSearchParams(window.location.search).get("window");
if (view) document.documentElement.dataset.window = view;
forwardToLog(view ?? "main");

/** Every window follows the active character. The pet and chat restart for a new one. */
function Root() {
  const packId = useSyncExternalStore(subscribeActiveCharacter, () => loadActiveCharacter());
  if (view === "settings") return <SettingsPage packId={packId} />;
  if (view === "today") return <TodayPanel />;
  if (view === "links") return <LinksPanel />;
  if (view === "notes") return <NotesPanel />;
  if (view === "coding") return <CodingPanel />;
  if (view === "translation") return <TranslationPanel />;
  if (view === "selection-float") return <SelectionFloat />;
  if (view === "dubbing") return <Suspense fallback={null}><DubbingPage /></Suspense>;
  if (view === "chat") return <ChatPage key={packId} packId={packId} />;
  return <App key={packId} packId={packId} />;
}

try {
  migrateLegacyCharacterData();
} catch (error) {
  console.error("Failed to move saved data to the default character", error);
}

// Every reminder now has a time; plain to-dos saved before that are kept as memos.
// Saving the same text twice only brings the note forward, so a second window running this is harmless.
try {
  const texts = timelessAgendaTexts();
  if (texts.length > 0) {
    const now = Date.now();
    updateNotes((notes) => texts.reduce((next, text, index) => addNote(next, { id: `todo-${now}-${index}`, text }, now), notes));
  }
  dropTimelessAgenda();
} catch (error) {
  console.error("Failed to move plain to-dos to memos", error);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary claimMouse={view === null}>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>,
);
