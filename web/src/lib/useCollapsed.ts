import { useState } from "react";

/** Collapse state for a card, persisted under `key` in localStorage. */
export function useCollapsed(key: string): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(key) === "1");
  const toggle = () =>
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(key, next ? "1" : "0");
      return next;
    });
  return [collapsed, toggle];
}
