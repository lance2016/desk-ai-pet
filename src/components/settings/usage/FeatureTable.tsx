import { changeText, type UsageLine, type UsageSummary } from "../../../usage/usageSummary";
import { Icon } from "../../../ui/icons";

/** The day-by-day shape of one feature, scaled to its own busiest day. */
function Sparkline({ daily }: { daily: readonly number[] }) {
  const most = Math.max(1, ...daily);
  const width = Math.max(1, daily.length - 1);
  const points = daily.map((count, index) => `${index},${1 - count / most}`).join(" ");
  return <svg className="usage-spark" viewBox={`0 -0.1 ${width} 1.2`} preserveAspectRatio="none" aria-hidden="true">
    <polyline points={points} vectorEffect="non-scaling-stroke" />
  </svg>;
}

interface Props { summary: UsageSummary; focus: string | null; onFocus: (id: string | null) => void }

/** The features used in the range by group, most used first in each; a click charts one alone. The rest go on one line: what to cut. */
export function FeatureTable({ summary, focus, onFocus }: Props) {
  const groups = summary.groups.map((group) => ({ ...group, used: [...group.lines].filter((line) => line.count > 0).sort((a, b) => b.count - a.count) }));
  const unused = summary.groups.flatMap((group) => group.lines).filter((line) => line.count === 0);
  const row = (line: UsageLine) => {
    const picked = focus === line.id;
    return <li key={line.id}>
      <button type="button" className={`usage-feature${picked ? " is-picked" : ""}`} aria-pressed={picked} onClick={() => onFocus(picked ? null : line.id)}>
        <span className="usage-feature__icon"><Icon name={line.icon} /></span>
        <span className="usage-feature__label">{line.label}</span>
        <Sparkline daily={line.daily} />
        <span className="usage-feature__count">{line.count}</span>
        <span className="usage-feature__change">{summary.comparable ? changeText(line.count, line.previous) : "—"}</span>
      </button>
    </li>;
  };
  return <div className="settings-card usage-features">
    {groups.filter((group) => group.used.length > 0).map((group) => <section key={group.title}>
      <h3 className="usage-features__group">{group.title}</h3>
      <ul>{group.used.map(row)}</ul>
    </section>)}
    {unused.length > 0 && <p className="usage-features__unused">这段时间没用过：{unused.map((line) => line.label).join("、")}</p>}
  </div>;
}
