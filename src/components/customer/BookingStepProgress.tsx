"use client";

import { useLocale } from "@/lib/i18n/LocaleContext";

export type BookingStep = "branch" | "date" | "room" | "slot" | "form";

const STEPS: BookingStep[] = ["branch", "date", "room", "slot", "form"];

type Props = {
  current: BookingStep;
  /** Hide branch step when single-branch auto-skip */
  hideBranch?: boolean;
  /**
   * Navigate back to a completed step only.
   * Incomplete / current steps are never interactive.
   */
  onSelectCompletedStep?: (step: BookingStep) => void;
};

/**
 * When branch is hidden (single-store) but caller still reports current=branch
 * (draft restore / before auto-skip), treat the first visible step as current.
 * Never invent completed steps from a hidden current.
 */
export function resolveVisibleCurrent(
  current: BookingStep,
  visible: BookingStep[]
): BookingStep {
  if (visible.includes(current)) return current;
  return visible[0] ?? current;
}

export function BookingStepProgress({
  current,
  hideBranch,
  onSelectCompletedStep,
}: Props) {
  const { t } = useLocale();
  const visible = hideBranch ? STEPS.filter((s) => s !== "branch") : STEPS;
  const resolvedCurrent = resolveVisibleCurrent(current, visible);
  const currentIndex = visible.indexOf(resolvedCurrent);

  return (
    <nav aria-label={t("book.stepProgress")} className="mb-6">
      <ol className="flex items-center gap-1">
        {visible.map((step, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          const label = t(`book.steps.${step}` as "book.steps.branch");
          const circleClass = `flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition ${
            active
              ? "bg-caramel text-white shadow-[0_4px_12px_-4px_rgba(157,101,25,0.5)]"
              : done
                ? "bg-caramel/20 text-caramel-deep"
                : "bg-paper-deep text-ink-faint"
          }`;

          return (
            <li key={step} className="flex flex-1 flex-col items-center gap-1">
              {done && onSelectCompletedStep ? (
                <button
                  type="button"
                  onClick={() => onSelectCompletedStep(step)}
                  className={`${circleClass} focus:outline-none focus-visible:ring-2 focus-visible:ring-caramel`}
                  aria-label={label}
                >
                  <span aria-hidden="true">{i + 1}</span>
                </button>
              ) : (
                <div
                  className={circleClass}
                  aria-current={active ? "step" : undefined}
                  aria-label={label}
                  role="img"
                >
                  <span aria-hidden="true">{i + 1}</span>
                </div>
              )}
              <span
                className={`hidden text-[0.65rem] sm:block ${
                  active ? "font-medium text-ink" : "text-ink-faint"
                }`}
                aria-hidden="true"
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
