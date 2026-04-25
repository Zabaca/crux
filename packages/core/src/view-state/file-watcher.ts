import chokidar from "chokidar";

export type ViewWatcherHandle = {
  stop: () => Promise<void>;
};

/**
 * Watch a view-state file for changes and invoke the callback (debounced 200ms).
 *
 * Uses chokidar's `awaitWriteFinish` to avoid catching partial writes. The
 * callback fires on both initial existence (if file is present when we start)
 * and on subsequent writes.
 */
export function watchViewStateFile(
  path: string,
  onChange: () => void,
  options: { debounceMs?: number } = {},
): ViewWatcherHandle {
  const debounceMs = options.debounceMs ?? 200;
  const watcher = chokidar.watch(path, {
    awaitWriteFinish: {
      stabilityThreshold: 50,
      pollInterval: 10,
    },
    ignoreInitial: true,
  });

  let timer: NodeJS.Timeout | null = null;
  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try {
        onChange();
      } catch {
        // swallow — watcher callbacks should not crash the watcher
      }
    }, debounceMs);
  };

  watcher.on("add", fire);
  watcher.on("change", fire);

  return {
    stop: async () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await watcher.close();
    },
  };
}
