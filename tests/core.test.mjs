import test from "node:test";
import assert from "node:assert/strict";
import { createState, createField, demoState, buildConfiguration, inferType } from "../site/core.mjs";
import { serviceUrl, requestUrl, guessWfsUrl, parseJsonSchema, discoverFields, matchWmsLayer } from "../site/ogc.mjs";

function stateWith(...fields) {
  return { ...createState(), layerName: "test:couche", wfsUrl: "https://example.org/ows", fields };
}
test("exports a MapStore panelEditor configuration without studio metadata", () => {
  const { configuration, errors } = buildConfiguration(demoState());
  assert.deepEqual(errors, []);
  assert.equal(configuration.name, "panelEditor");
  const layer = configuration.cfg.layers["urbanisme:projets"];
  assert.deepEqual(layer.allowEditRoles, ["EDITOR"]);
  assert.deepEqual(layer.fields.find(field => field.name === "commentaire").editableIf,
    [{ field: "statut", eq: "Validé" }, { field: "region", eq: "BZH" }]);
  assert.equal(layer.fields.find(field => field.name === "code_postal").pattern, "^[0-9]{5}$");
  assert.equal(layer.fields.find(field => field.name === "mesure").min, -10);
  assert.ok(layer.fields.every(field => !Object.hasOwn(field, "schemaType") && !Object.hasOwn(field, "conditions")));
});
test("exports numeric equality and notEmpty using the extension syntax", () => {
  const number = createField("nombre", "xsd:double");
  const child = createField("commentaire");
  child.conditions = [{ field: "nombre", operator: "eq", eq: "0" }];
  const layer = buildConfiguration(stateWith(number, child)).configuration.cfg.layers["test:couche"];
  assert.deepEqual(layer.fields[1].editableIf, { field: "nombre", eq: 0 });
  child.conditions = [{ field: "nombre", operator: "notEmpty", eq: "ignored" }];
  assert.deepEqual(buildConfiguration(stateWith(number, child)).configuration.cfg.layers["test:couche"].fields[1].editableIf, { field: "nombre", operator: "notEmpty" });
});
test("detects duplicate names, missing conditions, self-reference and cycles", () => {
  const a = createField("a"); const b = createField("b"); const c = createField("c");
  a.conditions = [{ field: "b", operator: "eq", eq: "yes" }];
  b.conditions = [{ field: "c", operator: "eq", eq: "yes" }];
  c.conditions = [{ field: "a", operator: "eq", eq: "yes" }];
  assert.ok(buildConfiguration(stateWith(a, b, c)).errors.some(error => /cycle/.test(error)));
  b.conditions = [];
  assert.equal(buildConfiguration(stateWith(a, b, c)).errors.length, 0);
  a.conditions[0].field = "missing";
  assert.ok(buildConfiguration(stateWith(a, b, c)).errors.some(error => /attribut/.test(error)));
  assert.ok(buildConfiguration(stateWith(a, createField("a"))).errors.some(error => /plusieurs fois/.test(error)));
});
test("validates regex only on text, and inclusive numeric bounds only on numbers", () => {
  const field = createField("text"); field.pattern = "[";
  assert.ok(buildConfiguration(stateWith(field)).errors.some(error => /expression/.test(error)));
  field.type = "number"; field.min = "-10"; field.max = "20";
  let result = buildConfiguration(stateWith(field));
  assert.deepEqual(result.errors, []);
  assert.equal(result.configuration.cfg.layers["test:couche"].fields[0].pattern, undefined);
  field.min = "21";
  assert.ok(buildConfiguration(stateWith(field)).errors.some(error => /borne/.test(error)));
  field.min = "invalid";
  assert.ok(buildConfiguration(stateWith(field)).errors.some(error => /nombre/.test(error)));
});
test("exports static, inferred and remote list options", () => {
  const field = createField("statut"); field.type = "list";
  field.listValues = "A\nB\nA\n";
  const exported = () => buildConfiguration(stateWith(field)).configuration.cfg.layers["test:couche"].fields[0];
  assert.deepEqual(exported().options, ["A", "B"]);
  field.listMode = "infer";
  assert.deepEqual(exported().options, []);
  field.listMode = "remote"; field.listUrl = "https://example.org/items"; field.listField = "statut";
  assert.deepEqual(exported().options, { url: field.listUrl, field: "statut" });
});
test("preserves explicit empty defaults, zero fixed values and geocoding options", () => {
  const field = createField("texte"); field.hasDefault = true;
  const amount = createField("montant", "xsd:int"); amount.hasValue = true; amount.value = "0"; amount.readOnly = true;
  const address = createField("adresse"); address.type = "geocoding"; address.xField = "montant";
  const { configuration, errors } = buildConfiguration(stateWith(field, amount, address));
  assert.deepEqual(errors, []);
  const fields = configuration.cfg.layers["test:couche"].fields;
  assert.equal(fields[0].defaultValue, ""); assert.equal(fields[1].value, 0);
  assert.deepEqual(fields[2].options, { xField: "montant" });
});
test("maps schema types and excludes geometry", () => {
  assert.equal(inferType("xs:decimal"), "number"); assert.equal(inferType("xsd:dateTime"), "date");
  assert.equal(inferType("xs:boolean"), "string");
  const fields = parseJsonSchema({ featureTypes: [{ properties: [
    { name: "geom", type: "gml:MultiSurfacePropertyType" },
    { name: "amount", type: "xsd:double", nillable: false, minOccurs: 1 },
    { name: "date", type: "xs:date", nillable: true },
    { name: "label", type: "xsd:string" }
  ] }] });
  assert.deepEqual(fields.map(field => [field.name, field.type, field.required]), [["amount", "number", true], ["date", "date", false], ["label", "string", false]]);
});
test("normalizes GetMap URLs while preserving service-specific query parameters", () => {
  const input = "https://example.org/geoserver/ws/wms?SERVICE=WMS&REQUEST=GetMap&LAYERS=ws:a&BBOX=1,2,3,4&token=private#map";
  const clean = new URL(serviceUrl(input));
  assert.equal(clean.searchParams.get("token"), "private");
  assert.equal(clean.searchParams.has("LAYERS"), false);
  assert.equal(clean.hash, "");
  assert.equal(new URL(guessWfsUrl(input)).pathname, "/geoserver/ws/wfs");
  const url = new URL(requestUrl(input, { service: "WFS", request: "DescribeFeatureType", typeName: "ws:a" }));
  assert.equal(url.searchParams.get("typeName"), "ws:a");
  assert.equal(url.searchParams.get("token"), "private");
  assert.throws(() => serviceUrl("javascript:alert(1)"));
  assert.throws(() => serviceUrl("https://user:secret@example.org/wms"));
});
test("retrieves schema with a WFS version fallback and GET requests only", async () => {
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push([new URL(url), options]);
    if (requests.length === 1) return { ok: false, status: 400 };
    return { ok: true, text: async () => JSON.stringify({ featureTypes: [{ properties: [{ name: "name", type: "xsd:string" }] }] }) };
  };
  const fields = await discoverFields("https://example.org/wfs", "test:couche", undefined, fetcher);
  assert.equal(fields[0].name, "name");
  assert.equal(requests[1][0].searchParams.get("version"), "2.0.0");
  assert.equal(requests[1][0].searchParams.get("typeNames"), "test:couche");
  assert.equal(requests[0][1].credentials, "omit");
  assert.equal(requests[0][1].method, undefined);
});
test("reports missing layer/fields without exporting a misleading valid configuration", () => {
  assert.equal(buildConfiguration(createState()).errors.length, 2);
  const { warnings } = buildConfiguration({ ...stateWith(createField("a")), wfsUrl: "" });
  assert.ok(warnings.some(warning => /WFS-T/.test(warning)));
});

test("exports hidden attributes without removing their field settings", () => {
  const visible = createField("nom"); const hidden = createField("secret"); const other = createField("interne");
  hidden.hidden = true; other.hidden = true;
  const state = stateWith(visible, hidden, other);
  let layer = buildConfiguration(state).configuration.cfg.layers["test:couche"];
  assert.deepEqual(layer.hidden, ["secret", "interne"]);
  assert.equal(layer.fields.length, 3);
  assert.ok(layer.fields.every(field => !Object.hasOwn(field, "hidden")));
  hidden.name = "secret_renomme";
  layer = buildConfiguration(state).configuration.cfg.layers["test:couche"];
  assert.deepEqual(layer.hidden, ["secret_renomme", "interne"]);
  state.fields.splice(1, 1);
  assert.deepEqual(buildConfiguration(state).configuration.cfg.layers["test:couche"].hidden, ["interne"]);
  other.hidden = false;
  assert.equal(buildConfiguration(state).configuration.cfg.layers["test:couche"].hidden, undefined);
});

test("exports general plugin and layer settings in their correct scopes", () => {
  const state = stateWith(createField("id"));
  Object.assign(state, { tooltip: "Éditer", icon: "pencil", size: "450", iconByContext: "default=map\n12=pencil",
    globalWfsUrl: "https://global.example/wfs", globalServerUrl: "https://global.example/geoserver",
    geocodingService: "https://geo.example/geocodage", serverUrl: "https://layer.example/geoserver",
    areaMode: "url", areaUrl: "https://layer.example/area", areaOperation: "INTERSECTS", areaAllowedRoles: "ADMIN, MANAGER" });
  const { configuration, errors } = buildConfiguration(state);
  assert.deepEqual(errors, []);
  const cfg = configuration.cfg;
  assert.equal(cfg.tooltip, "Éditer"); assert.equal(cfg.icon, "pencil"); assert.equal(cfg.size, 450);
  assert.deepEqual(cfg.iconByContext, { default: "map", 12: "pencil" });
  assert.equal(cfg.wfsUrl, state.globalWfsUrl); assert.equal(cfg.serverUrl, state.globalServerUrl);
  assert.equal(cfg.geocodingService, state.geocodingService);
  const layer = cfg.layers["test:couche"];
  assert.equal(layer.serverUrl, state.serverUrl);
  assert.deepEqual(layer.restrictedArea, { url: state.areaUrl, operation: "INTERSECTS", allowedRoles: ["ADMIN", "MANAGER"] });
  state.areaMode = "wkt"; state.areaWkt = "POLYGON((0 0,1 0,1 1,0 0))";
  assert.equal(buildConfiguration(state).configuration.cfg.layers["test:couche"].restrictedArea.wkt, state.areaWkt);
  state.areaMode = "none";
  assert.equal(buildConfiguration(state).configuration.cfg.layers["test:couche"].restrictedArea, undefined);
});

test("validates general settings and recognizes global WFS configuration", () => {
  const state = stateWith(createField("nom"));
  Object.assign(state, { wfsUrl: "", globalWfsUrl: "https://example.org/wfs", size: "0", iconByContext: "invalid", areaMode: "wkt" });
  const result = buildConfiguration(state);
  assert.equal(result.warnings.length, 0);
  assert.ok(result.errors.some(error => /largeur/.test(error)));
  assert.ok(result.errors.some(error => /contexte/.test(error)));
  assert.ok(result.errors.some(error => /zone de compétence/.test(error)));
});

test("matches qualified GetMap names with workspace-scoped WMS capabilities", () => {
  const layers = [{ name: "avis_urbanisme" }, { name: "avisee_projets" }];
  assert.equal(matchWmsLayer(layers, "data:avis_urbanisme"), layers[0]);
  assert.equal(matchWmsLayer(layers, "avis_urbanisme"), layers[0]);
  assert.equal(matchWmsLayer(layers, undefined), undefined);
  assert.equal(matchWmsLayer(layers, "data:missing"), undefined);
  const qualified = [{ name: "other:avis_urbanisme" }, { name: "data:avis_urbanisme" }];
  assert.equal(matchWmsLayer(qualified, "data:avis_urbanisme"), qualified[1]);
  assert.equal(matchWmsLayer(qualified, "avis_urbanisme"), undefined);
});

test("exports a single editing mode without contradictory flags or breaking fixed values", () => {
  const field = createField("statut");
  const exported = () => buildConfiguration(stateWith(field)).configuration.cfg.layers["test:couche"].fields[0];
  assert.equal(exported().readOnly, false);
  assert.equal(Object.hasOwn(exported(), "editable"), false);
  field.readOnly = true;
  assert.equal(exported().readOnly, true);
  field.hasValue = true; field.value = "BAZ";
  assert.equal(exported().value, "BAZ");
  assert.equal(Object.hasOwn(exported(), "editable"), false);
  field.readOnly = false; field.editable = false;
  assert.equal(exported().readOnly, true);
});
