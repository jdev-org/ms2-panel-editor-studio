import { serviceUrl } from "./ogc.mjs";

export function parseStudioConfig(config = {}) {
  if (!Array.isArray(config.wmsServices)) throw new Error("wmsServices doit être un tableau.");
  const ids = new Set();
  const services = config.wmsServices.map(entry => {
    if (!entry || typeof entry.id !== "string" || !entry.id.trim()
        || typeof entry.label !== "string" || !entry.label.trim()
        || typeof entry.url !== "string") throw new Error("Chaque service doit avoir un id, un label et une url.");
    if (ids.has(entry.id.trim())) throw new Error("Les identifiants des services doivent être uniques.");
    ids.add(entry.id.trim());
    serviceUrl(entry.url.trim());
    return { id: entry.id.trim(), label: entry.label.trim(), url: entry.url.trim() };
  });
  const defaultService = services.find(service => service.id === config.defaultWmsService);
  if (config.defaultWmsService && !defaultService) throw new Error("Le service WMS par défaut n'existe pas.");
  return { services, defaultService };
}
