// Digit-literal lint for the story components (hard rule from the prompt,
// section 7): no numeric literal may appear in JSX. Not a progress value, not
// a bar width, not a timestamp, not a percentage — every displayed value must
// resolve from StormAnalysis at runtime.
//
// This walks the AST with the TypeScript compiler and flags exactly two node
// kinds:
//   1. JSX text nodes containing any digit, and
//   2. JSX attribute initializers that are string literals containing digits
//      (e.g. label="+24h").
// Expression containers ({...}) are permitted — that is the escape hatch for
// turning data into display text via template literals and calculations.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const STORY_DIR = resolve(process.cwd(), "src/components/story");

function listTsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listTsxFiles(full));
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function findViolations(file: string): { line: number; text: string }[] {
  const source = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: { line: number; text: string }[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const text = node.getText(sf);
      if (/\d/.test(text)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        violations.push({ line, text: text.trim() });
      }
    }
    if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      if (/\d/.test(node.initializer.text)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        violations.push({ line, text: `${node.name.getText(sf)}="${node.initializer.text}"` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return violations;
}

describe("story: no numeric literals in JSX", () => {
  const files = listTsxFiles(STORY_DIR).filter((f) => !f.endsWith(".test.tsx"));

  it("has component files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("reports no digit literals in JSX text or attribute strings", () => {
    const failures: string[] = [];
    for (const file of files) {
      const violations = findViolations(file);
      for (const v of violations) {
        failures.push(`${file.replace(process.cwd(), "")}:${v.line} — "${v.text}"`);
      }
    }
    expect(failures).toEqual([]);
  });
});