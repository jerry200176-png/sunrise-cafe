import type { ReminderTriggerSource } from "@/lib/job-runs";

const TAIPEI_TIME_ZONE = "Asia/Taipei";

type ScheduledTrigger = Exclude<ReminderTriggerSource, "manual">;

type ReminderWindow = {
  label: string;
  startMinutes: number;
  endMinutes: number;
};

const WINDOWS: Record<ScheduledTrigger, ReminderWindow> = {
  // Vercel Hobby may deliver the 12:00 UTC cron at any point in this hour.
  cron: { label: "Vercel cron", startMinutes: 20 * 60, endMinutes: 21 * 60 },
  // GitHub's backup is scheduled for 21:10 Taipei. Never allow it to cross midnight.
  github: { label: "GitHub backup", startMinutes: 21 * 60, endMinutes: 24 * 60 },
};

function taipeiClock(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TAIPEI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});

  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    minutes: hour * 60 + minute,
  };
}

/**
 * Scheduled reminder GETs must stay in their own Taipei delivery window.
 * This prevents a delayed GitHub backup from crossing midnight and querying
 * the next calendar day's reservations before sending an empty-day message.
 * Manual POSTs are intentionally not constrained by this policy.
 */
export function reminderScheduleWindow(
  trigger: ReminderTriggerSource,
  now = new Date()
) {
  const clock = taipeiClock(now);
  if (trigger === "manual") {
    return {
      allowed: true,
      date: clock.date,
      localTime: clock.time,
      window: "manual",
    } as const;
  }

  const window = WINDOWS[trigger];
  const allowed = clock.minutes >= window.startMinutes && clock.minutes < window.endMinutes;

  return {
    allowed,
    date: clock.date,
    localTime: clock.time,
    window: window.label,
  } as const;
}
