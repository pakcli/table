import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: `
      export { AsciiSerializer } from "./src/features/asciidraw/utils/serializer";
      export { GridBuffer } from "./src/features/asciidraw/core/GridBuffer";
    `,
    resolveDir: process.cwd(),
    loader: 'ts'
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false,
});
const { AsciiSerializer, GridBuffer } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`,
);

test("AsciiSerializer preserves dimensions on custom size", () => {
  const buf = new GridBuffer(80, 24);
  buf.setCell(0, 0, { char: 'X' });
  const serialized = AsciiSerializer.serialize([buf], 'default', false);
  assert.match(serialized, /<!-- size: 80x24 -->/);

  const parsed = AsciiSerializer.parse(serialized);
  assert.equal(parsed.cols, 80);
  assert.equal(parsed.rows, 24);
});

test("AsciiSerializer preserves dimensions even when canvas is cleared", () => {
  const buf = new GridBuffer(100, 30);
  buf.clear(' ');
  const serialized = AsciiSerializer.serialize([buf], 'default', false);
  assert.match(serialized, /<!-- size: 100x30 -->/);

  const parsed = AsciiSerializer.parse(serialized);
  assert.equal(parsed.cols, 100);
  assert.equal(parsed.rows, 30);
});

test("AsciiSerializer parses JSON project with dimensions and theme", () => {
  const buf = new GridBuffer(70, 25);
  buf.setCell(5, 5, { char: '#' });
  const serialized = AsciiSerializer.serialize([buf], 'matrix', true);
  const parsed = AsciiSerializer.parse(serialized);
  assert.equal(parsed.cols, 70);
  assert.equal(parsed.rows, 25);
  assert.equal(parsed.theme, 'matrix');
});
