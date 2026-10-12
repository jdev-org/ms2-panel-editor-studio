import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseStudioConfig } from "../site/config.mjs";

test("loads the configured local layer and preserves its GetMap parameters", async () => {
  const config = JSON.parse(await readFile(new URL("../site/public/studio-config.json", import.meta.url)));
  const { services, defaultService } = parseStudioConfig(config);
  assert.equal(services.length, 2);
  assert.equal(defaultService.id, "avis-urbanisme-local");
  assert.equal(new URL(defaultService.url).searchParams.get("layers"), "data:avis_urbanisme");
});
test("allows an empty preset list and no default service", () => {
  assert.deepEqual(parseStudioConfig({ wmsServices: [] }), { services: [], defaultService: undefined });
});
test("rejects invalid URLs, duplicate identifiers and unknown defaults", () => {
  const service = { id: "local", label: "Local", url: "http://localhost:82/geoserver/wms" };
  assert.throws(() => parseStudioConfig({ wmsServices: [service, service] }), /uniques/);
  assert.throws(() => parseStudioConfig({ wmsServices: [{ ...service, url: "javascript:alert(1)" }] }));
  assert.throws(() => parseStudioConfig({ wmsServices: [service], defaultWmsService: "missing" }), /n'existe pas/);
});
