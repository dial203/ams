import { useEffect } from "react";

/** Sets `document.title` to "<title> · AMS" while mounted. */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} · AMS`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
