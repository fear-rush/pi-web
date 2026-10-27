// The unread markers the session tree draws as a dot, kept in localStorage so a
// refresh before the user opens the session does not lose them.
//
// One tab's read or mark-unread is only visible to another tab through its
// localStorage write, and the browser fires `storage` only in the tabs that did
// not write. Adopting the written set is what keeps two open tabs agreeing; this
// module owns both directions so the component only wires the listener.

/** The Set for a polled id list: `previous` itself while it holds the same ids. */
export function sameIdsOr(previous: Set<string>, ids: readonly string[]): Set<string> {
  const next = new Set(ids);
  if (next.size !== previous.size) return next;
  for (const id of next) {
    if (!previous.has(id)) return next;
  }
  return previous;
}

const UNREAD_SESSIONS_STORAGE_KEY = "pi-web:unread-session-ids";

/** The ids in a stored value. A malformed one (an interrupted write, another client) means none. */
export function parseUnreadSessionIds(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    // fall through to an empty set
  }
  return new Set();
}

/** This browser tab's markers, empty where storage is unavailable. */
export function loadUnreadSessionIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return parseUnreadSessionIds(window.localStorage.getItem(UNREAD_SESSIONS_STORAGE_KEY));
  } catch {
    return new Set();
  }
}

/** Persist the markers; an empty set removes the key instead of writing `[]`. */
export function saveUnreadSessionIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (ids.size === 0) window.localStorage.removeItem(UNREAD_SESSIONS_STORAGE_KEY);
    else window.localStorage.setItem(UNREAD_SESSIONS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage can be full or blocked in privacy mode; the dots are best-effort.
  }
}

/**
 * The markers another tab wrote, or undefined for an event about anything else
 * (a cleared storage has a null key and concerns every key we own).
 */
export function storedUnreadSessionIds(event: Pick<StorageEvent, "key" | "newValue">): Set<string> | undefined {
  if (event.key !== null && event.key !== UNREAD_SESSIONS_STORAGE_KEY) return undefined;
  return parseUnreadSessionIds(event.newValue);
}
