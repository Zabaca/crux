import { useState, useEffect } from "react";

export type TerminalSize = { columns: number; rows: number };

export function useTerminalSize(): TerminalSize {
  const [size, setSize] = useState<TerminalSize>({
    columns: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
  });

  useEffect(() => {
    const handler = () => {
      setSize({
        columns: process.stdout.columns ?? 80,
        rows: process.stdout.rows ?? 24,
      });
    };
    process.stdout.on("resize", handler);
    return () => {
      process.stdout.off("resize", handler);
    };
  }, []);

  return size;
}
