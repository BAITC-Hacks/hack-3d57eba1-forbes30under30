import type { BestSet } from "./engine/optimize";

// The cooperative search continues and writes its cache after this wait ends.
// Handle its rejection here too, so a background file error is never unhandled.
export async function waitForBestScore(
  search: Promise<BestSet[]>,
  timeoutMs = 5_000,
): Promise<number | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      search.then((sets) => sets[0]?.score).catch(() => undefined),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
