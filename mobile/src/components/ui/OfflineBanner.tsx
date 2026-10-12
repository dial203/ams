import { useSyncExternalStore } from "react";
import { onlineManager } from "@tanstack/react-query";
import { Banner } from "./Banner";

export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  );
}

/** Shown while the device is offline; screens keep showing cached data. */
export function OfflineBanner() {
  const online = useIsOnline();
  if (online) return null;
  return <Banner tone="warning" message="You're offline. Showing saved data; changes need a connection." />;
}
