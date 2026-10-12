# Panel Editor Studio

Une interface en français pour générer la configuration de l'extension
`panelEditor` de MapStore. Application **entièrement statique**, compatible avec
GitHub Pages. Vite sert au développement et à la compilation ; aucune dépendance
de production ni serveur applicatif n'est nécessaire.

## Utilisation

1. Coller l'URL WMS du service ou d'une requête GetMap et explorer les couches.
2. Choisir la couche et lire ses attributs. Le studio utilise `DescribeLayer`
   quand disponible, puis WFS `DescribeFeatureType` (XSD ou JSON).
3. Configurer les contrôles, les rôles, les valeurs et les conditions de saisie.
4. Copier ou télécharger le JSON du plugin, de `cfg` ou de la couche uniquement.

Le bouton **Essayer un exemple** fonctionne sans service distant. Le mode
**Commencer manuellement** permet de configurer une couche dont le schéma n'est
pas accessible. Les réglages ne sont pas persistés : télécharger le JSON avant
de fermer ou recharger l'onglet.

Les contrôles proposés sont texte, texte long, nombre, date, liste et géocodage.
Les conditions multiples sont combinées avec un **ET logique** ; les attributs
restent visibles. Le studio prend en charge `pattern` pour le texte, `min`/`max`
pour les nombres, `defaultValue`, `value`, `readOnly` et les droits par rôle.
Les erreurs de configuration empêchent l'export, notamment les regex incorrectes,
les bornes inversées, les attributs manquants et les cycles de dépendance.

La sortie complète est `{ "name": "panelEditor", "cfg": { ... } }`, à placer
dans `plugins.desktop` du `localConfig.json` MapStore. Les noms des attributs et
de la couche doivent correspondre à ceux utilisés dans MapStore et le WFS.
Les champs automatiques et les restrictions spatiales ne sont pas configurables
dans cette première version du studio.

## GitHub Pages

1. Pousser le projet sur la branche `main` de votre dépôt GitHub.
2. Dans **Settings → Pages → Build and deployment**, choisir **GitHub Actions**.
3. Le workflow `.github/workflows/pages.yml` installe les outils, vérifie le code,
   compile le site et publie `dist/`.
   Il peut aussi être lancé manuellement depuis l'onglet **Actions**.

Le site fonctionne à `https://<compte>.github.io/ms2-panel-editor-studio/` comme
sur un domaine personnalisé : les ressources utilisent des chemins relatifs.
Aucun secret ni serveur applicatif n'est nécessaire.

Workflow conforme au [déploiement personnalisé GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Services WMS/WFS

Les requêtes sont des lectures HTTP effectuées directement par le navigateur.
Le serveur cartographique doit autoriser **CORS** pour l'origine du studio.
Depuis GitHub Pages, les services doivent être accessibles en **HTTPS**.
Un WMS seul ne fournit pas les attributs : un WFS associé est nécessaire pour
la découverte. L'URL WFS et le nom du type peuvent être corrigés manuellement.
Les géométries sont exclues ; les types non reconnus sont proposés en texte.
Les schémas complexes nécessitant des imports XSD externes peuvent demander une
saisie manuelle. Les services demandant une session authentifiée ne sont pas
pris en charge ; les paramètres personnalisés de l'URL sont conservés.

Le studio ne lance aucune transaction WFS et ne modifie aucune donnée distante.
La configuration exportée nécessitera un service **WFS-T** et ses droits pour
enregistrer les attributs depuis MapStore.

Références : [WMS et DescribeLayer](https://docs.geoserver.org/latest/en/user/services/wms/reference/),
[WFS et DescribeFeatureType](https://docs.geoserver.org/main/en/user/services/wfs/reference/).

## Développement local

Installer Vite et démarrer le serveur de développement :

```sh
npm install
npm run dev
```

Ouvrir `http://127.0.0.1:5173`. `npm start` lance le même serveur.
Vite recharge automatiquement l'interface lors des modifications.
Utiliser une version récente de Node.js 22 (au moins 22.12).

Compiler puis prévisualiser la version destinée à GitHub Pages :

```sh
npm run build
npm run preview
```

La prévisualisation est disponible à `http://127.0.0.1:4173` ; les fichiers
déployables sont dans `dist/`. `base: "./"` conserve la compatibilité avec le
sous-chemin du dépôt GitHub Pages, selon la [documentation Vite](https://vite.dev/guide/build#relative-base).

Lancer les vérifications :

```sh
npm run check
npm test
```

Pour vérifier aussi le parsing XML avec le navigateur, servir la racine du dépôt
(`python3 -m http.server 8080`) et ouvrir `http://localhost:8080/tests/browser.html`.
Ces tests utilisent des réponses WMS/WFS locales, sans appel à un service distant.

`site/core.mjs` construit et vérifie le JSON ; `site/ogc.mjs` découvre les couches
et les schémas ; `site/app.mjs` gère l'interface. Les tests utilisent uniquement
le runner intégré à Node.js. La licence du dépôt est conservée.

## Couche de test locale

Démarrer le Studio avec `npm run dev`, puis coller cette URL dans **La couche** :

```text
http://localhost:82/geoserver/data/wms?service=WMS&version=1.1.0&request=GetMap&layers=data%3Aavis_urbanisme
```

Explorer le service et lire les attributs de `avis_urbanisme`. Le Studio associe
le nom WMS non préfixé au type WFS `data:avis_urbanisme`. Vérifier ensuite les
listes Visibles/Masqués, les paramètres généraux et le JSON exporté. La liste
« Attributs » affiche uniquement les champs visibles. GeoServer doit être en
cours d'exécution et autoriser CORS depuis l'origine du Studio.

## Services WMS proposés par défaut

Modifier `site/public/studio-config.json` pour personnaliser le sélecteur de
l'étape **La couche** :

```json
{
  "defaultWmsService": "local",
  "wmsServices": [
    {
      "id": "local",
      "label": "Mon GeoServer",
      "url": "http://localhost:82/geoserver/data/wms"
    }
  ]
}
```

`id` doit être unique, `label` est le nom affiché et `url` accepte une URL de
service ou de requête GetMap. `defaultWmsService` est facultatif : il préremplit
l'URL sans lancer de requête WMS. L'utilisateur peut toujours saisir une autre URL.
Un tableau `wmsServices` vide désactive les suggestions.

Vite copie ce fichier dans `dist/studio-config.json`, conservé comme configuration
modifiable après compilation. Pour GitHub Pages, adapter les URLs aux services
HTTPS accessibles aux utilisateurs ; `localhost` désigne leur propre machine.
