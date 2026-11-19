// How often a medication is taken, for the add form and "Change schedule": at set times (every day, on some weekdays,
// or every other day), every few hours from a chosen next dose, or only as needed (no reminders).
import { Text, TextInput, View } from "react-native";
import { Tap } from "./Tap";
import { TimeField, dayString } from "./DateTimeField";
import { TimesField } from "./TimesField";
import { colors, radius, themed, ui } from "./theme";
import type { Strings } from "./i18n";
import { splitTimes } from "./times";
import { nextClock, weekdayName, type Rule } from "./medSchedule";

export type Draft = {
  mode: "daily" | "interval" | "asNeeded";
  times: string; // "08:00, 20:00"
  days: "every" | "some" | "other";
  weekdays: number[];
  hours: string;
  first: string; // the next interval dose, "HH:MM"
};

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (at: number) => `${pad(new Date(at).getHours())}:${pad(new Date(at).getMinutes())}`;

export function newDraft(): Draft {
  return { mode: "daily", times: "08:00", days: "every", weekdays: [1, 2, 3, 4, 5], hours: "8", first: clock(Date.now() + 8 * 3_600_000) };
}

// The editor's state for a saved schedule; `nextAt` gives an interval its next dose.
export function draftFrom(rule: Rule, nextAt: number | null): Draft {
  const d = newDraft();
  if (rule.kind === "asNeeded") return { ...d, mode: "asNeeded" };
  if (rule.kind === "interval") return { ...d, mode: "interval", hours: String(rule.everyHours), first: nextAt ? clock(nextAt) : d.first };
  return { ...d, times: rule.times.join(", "), days: rule.weekdays ? "some" : rule.everyOtherDay ? "other" : "every", weekdays: rule.weekdays ?? d.weekdays };
}

// What the server takes (convex/lib/reminders.ts checks it). Every other day counts from today.
export function scheduleFrom(d: Draft) {
  if (d.mode === "asNeeded") return { kind: "asNeeded" as const };
  if (d.mode === "interval") return { kind: "interval" as const, everyHours: Number(d.hours), firstAt: nextClock(d.first) };
  return {
    kind: "daily" as const,
    times: splitTimes(d.times),
    ...(d.days === "some" && { weekdays: d.weekdays }),
    ...(d.days === "other" && { everyOtherDay: dayString(new Date()) }),
  };
}

function Chips<T extends string>({ options, value, onChange }: { options: { key: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.chips}>
      {options.map((o) => (
        <Tap key={o.key} style={[styles.chip, value === o.key && styles.chipOn]} onPress={() => onChange(o.key)} accessibilityRole="radio" accessibilityState={{ selected: value === o.key }}>
          <Text style={[styles.chipText, value === o.key && styles.chipTextOn]}>{o.label}</Text>
        </Tap>
      ))}
    </View>
  );
}

export function ScheduleEditor({ value: d, onChange, s }: { value: Draft; onChange: (d: Draft) => void; s: Strings }) {
  const set = (patch: Partial<Draft>) => onChange({ ...d, ...patch });
  return (
    <View style={styles.wrap}>
      <Chips
        options={[
          { key: "daily", label: s.atSetTimes },
          { key: "interval", label: s.everyFewHours },
          { key: "asNeeded", label: s.medAsNeeded },
        ]}
        value={d.mode}
        onChange={(mode) => set({ mode })}
      />
      {d.mode === "daily" && (
        <>
          <TimesField value={d.times} onChange={(times) => set({ times })} s={s} />
          <Text style={styles.label}>{s.medWhichDays}</Text>
          <Chips
            options={[
              { key: "every", label: s.medEveryDay },
              { key: "some", label: s.medSomeDays },
              { key: "other", label: s.medOtherDay },
            ]}
            value={d.days}
            onChange={(days) => set({ days })}
          />
          {d.days === "some" && (
            <View style={styles.chips}>
              {[0, 1, 2, 3, 4, 5, 6].map((n) => {
                const on = d.weekdays.includes(n);
                return (
                  <Tap
                    key={n}
                    style={[styles.day, on && styles.chipOn]}
                    onPress={() => set({ weekdays: on ? d.weekdays.filter((x) => x !== n) : [...d.weekdays, n].sort() })}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{weekdayName(n, s)}</Text>
                  </Tap>
                );
              })}
            </View>
          )}
        </>
      )}
      {d.mode === "interval" && (
        <>
          <View style={styles.inline}>
            <Text style={styles.label}>{s.every}</Text>
            <TextInput style={styles.short} value={d.hours} onChangeText={(hours) => set({ hours })} keyboardType="numeric" accessibilityLabel={s.everyFewHours} />
            <Text style={styles.label}>{s.medHours}</Text>
          </View>
          <View style={styles.inline}>
            <Text style={styles.label}>{s.medFirstDose}</Text>
            <TimeField value={d.first} onChange={(first) => set({ first })} label={s.medFirstDose} s={s} />
          </View>
        </>
      )}
      {d.mode === "asNeeded" && <Text style={styles.hint}>{s.medAsNeededHint}</Text>}
    </View>
  );
}

const styles = themed(() => ({
  wrap: { gap: 8 },
  chips: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  chip: { ...ui.chip },
  day: { ...ui.chip, minWidth: 52, alignItems: "center" },
  chipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 13 },
  chipTextOn: { color: colors.primary, fontWeight: "600" },
  label: { color: colors.text, fontSize: 14 },
  hint: { color: colors.muted, fontSize: 13 },
  inline: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  short: { width: 64, textAlign: "center", color: colors.text, borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15 },
}));
