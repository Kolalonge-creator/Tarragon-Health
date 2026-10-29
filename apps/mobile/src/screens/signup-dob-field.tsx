import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { colors, radius } from "@/ui/theme";

const MIN_DATE = new Date(1900, 0, 1);

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromIso(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/**
 * Date of birth through the phone's own date picker (iOS wheel, Android
 * dialog) instead of typing YYYY-MM-DD. `value`/`onChange` use the same ISO
 * string the sign-up form validates with checkAdultDateOfBirth; it stays ""
 * until a date is chosen. The wheel opens 30 years back so a patient does not scroll from today;
 * nothing is recorded until they actually choose a date (Done alone never invents one).
 */
export function DobField({ value, onChange, label }: { value: string; onChange: (iso: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const chosen = fromIso(value);
  const today = new Date();
  const start = new Date(today.getFullYear() - 30, today.getMonth(), today.getDate());

  function handle(event: DateTimePickerEvent, date?: Date) {
    // Android closes its dialog itself; iOS keeps the wheel open until the user taps Done.
    if (Platform.OS === "android") setOpen(false);
    if (event.type === "set" && date) onChange(toIso(date));
  }

  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted }}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={chosen ? `${label}: ${value}. Opens the date picker.` : `${label}. Opens the date picker.`}
        onPress={() => setOpen((v) => !v)}
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.control,
          padding: 14,
          backgroundColor: colors.card,
        }}
      >
        <Text style={{ fontSize: 16, color: chosen ? colors.ink : colors.faint }}>
          {chosen
            ? chosen.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
            : "Select date of birth"}
        </Text>
      </Pressable>
      {open ? (
        <View>
          <DateTimePicker
            value={chosen ?? start}
            mode="date"
            display={Platform.OS === "ios" ? "spinner" : "default"}
            minimumDate={MIN_DATE}
            maximumDate={today}
            onChange={handle}
          />
          {Platform.OS === "ios" ? (
            <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={{ alignSelf: "flex-end", padding: 8 }}>
              <Text style={{ fontSize: 16, fontWeight: "600", color: colors.brand }}>Done</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
