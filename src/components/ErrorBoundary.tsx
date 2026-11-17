import { Component, createRef, type ErrorInfo, type ReactNode } from "react";
import { maskToElement } from "../platform/hitMask";
import "./ErrorBoundary.css";

interface Props {
  children: ReactNode;
  /** The pet window is transparent: the message has to claim the mouse to be clickable. */
  claimMouse?: boolean;
}

/** Catches a crash in any window and offers to reload, instead of leaving it blank (or the pet gone). */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };
  private readonly box = createRef<HTMLDivElement>();

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("A window crashed", error, info.componentStack);
  }

  componentDidUpdate(): void {
    if (this.state.failed && this.props.claimMouse) maskToElement(this.box.current);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div ref={this.box} className="crash-box" role="alert">
        <strong>出了点问题</strong>
        <p>这个窗口没能正常显示。重新加载一下通常就好了。</p>
        <button type="button" onClick={() => window.location.reload()}>重新加载</button>
      </div>
    );
  }
}
