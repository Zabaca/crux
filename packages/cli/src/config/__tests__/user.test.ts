import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { configPath, loadConfig, writeConfig } from "../user.js";

/**
 * `config.toml` carries the bearer token that owns a Principal's whole corpus
 * (ADR-0013), so its mode is part of the product, not a detail of umask.
 */
describe("config file permissions", () => {
  let home = "";
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env.CRUX_HOME;
    home = mkdtempSync(join(tmpdir(), "crux-config-perms-"));
    // mkdtemp is already 700; the tests that care create their own directory.
    rmSync(home, { recursive: true, force: true });
    process.env.CRUX_HOME = home;
  });

  afterEach(() => {
    if (prev) process.env.CRUX_HOME = prev;
    else delete process.env.CRUX_HOME;
    rmSync(home, { recursive: true, force: true });
  });

  const mode = (p: string) => statSync(p).mode & 0o777;

  test("a first write creates the directory 700 and the file 600", () => {
    const p = writeConfig({ api: { url: "https://crux.test", token: "tok-secret" } });

    expect(p).toBe(configPath());
    expect(mode(home)).toBe(0o700);
    expect(mode(p)).toBe(0o600);
  });

  test("a rewrite keeps both owner-only", () => {
    writeConfig({ api: { url: "https://crux.test", token: "tok-secret" } });
    writeConfig({ user: { id: "USR-a", slug: "a", name: "A" } });

    expect(mode(home)).toBe(0o700);
    expect(mode(configPath())).toBe(0o600);
  });

  test("an existing config left world-readable is tightened, not trusted", () => {
    mkdirSync(home, { recursive: true, mode: 0o755 });
    writeFileSync(configPath(), '[api]\nurl = "https://crux.test"\ntoken = "tok-secret"\n');
    chmodSync(home, 0o755);
    chmodSync(configPath(), 0o644);

    // Reading is enough — an install that never writes again still gets fixed.
    expect(loadConfig()?.api?.url).toBe("https://crux.test");

    expect(mode(home)).toBe(0o700);
    expect(mode(configPath())).toBe(0o600);
  });

  test("a config the user hardened further is left alone", () => {
    writeConfig({ api: { url: "https://crux.test", token: "tok-secret" } });
    chmodSync(configPath(), 0o400);

    expect(loadConfig()?.api?.token).toBe("tok-secret");

    // Only group and other are ours to take away; 400 is stricter than we ask.
    expect(mode(configPath())).toBe(0o400);
  });

  test("a config that is a symlink has its target left untouched", () => {
    // Dotfile managers symlink files under ~/.claude, and there is no lchmod on
    // Linux — re-moding whatever sits at the other end is not ours to do.
    const target = join(home, "..", `crux-symlink-target-${process.pid}.toml`);
    mkdirSync(home, { recursive: true, mode: 0o700 });
    writeFileSync(target, '[api]\nurl = "https://crux.test"\ntoken = "tok-secret"\n');
    chmodSync(target, 0o644);
    symlinkSync(target, configPath());

    try {
      expect(loadConfig()?.api?.url).toBe("https://crux.test");
      expect(mode(target)).toBe(0o644);
      expect(lstatSync(configPath()).isSymbolicLink()).toBe(true);
    } finally {
      rmSync(target, { force: true });
    }
  });
});
