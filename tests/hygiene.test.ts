import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Repository hygiene. The project is public, so nothing in it should be
 * specific to one person's server, and nothing should hide in the text.
 */

const ROOT = path.resolve(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "generated", ".pgdata", "coverage"]);
const TEXT = /\.(ts|tsx|mjs|js|json|css|md|yaml|yml|prisma|sql|toml|txt|example)$|^\.(env\.example|gitignore|dockerignore)$|^(Dockerfile|LICENSE)$/;

function files(dir = ROOT): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : files(path.join(dir, e.name));
    return TEXT.test(e.name) && e.name !== "pnpm-lock.yaml" ? [path.join(dir, e.name)] : [];
  });
}

const all = files().map((file) => ({ file: path.relative(ROOT, file), text: fs.readFileSync(file, "utf8") }));

describe("source files", () => {
  it("contain no invisible or bidirectional control characters", () => {
    // Code point ranges rather than a regex, so this test cannot itself hide anything.
    const ranges: [number, number][] = [
      [0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x9f], [0xad, 0xad],
      [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2069], [0xfeff, 0xfeff],
    ];
    const hasHidden = (text: string) => {
      for (const ch of text) {
        const cp = ch.codePointAt(0)!;
        if (ranges.some(([from, to]) => cp >= from && cp <= to)) return true;
      }
      return false;
    };
    const offenders = all.filter((f) => hasHidden(f.text)).map((f) => f.file);
    expect(offenders).toEqual([]);
  });

  it("carry no secrets or personal details, and no tooling credit", () => {
    // Built from fragments so this file doesn't trip its own check.
    const forbidden = [
      ["a", "nthropic"],
      ["cla", "ude"],
      ["co-auth", "ored-by"],
      ["gen", "erated with"],
      ["voids", "mp"],
      ["g", "mail"],
      ["host.docker", ".internal"],
      ["/o", "pt/"],
      ["BEGIN ", "PRIVATE KEY"],
      ["ghp", "_"],
      ["xox", "b-"],
    ].map((parts) => parts.join(""));
    const offenders: string[] = [];
    for (const f of all) {
      if (f.file === path.join("tests", "hygiene.test.ts")) continue;
      for (const word of forbidden) if (f.text.toLowerCase().includes(word.toLowerCase())) offenders.push(`${f.file}: ${word}`);
    }
    expect(offenders).toEqual([]);
  });

  it("keep local environment files out of version control", () => {
    const gitignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
    expect(gitignore).toMatch(/^\.env$/m);
    expect(gitignore).toMatch(/^!\.env\.example$/m);
  });
});
