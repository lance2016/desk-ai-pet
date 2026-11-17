import { parsePackManifest } from "../actions/StandardActions";
import type { PetManifest } from "./Manifest";

export interface AssetPack {
  manifest: PetManifest;
  /** Turns a manifest-relative file path into a loadable URL. */
  resolve(file: string): string;
}

const MANIFEST_FILE = "manifest.json";

/** Loads a local asset pack from a directory URL such as `/pets/girl-default`. */
export async function loadAssetPack(packUrl: string): Promise<AssetPack> {
  const base = packUrl.endsWith("/") ? packUrl : `${packUrl}/`;
  const response = await fetch(`${base}${MANIFEST_FILE}`);
  if (!response.ok) {
    throw new Error(`Failed to load pet manifest from ${base} (HTTP ${response.status})`);
  }
  const manifest = parsePackManifest(await response.json());
  return { manifest, resolve: (file) => `${base}${file}` };
}
