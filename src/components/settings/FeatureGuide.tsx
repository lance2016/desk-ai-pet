import { FEATURE_GUIDE } from "../../guide/featureGuide";
import { FeatureTile } from "./FeatureTile";
import { isSection, sectionLabel, type SettingsSection } from "./sections";
import { Icon } from "../../ui/icons";

/** A way to start a feature that is a key combination, set like a key cap. */
const isKeys = (how: string) => /[⌘⌃⌥⇧]/.test(how);

/** "功能一览": everything the pet can do and how to start it, from featureGuide.json. */
export function FeatureGuide({ onOpen }: { onOpen: (section: SettingsSection) => void }) {
  return <div className="settings-section guide">
    {FEATURE_GUIDE.map((group) => <section key={group.title} aria-label={group.title}>
      <h2 className="settings-group-title">{group.title}</h2>
      <ul className="settings-group guide-list">
        {group.features.map((feature) => {
          const section = feature.section && isSection(feature.section) ? feature.section : null;
          return <li key={feature.title} className="guide-feature">
            <FeatureTile icon={feature.icon} color={feature.color} />
            <div className="guide-feature__body">
              <strong>{feature.title}</strong>
              <p>{feature.detail}</p>
              {feature.how && <ul className="guide-feature__how" aria-label="怎么用">
                {feature.how.map((how) => <li key={how} className={isKeys(how) ? "is-keys" : undefined}>{how}</li>)}
              </ul>}
            </div>
            {section && <button type="button" className="guide-feature__open" onClick={() => onOpen(section)} title={`打开「${sectionLabel(section)}」设置`}>
              {sectionLabel(section)}
              <Icon name="chevron_right" />
            </button>}
          </li>;
        })}
      </ul>
    </section>)}
  </div>;
}
