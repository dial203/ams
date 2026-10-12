import { useMemo, type ComponentProps } from "react";
import { NativeSelect } from "@/components/ui/native-select";

function allTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    const list = intl.supportedValuesOf?.("timeZone");
    if (list && list.length > 0) return list.includes("UTC") ? list : ["UTC", ...list];
  } catch {
    /* older runtimes */
  }
  return ["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Tokyo", "Australia/Sydney"];
}

/** IANA time zone select. `emptyLabel` adds an empty option (e.g. "Organization default"). */
export function TimezoneSelect({
  value,
  onValueChange,
  emptyLabel,
  ...props
}: Omit<ComponentProps<typeof NativeSelect>, "value" | "onChange"> & {
  value: string | null | undefined;
  onValueChange(value: string | null): void;
  emptyLabel?: string;
}) {
  const zones = useMemo(allTimeZones, []);
  const current = value ?? "";
  return (
    <NativeSelect value={current} onChange={(e) => onValueChange(e.target.value === "" ? null : e.target.value)} {...props}>
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {current !== "" && !zones.includes(current) && <option value={current}>{current}</option>}
      {zones.map((z) => (
        <option key={z} value={z}>
          {z.replace(/_/g, " ")}
        </option>
      ))}
    </NativeSelect>
  );
}
