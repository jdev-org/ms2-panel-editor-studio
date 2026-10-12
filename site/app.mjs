import { parseStudioConfig } from "./config.mjs";
import { TYPES, TEXT_TYPES, createState, createField, demoState, buildConfiguration } from "./core.mjs";
import { serviceUrl, guessWfsUrl, discoverLayers, describeLayer, discoverFields, matchWmsLayer } from "./ogc.mjs";

const $ = id => document.getElementById(id);
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const checked = value => value ? " checked" : "";
const selected = (a, b) => a === b ? " selected" : "";
let state = createState();
let selectedField = 0;
let layers = [];
let request = null;
let page = "source";
let wmsServices = [];

function notify(message, kind = "success") {
  $("notification").textContent = message;
  $("notification").className = `notification ${kind}`;
  $("notification").hidden = !message;
}
function cancelRequest() {
  request?.abort();
  request = null;
  busy(false);
}
function busy(value) {
  $("explore").disabled = value;
  $("read-fields").disabled = value || !$("layer-select").value;
  $("layer-select").disabled = value;
  $("explore").textContent = value ? "Interrogation du service…" : "Explorer les couches →";
  $("read-fields").textContent = value ? "Lecture en cours…" : "Lire les attributs →";
  $("source-form").setAttribute("aria-busy", String(value));
}
async function runRequest(task) {
  cancelRequest();
  const controller = new AbortController();
  request = controller;
  busy(true);
  notify("");
  try { await task(controller.signal); }
  catch (error) {
    if (!controller.signal.aborted) {
      const message = error.name === "TimeoutError" ? "Le service n'a pas répondu dans les 20 secondes."
        : error instanceof TypeError ? "Le service est inaccessible depuis le navigateur. Vérifiez l'URL, HTTPS et l'autorisation CORS du serveur. Vous pouvez saisir les champs manuellement."
          : error.message;
      notify(message, "error");
    }
  } finally { if (request === controller) { request = null; busy(false); } }
}

function showPage(next) {
  page = next;
  for (const key of ["source", "settings", "fields", "export"]) $("page-" + key).hidden = key !== next;
  document.querySelectorAll(".step").forEach(button => {
    button.classList.toggle("active", button.dataset.step === next);
    if (button.dataset.step === next) button.setAttribute("aria-current", "step"); else button.removeAttribute("aria-current");
  });
  if (next === "fields") { renderLayerSettings(); renderFieldList(); renderEditor(); }
  if (next === "settings") { renderGeneralSettings(); renderLayerSettings(); renderVisibility(); }
  if (next === "export") renderExport();
  $("main").focus({ preventScroll: true });
}
function updateSummary() {
  $("summary-title").textContent = state.layerTitle || state.layerName || "Aucune couche";
  $("summary-name").textContent = state.layerName || "Connectez un service WMS";
  $("summary-count").textContent = `${state.fields.length} attribut${state.fields.length > 1 ? "s" : ""}`;
  $("field-count").textContent = state.fields.filter(field => !field.hidden).length;
  const { errors } = buildConfiguration(state);
  $("config-status").textContent = errors.length ? `${errors.length} réglage${errors.length > 1 ? "s" : ""} à compléter avant l'export.` : "✓ La configuration est prête à exporter.";
}
function option(value, label, current) { return `<option value="${escape(value)}"${selected(value, current)}>${escape(label)}</option>`; }
function input(key, label, value, options = {}) {
  const id = `edit-${options.scope || "field"}-${key}`;
  return `<div><label for="${id}">${escape(label)}</label><input id="${id}" data-${options.scope || "field"}="${key}" type="${options.type || "text"}" value="${escape(value)}" ${options.type === "number" ? 'step="any"' : ""} placeholder="${escape(options.placeholder || "")}">${options.hint ? `<p class="hint">${escape(options.hint)}</p>` : ""}</div>`;
}
function checkbox(key, label, value, scope = "field") {
  return `<label class="check"><input type="checkbox" data-${scope}="${key}"${checked(value)}>${escape(label)}</label>`;
}
function fieldSelect(key, label, current, placeholder = "Choisir un attribut") {
  const name = state.fields[selectedField]?.name;
  return `<div><label for="edit-field-${key}">${escape(label)}</label><select id="edit-field-${key}" data-field="${key}">${option("", placeholder, current)}${state.fields.filter(field => field.name !== name).map(field => option(field.name, field.name, current)).join("")}</select></div>`;
}

function renderGeneralSettings() {
  $("general-settings-content").innerHTML = `<div class="grid two">
    ${input("title", "Titre du panneau", state.title, { scope: "layer" })}
    ${input("tooltip", "Infobulle du bouton", state.tooltip, { scope: "layer" })}
    ${input("icon", "Icône du bouton", state.icon, { scope: "layer", placeholder: "list-alt", hint: "Nom d'une icône Glyphicon, par exemple pencil ou map." })}
    ${input("size", "Largeur du panneau (px)", state.size, { scope: "layer", type: "number", placeholder: "420", hint: "Largeur de base ; l'extension ajoute 100 px." })}
    ${input("globalWfsUrl", "URL WFS par défaut", state.globalWfsUrl, { scope: "layer", type: "url" })}
    ${input("globalServerUrl", "URL GeoServer par défaut", state.globalServerUrl, { scope: "layer", type: "url", hint: "Utilisée si aucune URL WFS n'est renseignée." })}
    ${input("geocodingService", "Service de géocodage", state.geocodingService, { scope: "layer", type: "url", placeholder: "https://data.geopf.fr/geocodage" })}
    <div><label for="context-icons">Icônes par contexte</label><textarea id="context-icons" data-layer="iconByContext" placeholder="default=map&#10;12=pencil">${escape(state.iconByContext)}</textarea><p class="hint">Facultatif : une ligne nom ou identifiant de contexte=icône.</p></div>
  </div>`;
}

function renderVisibility() {
  for (const [id, hidden] of [["visible-fields", false], ["hidden-fields", true]]) {
    const fields = state.fields.map((field, index) => ({ field, index })).filter(({ field }) => !!field.hidden === hidden);
    $(id).innerHTML = fields.map(({ field, index }) => option(String(index), field.label && field.label !== field.name ? `${field.label} — ${field.name}` : field.name || "Nouveau champ", "")).join("");
    $(hidden ? "hidden-count" : "visible-count").textContent = fields.length;
  }
  updateTransferButtons();
}
function updateTransferButtons() {
  $("hide-fields").disabled = ![...$("visible-fields").options].filter(option => option.selected).length;
  $("show-fields").disabled = ![...$("hidden-fields").options].filter(option => option.selected).length;
}
function transferFields(hidden) {
  const list = $(hidden ? "visible-fields" : "hidden-fields");
  const indices = [...list.options].filter(option => option.selected).map(entry => Number(entry.value));
  indices.forEach(index => { state.fields[index].hidden = hidden; });
  renderVisibility();
  renderFieldList();
  renderEditor();
  notify(`${indices.length} champ${indices.length > 1 ? "s" : ""} ${hidden ? "masqué" : "visible"}${indices.length > 1 ? "s" : ""} en consultation.`);
}

function renderLayerSettings() {
  $("layer-settings-content").innerHTML = `<div class="grid two">
    ${input("layerName", "Nom technique de la couche WMS", state.layerName, { scope: "layer", placeholder: "workspace:couche" })}
    ${input("serverUrl", "URL GeoServer de la couche", state.serverUrl, { scope: "layer", type: "url" })}
    ${input("wfsUrl", "URL WFS pour l'enregistrement", state.wfsUrl, { scope: "layer", type: "url" })}
    ${input("allowEditRoles", "Rôles d'édition", state.allowEditRoles, { scope: "layer", placeholder: "EDITOR, ROLE_ADMIN", hint: "Séparés par des virgules. Vide : règles par défaut de l'extension." })}
    <div><label for="edit-layer-idField">Attribut identifiant</label><select id="edit-layer-idField" data-layer="idField">${option("", "Défaut : id", state.idField)}${state.fields.map(field => option(field.name, field.name, state.idField)).join("")}</select></div>
    <div><label for="edit-layer-featureFieldLabel">Libellé des entités</label><select id="edit-layer-featureFieldLabel" data-layer="featureFieldLabel">${option("", "Défaut : id", state.featureFieldLabel)}${state.fields.map(field => option(field.name, field.name, state.featureFieldLabel)).join("")}</select></div>
    ${input("deletionRoles", "Rôles de suppression", state.deletionRoles, { scope: "layer", placeholder: "ADMIN" })}
  </div><div class="check-row">${checkbox("allowEdit", "Autoriser l'édition", state.allowEdit, "layer")}${checkbox("allowDelete", "Afficher la suppression", state.allowDelete, "layer")}</div>
  <div class="section-title">ZONE DE COMPÉTENCE</div><label for="area-mode">Restriction spatiale de l'édition</label><select id="area-mode" data-layer="areaMode">${option("none", "Aucune restriction spatiale", state.areaMode)}${option("wkt", "Géométrie WKT", state.areaMode)}${option("url", "Zone fournie par une URL JSON", state.areaMode)}</select>
  ${state.areaMode !== "none" ? `<div class="grid two">${input(state.areaMode === "wkt" ? "areaWkt" : "areaUrl", state.areaMode === "wkt" ? "Géométrie de la zone (WGS84)" : "URL de la zone JSON", state.areaMode === "wkt" ? state.areaWkt : state.areaUrl, { scope: "layer", placeholder: state.areaMode === "wkt" ? "POLYGON((…))" : "https://…", type: state.areaMode === "url" ? "url" : "text" })}<div><label for="area-operation">Relation spatiale</label><select id="area-operation" data-layer="areaOperation">${[["WITHIN", "À l'intérieur de la zone"], ["INTERSECTS", "Intersecte la zone"], ["CONTAINS", "Contient la zone"]].map(([value, label]) => option(value, label, state.areaOperation)).join("")}</select></div>${input("areaAllowedRoles", "Rôles exemptés de restriction spatiale", state.areaAllowedRoles, { scope: "layer", placeholder: "ADMIN, MANAGER" })}</div>` : ""}`;
}

const icons = { string: "Aa", textarea: "¶", number: "#", date: "◷", list: "≡", geocoding: "⌖", "reverse-geocoding": "⌖" };
function renderFieldList() {
  const query = $("field-search").value.trim().toLowerCase();
  const visibleFields = state.fields.map((field, index) => ({ field, index })).filter(({ field }) => !field.hidden);
  if (!state.fields[selectedField] || state.fields[selectedField].hidden) {
    selectedField = visibleFields[0]?.index ?? -1;
  }
  const visible = visibleFields.filter(({ field }) => `${field.name} ${field.label}`.toLowerCase().includes(query));
  $("field-list").innerHTML = visible.length ? visible.map(({ field, index }) => `<button class="field-item${index === selectedField ? " active" : ""}" data-index="${index}"${index === selectedField ? ' aria-current="true"' : ""}><span class="type-icon" aria-hidden="true">${icons[field.type] || "?"}</span><span><strong>${escape(field.label || field.name || "Nouveau champ")}</strong><small>${escape(field.name)}${field.conditions.length ? " · conditionnel" : ""}${field.readOnly ? " · lecture seule" : ""}${field.hidden ? " · masqué en consultation" : ""}</small></span></button>`).join("")
    : `<p class="empty-state">${query ? 'Aucun attribut visible ne correspond à la recherche.' : state.fields.length ? 'Tous les attributs sont masqués. Modifiez leur visibilité dans les paramètres généraux.' : 'Aucun attribut. Ajoutez un champ ou chargez un schéma WFS.'}</p>`;
  updateSummary();
}

function renderEditor() {
  const field = state.fields[selectedField];
  if (!field) {
    $("field-editor").innerHTML = state.fields.length
      ? '<div class="empty-state"><h2>Aucun attribut visible.</h2><p>Rendez un attribut visible dans les paramètres généraux pour le configurer.</p><button class="button primary" data-step="settings">Paramètres généraux</button></div>'
      : '<div class="empty-state"><span class="empty-icon" aria-hidden="true">▦</span><h2>Votre formulaire prend forme ici.</h2><p>Connectez une couche WMS ou ajoutez un premier attribut.</p><button class="button primary" data-action="add-field">+ Ajouter un attribut</button></div>';
    return;
  }
  let specific = "";
  if (field.type === "list") {
    specific = `<div class="section-title">VALEURS DE LA LISTE</div><label for="list-mode">Source des valeurs</label><select id="list-mode" data-field="listMode">${[["static", "Liste de valeurs"], ["infer", "Valeurs existantes de la couche"], ["remote", "Source JSON distante"]].map(([value, label]) => option(value, label, field.listMode)).join("")}</select>`;
    if (field.listMode === "static") specific += `<label for="list-values">Valeurs proposées</label><textarea id="list-values" data-field="listValues" placeholder="Une valeur par ligne">${escape(field.listValues)}</textarea><p class="hint">Une valeur par ligne. Le champ conserve la valeur sélectionnée sous forme de texte.</p>`;
    if (field.listMode === "remote") specific += `<div class="grid two">${input("listUrl", "URL JSON", field.listUrl, { type: "url" })}${input("listField", "Attribut à lire dans la réponse", field.listField)}</div>`;
  }
  if (["geocoding", "reverse-geocoding"].includes(field.type)) specific = `<div class="section-title">COORDONNÉES</div><div class="grid two">${fieldSelect("xField", "Longitude / X", field.xField, "Adresse seulement")}${fieldSelect("yField", "Latitude / Y", field.yField, "Adresse seulement")}</div><p class="hint">Les coordonnées sont enregistrées en WGS84. Les attributs cibles doivent être modifiables.</p>`;
  let validation = "";
  if (TEXT_TYPES.has(field.type)) validation = input("pattern", "Expression régulière", field.pattern, { placeholder: "^[0-9]{5}$", hint: "Sans /…/. Utilisez ^ et $ pour contrôler la totalité du texte." });
  if (field.type === "number") validation = `<div class="grid two">${input("min", "Minimum inclus", field.min, { type: "number", placeholder: "-10" })}${input("max", "Maximum inclus", field.max, { type: "number", placeholder: "20" })}</div><p class="hint">Les décimales sont acceptées. Laissez une borne vide pour ne pas la limiter.</p>`;
  if (validation) validation = `<div class="section-title">VALIDATION</div>${validation}${input("validationMessage", "Message d'erreur personnalisé", field.validationMessage, { placeholder: "Facultatif : message par défaut" })}`;
  const conditions = field.conditions.map((condition, index) => `<div class="condition" data-condition="${index}"><div><label for="condition-${index}-field">${index ? "ET l'attribut" : "Si l'attribut"}</label><select id="condition-${index}-field" data-condition-key="field">${option("", "Choisir…", condition.field)}${state.fields.filter(entry => !entry.hidden && entry.name !== field.name).map(entry => option(entry.name, entry.name, condition.field)).join("")}</select></div><div><label for="condition-${index}-operator">Condition</label><select id="condition-${index}-operator" data-condition-key="operator">${option("eq", "Est égal à", condition.operator)}${option("notEmpty", "Est renseigné", condition.operator)}</select></div><div>${condition.operator === "eq" ? `<label for="condition-${index}-eq">Valeur</label><input id="condition-${index}-eq" data-condition-key="eq" value="${escape(condition.eq)}" placeholder="FOO">` : '<p class="hint">Valeur non vide</p>'}</div><button class="button small outline remove-condition" data-action="remove-condition" data-index="${index}" aria-label="Supprimer la condition ${index + 1}">×</button></div>`).join("");
  $("field-editor").innerHTML = `<div class="editor-heading"><div><h2>${escape(field.label || field.name || "Nouveau champ")}</h2><p class="hint">Type détecté : <code>${escape(field.schemaType || "saisie manuelle")}</code></p></div><span class="badge">${selectedField + 1} / ${state.fields.length}</span></div>
    <div class="grid two">${input("name", "Nom de l'attribut", field.name, { hint: "Doit correspondre à un attribut existant de la couche." })}${input("label", "Libellé affiché", field.label)}</div>
    <label for="field-type">Contrôle de saisie</label><select id="field-type" data-field="type">${TYPES.map(([value, label]) => option(value, label, field.type)).join("")}</select>
    <label for="field-access-mode">Mode de saisie</label><select id="field-access-mode" data-field="accessMode">${option("editable", "Modifiable", field.readOnly || field.editable === false ? "readonly" : "editable")}${option("readonly", "Lecture seule", field.readOnly || field.editable === false ? "readonly" : "editable")}</select><div class="check-row">${checkbox("required", "Obligatoire", field.required)}</div>
    ${input("roles", "Rôles autorisés à modifier ce champ", field.roles, { placeholder: "EDITOR, MANAGER", hint: "Vide : aucun rôle supplémentaire requis. Les droits de couche s'appliquent aussi." })}
    ${specific}${validation}
    <div class="section-title">CONDITIONS DE SAISIE</div><p class="hint">Toutes les conditions doivent être satisfaites (ET). Le champ reste toujours visible.</p><div class="condition-group">${conditions}</div><button class="button small outline" data-action="add-condition">+ Ajouter une condition</button>
    <div class="section-title">VALEURS INITIALES</div><div class="grid two"><div>${checkbox("hasDefault", "Valeur par défaut si le champ est vide", field.hasDefault)}${field.hasDefault ? input("defaultValue", "Valeur par défaut", field.defaultValue, { type: field.type === "number" ? "number" : "text" }) : ""}</div><div>${checkbox("hasValue", "Valeur fixe", field.hasValue)}${field.hasValue ? input("value", "Valeur fixe", field.value, { type: field.type === "number" ? "number" : "text", hint: "Associez-la à Lecture seule : cette valeur prévaut sur la saisie." }) : ""}</div></div>
    <div class="field-footer"><div class="reorder"><button class="button small outline" data-action="move-up"${selectedField === 0 ? " disabled" : ""} aria-label="Monter le champ">↑</button><button class="button small outline" data-action="move-down"${selectedField === state.fields.length - 1 ? " disabled" : ""} aria-label="Descendre le champ">↓</button></div><button class="button small danger" data-action="remove-field">Retirer ce paramétrage</button></div>`;
}

function exportValue() {
  const result = buildConfiguration(state);
  const scope = $("export-scope").value;
  const value = scope === "cfg" ? result.configuration.cfg : scope === "layer"
    ? result.configuration.cfg.layers[state.layerName.trim()] : result.configuration;
  return { ...result, text: JSON.stringify(value, null, 2) };
}
function renderExport() {
  const { text, errors, warnings } = exportValue();
  $("json-preview").textContent = text;
  $("export-count").textContent = `${state.fields.length} champs`;
  $("copy").disabled = errors.length > 0;
  $("download").disabled = errors.length > 0;
  $("export-validation").innerHTML = errors.length ? `<h3 class="error-title">${errors.length} réglage${errors.length > 1 ? "s" : ""} à compléter</h3><ul class="validation-list">${errors.map(error => `<li>${escape(error)}</li>`).join("")}</ul><button class="button outline small" data-step="fields">Revenir aux champs</button>` : '<h3 class="success-title">✓ Configuration valide</h3><p>Les noms, les dépendances et les règles de validation sont cohérents.</p>';
  if (warnings.length) $("export-validation").innerHTML += `<ul class="validation-list warning">${warnings.map(warning => `<li>${escape(warning)}</li>`).join("")}</ul>`;
  updateSummary();
}
function addField() {
  let index = state.fields.length + 1;
  while (state.fields.some(field => field.name === `champ${index}`)) index++;
  state.fields.push(createField(`champ${index}`, ""));
  selectedField = state.fields.length - 1;
  renderLayerSettings(); renderFieldList(); renderEditor();
  $("edit-field-name")?.focus();
}

function renderLayers() {
  const filter = $("layer-search").value.toLowerCase();
  const matches = layers.filter(layer => `${layer.name} ${layer.title}`.toLowerCase().includes(filter));
  const currentLayer = matchWmsLayer(layers, state.layerName)?.name || state.layerName;
  $("layer-select").innerHTML = option("", matches.length ? "Choisir une couche…" : "Aucune couche correspondante", state.layerName)
    + matches.map(layer => option(layer.name, `${layer.title} — ${layer.name}`, currentLayer)).join("");
  $("read-fields").disabled = !!request || !$("layer-select").value;
}
async function selectLayer(signal) {
  const name = $("layer-select").value;
  const layer = layers.find(entry => entry.name === name);
  if (!layer) { $("read-fields").disabled = true; return; }
  state.fields = [];
  state.layerName = name;
  state.layerTitle = layer.title;
  state.typeName = name;
  state.wfsUrl = guessWfsUrl(state.wmsUrl);
  state.idField = "";
  state.featureFieldLabel = "";
  $("layer-description").textContent = layer.abstract;
  $("wfs-url").value = state.wfsUrl;
  $("type-name").value = state.typeName;
  updateSummary();
  const description = await describeLayer(state.wmsUrl, name, signal);
  if (signal.aborted) return;
  if (description) {
    state.wfsUrl = description.wfsUrl;
    state.typeName = description.typeName;
    if (!name.includes(":") && description.typeName.split(":").pop() === name) {
      state.layerName = description.typeName;
      updateSummary();
    }
  }
  $("wfs-url").value = state.wfsUrl;
  $("type-name").value = state.typeName;
  if (state.typeName !== state.layerName) notify("Le nom WFS diffère du nom WMS. Vérifiez que le nom utilisé dans MapStore correspond au type WFS avant l'enregistrement.", "warning");
}

document.addEventListener("click", event => {
  const navigation = event.target.closest("[data-step]");
  if (navigation) showPage(navigation.dataset.step);
  const item = event.target.closest(".field-item");
  if (item) { selectedField = Number(item.dataset.index); renderFieldList(); renderEditor(); }
  const action = event.target.closest("[data-action]");
  if (!action) return;
  const field = state.fields[selectedField];
  switch (action.dataset.action) {
    case "manual-start": $("manual").click(); return;
    case "add-field": addField(); return;
    case "add-condition": field.conditions.push({ field: "", operator: "eq", eq: "" }); break;
    case "remove-condition": field.conditions.splice(Number(action.dataset.index), 1); break;
    case "remove-field": {
      if (field.conditions.length || state.fields.some(entry => entry.conditions.some(condition => condition.field === field.name))) {
        if (!confirm("Retirer ce paramétrage ? Les conditions qui le référencent devront être corrigées. L'attribut reste présent dans la couche.")) return;
      }
      state.fields.splice(selectedField, 1);
      selectedField = Math.max(0, Math.min(selectedField, state.fields.length - 1));
      renderLayerSettings(); break;
    }
    case "move-up": case "move-down": {
      const next = selectedField + (action.dataset.action === "move-up" ? -1 : 1);
      if (next < 0 || next >= state.fields.length) return;
      [state.fields[selectedField], state.fields[next]] = [state.fields[next], state.fields[selectedField]];
      selectedField = next; break;
    }
  }
  renderFieldList(); renderEditor();
});

function onEdit(event) {
  const target = event.target;
  if (event.type === "input" && ["checkbox", "select-one"].includes(target.type)) return;
  if (event.type === "change" && !["checkbox", "select-one"].includes(target.type)) return;
  const value = target.type === "checkbox" ? target.checked : target.value;
  if (target.dataset.layer) {
    state[target.dataset.layer] = value;
    if (target.dataset.layer === "layerName") state.layerTitle = "";
    $("wfs-url").value = state.wfsUrl;
    updateSummary();
    if (target.dataset.layer === "areaMode") renderLayerSettings();
  }
  const field = state.fields[selectedField];
  if (target.dataset.field && field) {
    const key = target.dataset.field;
    if (key === "name") {
      const old = field.name;
      state.fields.forEach(entry => {
        entry.conditions.forEach(condition => { if (condition.field === old) condition.field = value; });
        for (const axis of ["xField", "yField"]) if (entry[axis] === old) entry[axis] = value;
      });
      for (const ref of ["idField", "featureFieldLabel"]) if (state[ref] === old) state[ref] = value;
    }
    if (key === "accessMode") {
      field.readOnly = value === "readonly";
      field.editable = true;
    } else {
      field[key] = value;
    }
    if (key === "name") renderLayerSettings();
    if (["name", "label"].includes(key)) $("field-editor").querySelector("h2").textContent = field.label || field.name || "Nouveau champ";
    renderFieldList();
    if (["type", "listMode", "hasValue", "hasDefault"].includes(key)) renderEditor();
  }
  if (target.dataset.conditionKey && field) {
    field.conditions[Number(target.closest("[data-condition]").dataset.condition)][target.dataset.conditionKey] = value;
    if (target.dataset.conditionKey === "operator") renderEditor();
    updateSummary();
  }
}
$("page-fields").addEventListener("input", onEdit);
$("page-fields").addEventListener("change", onEdit);
$("page-settings").addEventListener("input", onEdit);
$("page-settings").addEventListener("change", onEdit);
$("visible-fields").addEventListener("change", updateTransferButtons);
$("hidden-fields").addEventListener("change", updateTransferButtons);
$("hide-fields").addEventListener("click", () => transferFields(true));
$("show-fields").addEventListener("click", () => transferFields(false));
$("field-search").addEventListener("input", renderFieldList);
$("add-field").addEventListener("click", addField);
$("export-scope").addEventListener("change", renderExport);
$("layer-search").addEventListener("input", renderLayers);
$("layer-select").addEventListener("change", () => runRequest(selectLayer));
async function loadStudioConfig() {
  const select = $("wms-preset");
  try {
    const response = await fetch(new URL("studio-config.json", document.baseURI), { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { services, defaultService } = parseStudioConfig(await response.json());
    wmsServices = services;
    select.innerHTML = option("", "Saisir une autre URL…", "")
      + services.map(service => option(service.id, service.label, "")).join("");
    select.disabled = !services.length;
    // A late configuration response must not replace an URL already entered.
    if (defaultService && !$("wms-url").value.trim()) {
      select.value = defaultService.id;
      $("wms-url").value = defaultService.url;
    }
  } catch (error) {
    select.innerHTML = option("", "Aucun service proposé", "");
    select.disabled = true;
    $("wms-preset-hint").textContent = `Services proposés indisponibles (${error.message}). Vous pouvez saisir une URL manuellement.`;
  }
}
$("wms-preset").addEventListener("change", () => {
  const service = wmsServices.find(entry => entry.id === $("wms-preset").value);
  if (service) {
    cancelRequest();
    $("wms-url").value = service.url;
    $("wms-url").focus();
  }
});
$("wms-url").addEventListener("input", () => {
  $("wms-preset").value = wmsServices.find(service => service.url === $("wms-url").value.trim())?.id || "";
});
loadStudioConfig();

$("source-form").addEventListener("submit", event => {
  event.preventDefault();
  runRequest(async signal => {
    if (state.fields.length && !confirm("Explorer un autre service remplacera le formulaire actuel. Continuer ?")) return;
    const input = $("wms-url").value.trim();
    const fetched = await discoverLayers(input, signal);
    if (signal.aborted) return;
    const initial = new URL(input).searchParams;
    const layerParameter = [...initial].find(([key]) => key.toLowerCase() === "layers")?.[1];
    state = createState();
    state.wmsUrl = serviceUrl(input);
    layers = fetched;
    $("layer-card").hidden = false;
    $("layer-search").value = "";
    $("layers-found").textContent = `${layers.length} couche${layers.length > 1 ? "s" : ""} disponible${layers.length > 1 ? "s" : ""}.`;
    renderLayers();
    const requestedLayer = matchWmsLayer(layers, layerParameter);
    if (requestedLayer) $("layer-select").value = requestedLayer.name;
    else if (layers.length === 1) $("layer-select").value = layers[0].name;
    if ($("layer-select").value) await selectLayer(signal);
    notify(`${layers.length} couche${layers.length > 1 ? "s" : ""} trouvée${layers.length > 1 ? "s" : ""}. Choisissez la couche à configurer.`);
    updateSummary();
  });
});
$("read-fields").addEventListener("click", () => runRequest(async signal => {
  if (!state.layerName) throw new Error("Choisir une couche avant de lire les attributs.");
  if (state.fields.length && !confirm("Recharger les attributs remplacera les réglages des champs. Continuer ?")) return;
  state.wfsUrl = serviceUrl($("wfs-url").value.trim());
  state.typeName = $("type-name").value.trim();
  if (!state.typeName) throw new Error("Renseigner le nom du type WFS.");
  const fields = await discoverFields(state.wfsUrl, state.typeName, signal);
  if (signal.aborted) return;
  state.fields = fields;
  selectedField = 0;
  notify(`${fields.length} attributs récupérés. Les contrôles proposés restent modifiables.`);
  showPage("settings");
}));
$("demo").addEventListener("click", () => {
  if (state.fields.length && !confirm("Charger l'exemple remplacera le formulaire actuel. Continuer ?")) return;
  cancelRequest(); state = demoState(); selectedField = 1;
  $("wms-url").value = state.wmsUrl;
  $("wms-preset").value = "";
  $("layer-card").hidden = true;
  notify("Exemple local chargé : aucun service n'a été interrogé. Remplacez les noms et les URL avant utilisation.");
  showPage("fields");
});
$("manual").addEventListener("click", () => {
  cancelRequest();
  if (!state.layerName) state.layerName = "workspace:couche";
  if (!state.fields.length) { state.fields.push(createField("champ1", "")); selectedField = 0; }
  notify("Renseignez le nom technique de la couche et les noms exacts de ses attributs dans les réglages.");
  showPage("settings");
});
$("download").addEventListener("click", () => {
  const result = exportValue();
  if (result.errors.length) { notify(result.errors[0], "error"); return; }
  const url = URL.createObjectURL(new Blob([result.text + "\n"], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = `panelEditor-${state.layerName.replace(/[^a-z0-9_-]/gi, "-")}.json`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify("Configuration téléchargée.");
});
$("copy").addEventListener("click", async () => {
  const result = exportValue();
  if (result.errors.length) return;
  try { await navigator.clipboard.writeText(result.text); notify("JSON copié dans le presse-papiers."); }
  catch { const range = document.createRange(); range.selectNodeContents($("json-preview")); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); notify("Le presse-papiers n'est pas accessible. Le JSON est sélectionné : utilisez Ctrl+C ou ⌘C.", "warning"); }
});

updateSummary();
