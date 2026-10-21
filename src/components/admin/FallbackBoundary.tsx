"use client";

import { Component, type ReactNode } from "react";

/**
 * Renders `fallback` when a child throws while rendering, for example when the
 * lazily loaded three.js chunk fails to download after a deploy or WebGL breaks.
 * Without it the whole admin page falls into the global error screen.
 */
export class FallbackBoundary extends Component<{ fallback: ReactNode; children: ReactNode; onError?: (error: unknown) => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[FallbackBoundary]", error);
    this.props.onError?.(error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
