// Date and time fields in the browser: the browser's own <input type="date"> and <input type="time">, which bring its
// calendar and clock pickers and follow the page's light or dark scheme. Same props and values as ./DateTimeField.tsx.
import { createElement } from "react";
import { colors, radius } from "./theme";
import type { Strings } from "./i18n";

const pad = (n: number) => String(n).padStart(2, "0");
export const dayString = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const timeString = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

type Props = { value: string; onChange: (v: string) => void; label: string; s: Strings };

const input = (type: "date" | "time", { value, onChange, label }: Props) =>
  createElement("input", {
    type,
    value,
    "aria-label": label,
    // An emptied field keeps the last value, so a half-cleared date never reaches the server.
    onChange: (e: { target: { value: string } }) => e.target.value && onChange(e.target.value),
    style: {
      minHeight: 44,
      boxSizing: "border-box",
      padding: "0 12px",
      fontSize: 16,
      fontFamily: "inherit",
      color: colors.text,
      backgroundColor: colors.surface,
      border: `1px solid ${colors.inputBorder}`,
      borderRadius: radius.md,
    },
  });

export const DateField = (p: Props) => input("date", p);
export const TimeField = (p: Props) => input("time", p);
