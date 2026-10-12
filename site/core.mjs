export const TYPES = [
  ["string", "Texte"], ["textarea", "Texte long"], ["number", "Nombre"],
  ["date", "Date"], ["list", "Liste"], ["geocoding", "Adresse"],
  ["reverse-geocoding", "Adresse depuis la carte"]
];
export const TEXT_TYPES = new Set(["string", "textarea"]);
export const splitValues = (text = "") => String(text).split(/[\n,]/).map(value => value.trim()).filter(Boolean);
export const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export function inferType(schemaType = "") {
  const type = schemaType.split(":").pop().toLowerCase();
  if (/^(byte|short|int|integer|long|decimal|double|float|unsignedint|unsignedlong|unsignedshort|nonnegativeinteger|positiveinteger)$/.test(type)) return "number";
  if (/^(date|datetime)$/.test(type)) return "date";
  return "string";
}

export function createField(name = "", schemaType = "xsd:string", required = false) {
  return {
    name, label: name, type: inferType(schemaType), schemaType,
    editable: true, required, readOnly: false, hidden: false, roles: "",
    listMode: "static", listValues: "", listUrl: "", listField: "",
    pattern: "", validationMessage: "", min: "", max: "",
    hasDefault: false, defaultValue: "", hasValue: false, value: "",
    xField: "", yField: "", conditions: []
  };
}

function literal(value, type, label, errors) {
  if (type === "number") {
    if (String(value).trim() === "" || !Number.isFinite(Number(value))) {
      errors.push(`${label} : saisir un nombre.`);
      return value;
    }
    return Number(value);
  }
  return String(value);
}

export function buildConfiguration(state) {
  const errors = [];
  const warnings = [];
  const layerName = state.layerName.trim();
  if (!layerName) errors.push("Renseigner le nom technique de la couche.");
  if (!state.fields.length) errors.push("Ajouter au moins un champ.");
  if (![state.wfsUrl, state.globalWfsUrl, state.serverUrl, state.globalServerUrl].some(url => url?.trim())) warnings.push("URL WFS absente : la saisie sera configurée, mais l'enregistrement nécessite un service WFS-T.");
  const names = state.fields.map(field => field.name.trim());
  const fields = state.fields.map((field, index) => {
    const name = names[index];
    if (!name) errors.push(`Champ ${index + 1} : renseigner le nom de l'attribut.`);
    if (name && names.indexOf(name) !== index) errors.push(`Le champ « ${name} » est présent plusieurs fois.`);
    const result = { name, label: field.label.trim() || name, type: field.type,
      required: field.required, readOnly: field.readOnly || field.editable === false,
      roles: splitValues(field.roles) };
    if (!TYPES.some(([type]) => type === field.type)) errors.push(`${name} : type de champ inconnu.`);
    if (field.type === "list") {
      if (field.listMode === "remote") {
        if (!field.listUrl.trim() || !field.listField.trim()) errors.push(`${name} : renseigner l'URL et l'attribut de la liste distante.`);
        result.options = { url: field.listUrl.trim(), field: field.listField.trim() };
      } else {
        result.options = field.listMode === "infer" ? []
          : [...new Set(field.listValues.split("\n").map(value => value.trim()).filter(Boolean))];
      }
    }
    if (["geocoding", "reverse-geocoding"].includes(field.type)) {
      const options = {};
      for (const axis of ["xField", "yField"]) {
        if (field[axis]) {
          if (!names.includes(field[axis]) || field[axis] === name) errors.push(`${name} : attribut de coordonnées invalide.`);
          options[axis] = field[axis];
        }
      }
      if (Object.keys(options).length) result.options = options;
    }
    if (TEXT_TYPES.has(field.type) && field.pattern) {
      try { new RegExp(field.pattern); } catch { errors.push(`${name} : expression régulière invalide.`); }
      result.pattern = field.pattern;
    }
    if (field.type === "number") {
      for (const bound of ["min", "max"]) {
        if (String(field[bound]).trim() !== "") result[bound] = literal(field[bound], "number", `${name} / ${bound}`, errors);
      }
      if (own(result, "min") && own(result, "max") && result.min > result.max) errors.push(`${name} : la borne minimale dépasse la borne maximale.`);
    }
    if ((TEXT_TYPES.has(field.type) || field.type === "number") && field.validationMessage.trim()) result.validationMessage = field.validationMessage.trim();
    if (field.hasDefault) result.defaultValue = literal(field.defaultValue, field.type, `${name} / défaut`, errors);
    if (field.hasValue) {
      result.value = literal(field.value, field.type, `${name} / valeur fixe`, errors);
      if (!field.readOnly) warnings.push(`${name} : la valeur fixe prévaut sur la saisie ; activer « Lecture seule » pour éviter une saisie sans effet.`);
    }
    if (field.conditions.length) {
      const conditions = field.conditions.map(condition => {
        const parent = state.fields.find(entry => entry.name.trim() === condition.field);
        if (!parent) errors.push(`${name} : choisir un attribut pour chaque condition.`);
        if (condition.field === name) errors.push(`${name} : un champ ne peut pas dépendre de lui-même.`);
        if (condition.operator === "notEmpty") return { field: condition.field, operator: "notEmpty" };
        if (condition.operator !== "eq") errors.push(`${name} : opérateur de condition inconnu.`);
        return { field: condition.field, eq: literal(condition.eq, parent?.type, `${name} / condition`, errors) };
      });
      result.editableIf = conditions.length === 1 ? conditions[0] : conditions;
    }
    return result;
  });
  const graph = new Map(state.fields.map(field => [field.name.trim(), field.conditions.map(condition => condition.field)]));
  const visited = new Set();
  function visit(name, path = new Set()) {
    if (path.has(name)) return true;
    if (visited.has(name)) return false;
    const next = new Set(path).add(name);
    if ((graph.get(name) || []).some(parent => visit(parent, next))) return true;
    visited.add(name);
    return false;
  }
  if (names.some(name => visit(name))) errors.push("Les dépendances contiennent un cycle. Modifier les conditions.");
  const layer = { allowEdit: state.allowEdit, allowDelete: state.allowDelete, fields };
  const hidden = state.fields.filter(field => field.hidden).map(field => field.name.trim()).filter(Boolean);
  if (hidden.length) layer.hidden = hidden;
  for (const key of ["wfsUrl", "idField", "featureFieldLabel"]) {
    if (state[key].trim()) layer[key] = state[key].trim();
  }
  if (state.allowEditRoles.trim()) layer.allowEditRoles = splitValues(state.allowEditRoles);
  if (state.deletionRoles.trim()) layer.deletionRoles = splitValues(state.deletionRoles);
  if (state.serverUrl?.trim()) layer.serverUrl = state.serverUrl.trim();
  if (state.areaMode && state.areaMode !== "none") {
    const key = state.areaMode === "wkt" ? "wkt" : "url";
    const value = (key === "wkt" ? state.areaWkt : state.areaUrl).trim();
    if (!value) errors.push("Renseigner la zone de compétence ou désactiver la restriction spatiale.");
    layer.restrictedArea = { [key]: value, operation: state.areaOperation };
    if (state.areaAllowedRoles.trim()) layer.restrictedArea.allowedRoles = splitValues(state.areaAllowedRoles);
  }
  const cfg = { title: state.title.trim() || "Attributs", layers: { [layerName]: layer } };
  for (const [source, key] of [["tooltip", "tooltip"], ["icon", "icon"], ["globalWfsUrl", "wfsUrl"], ["globalServerUrl", "serverUrl"], ["geocodingService", "geocodingService"]]) {
    if (state[source]?.trim()) cfg[key] = state[source].trim();
  }
  if (state.size !== undefined && String(state.size).trim() !== "") {
    const size = Number(state.size);
    if (!Number.isFinite(size) || size <= 0) errors.push("La largeur du panneau doit être un nombre positif.");
    else cfg.size = size;
  }
  if (state.iconByContext?.trim()) {
    const entries = state.iconByContext.split("\n").filter(line => line.trim()).map(line => {
      const separator = line.indexOf("=");
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (separator < 1 || !key || !value) errors.push("Icônes par contexte : utiliser une ligne contexte=icône.");
      return [key, value];
    });
    cfg.iconByContext = Object.fromEntries(entries);
  }
  return { configuration: { name: "panelEditor", cfg }, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

export function createState() {
  return { wmsUrl: "", wfsUrl: "", typeName: "", layerName: "", layerTitle: "",
    title: "Attributs", tooltip: "", icon: "", size: "", iconByContext: "",
    globalWfsUrl: "", globalServerUrl: "", geocodingService: "", serverUrl: "",
    areaMode: "none", areaWkt: "", areaUrl: "", areaOperation: "WITHIN", areaAllowedRoles: "",
    allowEdit: true, allowDelete: false, allowEditRoles: "",
    deletionRoles: "", idField: "", featureFieldLabel: "", fields: [] };
}

export function demoState() {
  const state = createState();
  Object.assign(state, { wmsUrl: "https://exemple.fr/geoserver/wms", wfsUrl: "https://exemple.fr/geoserver/wfs",
    layerName: "urbanisme:projets", layerTitle: "Projets d'urbanisme", typeName: "urbanisme:projets",
    title: "Projets d'urbanisme", allowEditRoles: "EDITOR", idField: "id", featureFieldLabel: "nom" });
  state.fields = [createField("id", "xsd:int"), createField("nom"), createField("statut"), createField("region"), createField("commentaire"), createField("code_postal"), createField("mesure", "xsd:double")];
  state.fields[0].readOnly = true;
  state.fields[1].required = true;
  Object.assign(state.fields[2], { type: "list", listValues: "À instruire\nValidé\nRefusé" });
  Object.assign(state.fields[3], { type: "list", listValues: "BZH\nHDF\nIDF" });
  Object.assign(state.fields[4], { type: "textarea", conditions: [{ field: "statut", operator: "eq", eq: "Validé" }, { field: "region", operator: "eq", eq: "BZH" }] });
  state.fields[5].pattern = "^[0-9]{5}$";
  Object.assign(state.fields[6], { min: "-10", max: "20" });
  return state;
}
