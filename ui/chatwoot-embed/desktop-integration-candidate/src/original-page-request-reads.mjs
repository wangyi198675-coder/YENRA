/** Thin scheduling of the ORIGINAL accountStoreOp; no cross-request cache. */
export function createOriginalPageRequestReads({ getCurrent, listAccounts, readAccountPair }) {
  let pendingInitial;
  const initial = () => {
    if (pendingInitial) return pendingInitial;
    const request = Promise.resolve().then(listAccounts);
    pendingInitial = request;
    void request.finally(() => {
      if (pendingInitial === request) pendingInitial = undefined;
    }).catch(() => {});
    return request;
  };
  const list = () => {
    const current = getCurrent();
    // The post-operation check and ALL Sender calls remain fresh original ops.
    if (!current) return listAccounts();
    // Avatars retain every later SDK scope check. Only their first scope can
    // join the current initial read; a post-download check cannot join it.
    if (current.coalesceFirstListOnly) {
      if (current.initialListStarted) return listAccounts();
      current.initialListStarted = true;
      return initial();
    }
    return current.list ??= initial();
  };
  const read = (name, pageId) => {
    const current = getCurrent();
    if (!current) return readAccountPair(name, pageId);
    const key = JSON.stringify([name, pageId]);
    const reads = current.reads ??= new Map();
    if (!reads.has(key)) {
      const request = Promise.resolve().then(() => readAccountPair(name, pageId));
      reads.set(key, request);
      // A speculative read can reject before the SDK awaits it. Observe it,
      // but preserve the rejection in the exact-pair promise for that SDK call.
      void request.catch(() => {});
    }
    return reads.get(key);
  };
  const prefetch = (name, pageId) => {
    // Only inside a read request; never create a process/global token cache.
    if (getCurrent()) void read(name, pageId).catch(() => {});
  };
  return { list, read, prefetch };
}
