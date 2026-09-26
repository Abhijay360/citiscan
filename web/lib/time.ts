// New York time helpers for the "what if" demo mode (runs in the browser, whatever its timezone).

const TZ = "America/New_York";

/** YYYY-MM-DD and weekday of an instant, in New York. */
function nycDate(t: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
    })
      .formatToParts(t)
      .map((x) => [x.type, x.value]),
  );
  return { ymd: `${p.year}-${p.month}-${p.day}`, weekday: p.weekday as string };
}

/** New York's UTC offset at an instant, as "-04:00" or "-05:00". */
function nycOffset(t: Date) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "shortOffset" })
    .formatToParts(t)
    .find((x) => x.type === "timeZoneName")!.value; // e.g. "GMT-4"
  const hours = Number(name.replace("GMT", "") || 0);
  return `${hours < 0 ? "-" : "+"}${String(Math.abs(hours)).padStart(2, "0")}:00`;
}

export type DayType = "weekday" | "saturday" | "sunday";

/** The next time it's `hhmm` on a `dayType` day in New York (today counts), e.g. next weekday at 08:45. */
export function nextNycTime(dayType: DayType, hhmm: string, from = new Date()): Date {
  for (let k = 0; k < 8; k++) {
    const day = new Date(from.getTime() + k * 86_400_000);
    const { ymd, weekday } = nycDate(day);
    const type: DayType = weekday === "Sat" ? "saturday" : weekday === "Sun" ? "sunday" : "weekday";
    if (type !== dayType) continue;
    const guess = new Date(`${ymd}T${hhmm}:00-04:00`);
    return new Date(`${ymd}T${hhmm}:00${nycOffset(guess)}`);
  }
  throw new Error("unreachable: every day type occurs within a week");
}
