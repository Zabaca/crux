#!/usr/bin/env bun
/**
 * Structural rot check (ADR-0002): walks the README-rooted doc tree live and
 * exits non-zero when a doc is unreachable or an internal link is broken.
 * Nothing is generated or written.
 */
import { findRepoRoot, formatRot, hasRot, walkDocs } from "@crux/core/docs";

const repoRoot = process.argv[2] ?? findRepoRoot();
const { rot } = walkDocs(repoRoot);

console.log(formatRot(rot));
process.exit(hasRot(rot) ? 1 : 0);
