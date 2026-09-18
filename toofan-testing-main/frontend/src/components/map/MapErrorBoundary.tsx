import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  title?: string;
  height?: string;
}

interface State {
  hasError: boolean;
}

/**
 * MapErrorBoundary — keeps the surrounding UI alive when an embedded
 * interactive map fails to initialise (e.g. WebGL is unavailable in
 * headless / VM / remote-desktop environments). Renders a graceful
 * fallback panel instead of unmounting the whole app tree.
 */
export class MapErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    // Keep the error off the console noise but available for debugging.
    console.warn("[TOOFAN] Map failed to render:", error?.message);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="map-error-fallback"
          style={this.props.height ? { height: this.props.height } : undefined}
        >
          <div className="map-error-mark" aria-hidden="true">⊗</div>
          <div className="map-error-title">{this.props.title ?? "MAP UNAVAILABLE"}</div>
          <p className="small muted">
            The interactive map could not be initialised (WebGL is required but is not
            available in this environment). The rest of this page remains functional.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
