import guide from "./featureGuide.json";
import type { FeatureColor, FeatureIcon } from "./featureIcons";

/**
 * One thing the app can do, as "设置 → 功能一览" shows it. Keep it in step with the app:
 * a feature that is added, renamed or removed changes featureGuide.json too.
 */
export interface GuideFeature {
  icon: FeatureIcon;
  color: FeatureColor;
  title: string;
  /** What it does, in one sentence. */
  detail: string;
  /** Ways to start it, each shown as a chip: "右键宠物 › 今日回顾", "⇧⌘ Space". */
  how?: string[];
  /** The settings page that configures it. Must be one of SECTIONS. */
  section?: string;
}

export interface GuideGroup {
  title: string;
  features: GuideFeature[];
}

export const FEATURE_GUIDE = guide as GuideGroup[];
