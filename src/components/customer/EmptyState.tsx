import type { LucideIcon } from "lucide-react";

type Props = {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
};

/** Guest empty / hint panel: what happened + optional next action. */
export function EmptyState({ icon: Icon, title, description, action }: Props) {
  return (
    <div
      className="rounded-2xl border border-ink/10 bg-white/60 px-6 py-10 text-center backdrop-blur-sm"
      role="status"
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
