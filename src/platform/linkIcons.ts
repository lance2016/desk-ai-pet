import { invoke, isTauri } from "@tauri-apps/api/core";

interface IconPage {
  url: string;
  html: string;
}

export const linkIconPlatform = {
  async page(url: string): Promise<IconPage | null> {
    return isTauri() ? invoke<IconPage | null>("link_icon_page", { url }) : null;
  },
  async image(page: string, url: string): Promise<string | null> {
    return isTauri() ? invoke<string | null>("link_icon_image", { page, url }) : null;
  },
};
