import { createField } from "./core.mjs";

const OGC_PARAMS = new Set("service request version layers query_layers layer typename typenames outputformat info_format format styles bbox crs srs width height x y i j transparent exceptions feature_count count maxfeatures sld_version".split(" "));
export function serviceUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error("Saisir une URL complète, commençant par https:// ou http://."); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Utiliser une URL HTTP(S) sans identifiants intégrés.");
  for (const key of [...url.searchParams.keys()]) if (OGC_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
  url.hash = "";
  return url.href;
}

export function requestUrl(input, params) {
  const url = new URL(serviceUrl(input));
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.href;
}
export function guessWfsUrl(input) {
  const url = new URL(serviceUrl(input));
  url.pathname = url.pathname.replace(/\/wms\/?$/i, "/wfs");
  return url.href;
}

const all = (root, name) => [...root.getElementsByTagNameNS("*", name)];
const children = (node, name) => [...node.children].filter(child => child.localName === name);
const childText = (node, name) => children(node, name)[0]?.textContent.trim() || "";
export function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (all(doc, "parsererror").length) throw new Error("Le service a retourné un XML illisible.");
  const error = all(doc, "ServiceException")[0] || all(doc, "ExceptionText")[0];
  if (error) throw new Error(error.textContent.trim());
  return doc;
}

export function parseCapabilities(text) {
  const doc = parseXml(text);
  const layers = all(doc, "Layer").flatMap(node => {
    const name = childText(node, "Name");
    if (!name) return [];
    return [{ name, title: childText(node, "Title") || name, abstract: childText(node, "Abstract") }];
  });
  if (!layers.length) throw new Error("Aucune couche nommée dans la réponse GetCapabilities.");
  return [...new Map(layers.map(layer => [layer.name, layer])).values()];
}

// Workspace-scoped WMS services may advertise an unqualified layer name.
export function matchWmsLayer(layers, name) {
  const exact = layers.find(layer => layer.name === name);
  if (exact) return exact;
  if (!name) return undefined;
  const localName = name.split(":").pop();
  const candidates = layers.filter(layer => layer.name === localName);
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function parseDescribeLayer(text, baseUrl, layerName) {
  const doc = parseXml(text);
  const node = all(doc, "LayerDescription").find(entry => entry.getAttribute("name") === layerName)
    || all(doc, "LayerDescription")[0];
  if (!node || (node.getAttribute("owsType") || "WFS").toUpperCase() !== "WFS") return null;
  const endpoint = node.getAttribute("owsURL") || node.getAttribute("wfs");
  const query = all(node, "Query")[0];
  return endpoint ? { wfsUrl: serviceUrl(new URL(endpoint, baseUrl).href), typeName: query?.getAttribute("typeName") || layerName } : null;
}

export function isGeometry(type = "") {
  return /(^gml:|geometry|point|linestring|polygon|multicurve|multisurface|surfaceproperty|curveproperty)/i.test(type);
}

export function parseJsonSchema(json) {
  const properties = json?.featureTypes?.[0]?.properties;
  if (!Array.isArray(properties)) throw new Error("Le JSON ne contient pas de schéma WFS reconnu.");
  return properties.filter(property => property.name && !isGeometry(property.type || property.localType))
    .map(property => createField(property.name, property.type || property.localType || "xsd:string", property.nillable === false && Number(property.minOccurs ?? 1) > 0));
}

export function parseXmlSchema(text, typeName) {
  const doc = parseXml(text);
  const localName = typeName.split(":").pop();
  const schema = all(doc, "schema")[0];
  if (!schema) throw new Error("La réponse ne contient pas de schéma XSD.");
  const declaration = children(schema, "element").find(node => node.getAttribute("name") === localName);
  const declaredType = declaration?.getAttribute("type")?.split(":").pop();
  const complexTypes = children(schema, "complexType");
  const complex = complexTypes.find(node => node.getAttribute("name") === declaredType)
    || complexTypes.find(node => node.getAttribute("name") === `${localName}Type`)
    || (complexTypes.length === 1 ? complexTypes[0] : null)
    || children(declaration || schema, "complexType")[0];
  if (!complex) throw new Error("Le type de la couche n'est pas défini dans ce schéma ; ajouter les champs manuellement.");
  const seen = new Set();
  function properties(node) {
    if (seen.has(node)) return [];
    seen.add(node);
    const extension = all(node, "extension")[0];
    const base = extension?.getAttribute("base")?.split(":").pop();
    const inherited = complexTypes.find(entry => entry.getAttribute("name") === base);
    return [...(inherited ? properties(inherited) : []), ...all(node, "element")];
  }
  return properties(complex).flatMap(node => {
    const name = node.getAttribute("name");
    const type = node.getAttribute("type") || children(node, "simpleType")[0]?.getElementsByTagNameNS("*", "restriction")[0]?.getAttribute("base") || "xsd:string";
    if (!name || isGeometry(type)) return [];
    return [createField(name, type, node.getAttribute("nillable") !== "true" && node.getAttribute("nillable") !== "1" && node.getAttribute("minOccurs") !== "0")];
  });
}

export async function fetchDocument(url, signal, fetcher = fetch) {
  const timeout = AbortSignal.timeout(20000);
  const response = await fetcher(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, credentials: "omit" });
  if (!response.ok) throw new Error(`Le service répond HTTP ${response.status}.`);
  return response.text();
}

export async function discoverLayers(input, signal, fetcher = fetch) {
  let error;
  for (const version of ["1.3.0", "1.1.1"]) {
    try {
      return parseCapabilities(await fetchDocument(requestUrl(input, { service: "WMS", request: "GetCapabilities", version }), signal, fetcher));
    } catch (cause) { if (signal?.aborted) throw cause; error = cause; }
  }
  throw error;
}

export async function describeLayer(input, layerName, signal, fetcher = fetch) {
  try {
    return parseDescribeLayer(await fetchDocument(requestUrl(input, { service: "WMS", request: "DescribeLayer", version: "1.1.1", layers: layerName }), signal, fetcher), input, layerName);
  } catch (error) { if (signal?.aborted) throw error; return null; }
}

export async function discoverFields(input, typeName, signal, fetcher = fetch) {
  let error;
  for (const version of ["1.1.0", "2.0.0", "1.0.0"]) {
    try {
      const params = { service: "WFS", request: "DescribeFeatureType", version, [version === "2.0.0" ? "typeNames" : "typeName"]: typeName };
      const text = await fetchDocument(requestUrl(input, params), signal, fetcher);
      const fields = text.trim().startsWith("{") ? parseJsonSchema(JSON.parse(text)) : parseXmlSchema(text, typeName);
      if (!fields.length) throw new Error("Aucun attribut simple trouvé ; ajouter les champs manuellement.");
      return fields;
    } catch (cause) { if (signal?.aborted) throw cause; error = cause; }
  }
  throw error;
}
