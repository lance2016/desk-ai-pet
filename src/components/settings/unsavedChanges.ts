/**
 * Whether a page in the settings window holds changes that are not saved yet
 * (the action editor). The sidebar asks once before leaving such a page.
 */
let unsaved = false;

export function setUnsavedChanges(value: boolean): void {
  unsaved = value;
}

export function hasUnsavedChanges(): boolean {
  return unsaved;
}
