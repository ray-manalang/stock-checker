// Request-scoped context (user id for LLM usage attribution).

import { AsyncLocalStorage } from "async_hooks";

const store = new AsyncLocalStorage();

export function runWithUser(userId, fn) {
  return store.run({ userId: userId ?? null }, fn);
}

export function getRequestUserId() {
  return store.getStore()?.userId ?? null;
}
