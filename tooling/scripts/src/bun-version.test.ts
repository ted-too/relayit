import * as NodePath from "node:path";
import { expect, test } from "@effect/vitest";

const ROOT = NodePath.join(import.meta.dirname, "../../..");

test("every Dockerfile builds from the Bun that packageManager pins", async () => {
  const { packageManager } = (await Bun.file(NodePath.join(ROOT, "package.json")).json()) as {
    readonly packageManager: string;
  };
  const version = packageManager.replace(/^bun@/, "");
  expect(version).toMatch(/^\d+\.\d+\.\d+$/);

  const images: { readonly file: string; readonly image: string }[] = [];
  for (const pattern of ["*Dockerfile*", "{apps,packages,tooling}/*/*Dockerfile*"]) {
    for await (const file of new Bun.Glob(pattern).scan(ROOT)) {
      const source = await Bun.file(NodePath.join(ROOT, file)).text();
      // Every mention of the image, tagged or not: a FROM, a COPY --from, a mount.
      for (const [image] of source.matchAll(/\boven\/bun(?::[\w.-]+)?(?:@sha256:\w+)?/g)) {
        images.push({ file, image });
      }
    }
  }

  // CI installs the pinned version and runs every test on it; an image on another Bun
  // would run code no test saw on that Bun. A variant of the same version is the same Bun.
  expect(images.length).toBeGreaterThan(0);
  expect(
    images.filter(
      ({ image }) => image !== `oven/bun:${version}` && !image.startsWith(`oven/bun:${version}-`),
    ),
  ).toEqual([]);
});
