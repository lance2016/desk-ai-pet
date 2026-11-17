import { isCustomCharacter } from "../assets/PackCatalog";
import { loadAppearance, type ActionAppearance } from "./AppearanceStore";

/** A stored picture is a strip of frames; pictures of the character show the first one. */
async function firstFrame(appearance: ActionAppearance): Promise<string> {
  if (appearance.frames === 1) return appearance.image;
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("Could not read the stored picture"));
    element.src = appearance.image;
  });
  const width = image.naturalWidth / appearance.frames;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not cut the first frame");
  context.drawImage(image, 0, 0, width, image.naturalHeight, 0, 0, width, image.naturalHeight);
  return canvas.toDataURL("image/png");
}

/**
 * The pictures a character really wears, by action id: the one the user put in place, else the pack's own.
 * A custom character only borrows its pack's pictures, so an action it has not replaced is left out
 * and callers show a placeholder instead of another character.
 */
export async function characterPictures(packId: string, packImages: Readonly<Record<string, string>>, ids: readonly string[]): Promise<Record<string, string>> {
  const borrowed = isCustomCharacter(packId);
  const entries = await Promise.all([...new Set(ids)].map(async (id) => {
    try {
      const stored = typeof indexedDB === "undefined" ? null : await loadAppearance(packId, id);
      if (stored) return [id, await firstFrame(stored)] as const;
    } catch (error) {
      console.warn(`Could not read the picture of ${id}`, error);
    }
    return !borrowed && packImages[id] ? [id, packImages[id]] as const : null;
  }));
  return Object.fromEntries(entries.filter((entry) => entry !== null));
}
