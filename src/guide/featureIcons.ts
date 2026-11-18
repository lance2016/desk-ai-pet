/** Icons and colours a feature can use in the guide and the "新功能" sheet. FeatureTile draws them. */
export const FEATURE_ICONS = [
  "chat", "hand", "move", "sparkle", "sleep", "bell", "note", "search", "list", "timer", "text", "mail", "mic",
  "sun", "heart", "moon", "user", "paw", "archive",
] as const;
export const FEATURE_COLORS = ["orange", "yellow", "green", "teal", "blue", "indigo", "purple", "pink", "red", "gray"] as const;

export type FeatureIcon = (typeof FEATURE_ICONS)[number];
export type FeatureColor = (typeof FEATURE_COLORS)[number];
