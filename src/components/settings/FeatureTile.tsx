import type { FeatureColor, FeatureIcon } from "../../guide/featureIcons";
import { Icon } from "../../ui/icons";

/** A feature's icon on a system-coloured rounded square, like the icons in macOS System Settings. */
export function FeatureTile({ icon, color }: { icon: FeatureIcon; color: FeatureColor }) {
  return <span className={`feature-tile feature-tile--${color}`} aria-hidden="true"><Icon name={icon} /></span>;
}
