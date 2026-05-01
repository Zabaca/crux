import path from "node:path";
import chokidar from "chokidar";

export type ViewWatcherHandle = {
  stop: () => Promise<void>;
};

/**
 * Watch a view-state file for changes and invoke the callback (debounced 200ms).
 *
 * Watches the **parent directory** (depth: 0) and filters events by basename.
 * This survives atomic tmp+rename writes cleanly — a single-file watcher loses
 * its inode binding when the target is replaced via rename and stops firing.
 *
 * Listens for `add` (post-rename), `change`, and `unlink` (rename-replace can
 * surface as unlink+add on some platforms).
 */
export function watchViewStateFile(
  filePath: string,
  onChange: () => void,
  options: { debounceMs?: number } = {},
): ViewWatcherHandle {
  const debounceMs = options.debounceMs ?? 200;
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);

  const watcher = chokidar.watch(dir, {
    awaitWriteFinish: {
      stabilityThreshold: 50,
      pollInterval: 10,
    },
    ignoreInitial: true,
    depth: 0,
  });

  let timer: NodeJS.Timeout | null = null;
  const fire = (eventPath: string) => {
    if (path.basename(eventPath) !== base) return;
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
  watcher.on("unlink", fire);

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
