import { useEffect, useRef } from "react";
import { mayTake, readDropped, type Dropped } from "../handover/dropped";

/**
 * Takes what is dragged onto the pet window. The window only gets the drag over the drawn parts of
 * the pet (see `click_through.rs`), so the whole document is the drop target. While `enabled` is
 * false, or the drag carries what the pet cannot read, the drag is refused and the cursor says so.
 */
export function usePetDrop(enabled: boolean, onDrop: (dropped: Dropped) => void): void {
  const handler = useRef(onDrop);
  handler.current = onDrop;
  useEffect(() => {
    const over = (event: DragEvent) => {
      if (!event.dataTransfer) return;
      // Always prevented: a drag the page leaves alone makes WebKit open the file in the pet window.
      // A drop it refuses is refused with "none", which also shows on the cursor.
      event.preventDefault();
      event.dataTransfer.dropEffect = enabled && mayTake(Array.from(event.dataTransfer.items)) ? "copy" : "none";
    };
    const drop = (event: DragEvent) => {
      const transfer = event.dataTransfer;
      if (!transfer) return;
      // Taken here, before a field under the cursor pastes it in.
      event.preventDefault();
      event.stopPropagation();
      if (!enabled) return;
      void readDropped({ files: Array.from(transfer.files), text: transfer.getData("text/plain") }).then((dropped) => handler.current(dropped));
    };
    document.addEventListener("dragover", over, true);
    document.addEventListener("drop", drop, true);
    return () => {
      document.removeEventListener("dragover", over, true);
      document.removeEventListener("drop", drop, true);
    };
  }, [enabled]);
}
