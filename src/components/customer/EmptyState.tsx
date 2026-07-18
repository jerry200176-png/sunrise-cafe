import type { LucideIcon } from "lucide-react";

type Props = {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /**
   * Opt-in live region for dynamic empty results (e.g. after a search).
   * Leave false for static hints so mount does not announce unnecessarily.
   */
  announceStatus?: boolean;
};

/** Guest empty / hint panel: what happened + optional next action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  announceStatus = false,
}: Props) {
  return (
    <div
      className="rounded-2xl border border-ink/10 bg-white/60 px-6 py-10 text-center backdrop-blur-sm"
      role={announceStatus ? "status" : undefined}
    >
      <div
        className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-paper-deep text-caramel"
        aria-hidden="true"
      >
        <Icon className="h-6 w-6" strokeWidth={1.5} />
      </div>
      <p className="mt-4 font-serif text-lg text-ink">{title}</p>
      {description && (
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
