
function nettoyer(value) {
  return String(value || "")
    .replace(/【[^】]*】/g, "")
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^\s*(Accroche|Conclusion|Hashtags)\s*:?\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function lireTexte(data) {
  if (data.output_text) return data.output_text;

  return (data.output || [])
    .flatMap(item => item.content || [])
    .filter(item => item.type === "output_text")
    .map(item => item.text || "")
    .join("\n");
}

function lireJSON(texte) {
  const propre = String(texte || "")
    .replace(/```(?:json)?/gi, "")
    .trim();

  try {
    return JSON.parse(propre);
  } catch {
    const debut = propre.indexOf("{");
    const fin = propre.lastIndexOf("}");

    if (debut < 0 || fin <= debut) {
      throw new Error("Réponse JSON invalide.");
    }

    return JSON.parse(propre.slice(debut, fin + 1));
  }
}

function urlSure(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function extraireSources(data) {
  const sources = new Map();

  function ajouter(url, titre) {
    const lien = urlSure(url);
    if (lien && !sources.has(lien)) {
      sources.set(lien, {
        url: lien,
        titre: String(titre || "").slice(0, 150)
      });
    }
  }

  for (const item of data.output || []) {
    for (const source of item.action?.sources || []) {
      ajouter(source.url, source.title);
    }

    for (const contenu of item.content || []) {
      for (const annotation of contenu.annotations || []) {
        if (annotation.type === "url_citation") {
          ajouter(annotation.url, annotation.title);
        }
      }
    }
  }

  return [...sources.values()];
}

async function demanderOpenAI(apiKey, payload) {
  const response = await fetch(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error?.message || "Erreur du service OpenAI."
    );
  }

  return data;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Méthode non autorisée."
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "Clé OPENAI_API_KEY absente sur Vercel."
    });
  }

  try {
    const body = req.body || {};

    const nom = String(
      body.name || body.nom || ""
    ).trim().slice(0, 200);

    const ean = String(
      body.ean || body.barcode || ""
    ).trim().slice(0, 100);

    if (!nom && !ean) {
      return res.status(400).json({
        error: "Indique un nom ou un code-barres."
      });
    }

    const produitRecherche = [nom, ean]
      .filter(Boolean)
      .join(" | ");

    // ÉTAPE 1 : RECHERCHE DOCUMENTAIRE

    const recherche = await demanderOpenAI(apiKey, {
      model: "gpt-4.1-mini",
      tools: [{
        type: "web_search_preview",
        search_context_size: "medium"
      }],
      tool_choice: "auto",
      input: `
Recherche la fiche technique exacte de ce produit :
${produitRecherche}

Priorité au site officiel du fabricant.

Identifie :
- le nom commercial exact ;
- la référence fabricant ;
- les caractéristiques techniques ;
- les techniques de pêche adaptées.

Attention aux variantes, générations et tailles.

Pour chaque caractéristique, indique sa source.
Ne considère pas une donnée comme vérifiée
si elle n'est pas explicitement confirmée.

Présente un rapport documentaire structuré.
Indique les incertitudes.
Ne rédige aucune publication commerciale.
`,
      max_output_tokens: 1800
    });

    const rapport = lireTexte(recherche);
    const sourcesRecherche = extraireSources(recherche);

    if (!rapport.trim()) {
      throw new Error("Recherche documentaire vide.");
    }

    // ÉTAPE 2 : EXTRACTION ET CONTRÔLE

    const analyse = await demanderOpenAI(apiKey, {
      model: "gpt-4.1-mini",
      instructions: `
Tu es un contrôleur technique spécialisé
dans le matériel de pêche.

Tu analyses exclusivement le rapport fourni.

N'invente aucune information.
Ne complète pas les lacunes par tes connaissances.

Une caractéristique est confirmée uniquement
si le rapport donne une preuve explicite
et une source identifiable.

En cas de contradiction ou d'ambiguïté :
exclus la caractéristique.

Le nom et la référence doivent correspondre
exactement à la variante recherchée.

Réponds uniquement avec un objet JSON valide :

{
  "produit": "nom exact ou chaîne vide",
  "reference": "référence exacte ou chaîne vide",
  "identification_confirmee": false,
  "caracteristiques": [
    {
      "texte": "caractéristique",
      "source_url": "https://..."
    }
  ],
  "applications": [
    "application de pêche justifiée"
  ],
  "incertitudes": [
    "information non confirmée"
  ]
}
`,
      input: `
PRODUIT RECHERCHÉ :
${produitRecherche}

RAPPORT DOCUMENTAIRE :
${rapport}

SOURCES REPÉRÉES :
${JSON.stringify(sourcesRecherche)}
`,
      max_output_tokens: 1400
    });

    const fiche = lireJSON(lireTexte(analyse));

    const sourcesParUrl = new Map(
      sourcesRecherche.map(source => [
        source.url,
        source
      ])
    );

    const caracteristiques = (
      Array.isArray(fiche.caracteristiques)
        ? fiche.caracteristiques
        : []
    )
      .filter(item => {
        if (!item || typeof item !== "object") {
          return false;
        }

        const lien = urlSure(item.source_url);

        return (
          Boolean(item.texte) &&
          Boolean(lien) &&
          sourcesParUrl.has(lien)
        );
      })
      .map(item => nettoyer(item.texte));

    const applications = Array.isArray(fiche.applications)
      ? fiche.applications.map(nettoyer).filter(Boolean)
      : [];

    const incertitudes = Array.isArray(fiche.incertitudes)
      ? fiche.incertitudes.map(nettoyer).filter(Boolean)
      : [];

    const identifie = fiche.identification_confirmee === true;

    const produit = identifie
      ? String(fiche.produit || nom || ean)
      : String(nom || ean);

    const reference = identifie
      ? String(fiche.reference || "")
      : "";

    // ÉTAPE 3 : RÉDACTION COMMERCIALE

    let facebook = "";
    let instagram = "";

    if (identifie && caracteristiques.length > 0) {
      const redaction = await demanderOpenAI(apiKey, {
        model: "gpt-4.1-mini",
        instructions: `
Tu rédiges pour GALAXIE PÊCHE,
magasin spécialisé dans les articles de pêche.

Objectif :
deux publications commerciales distinctes.

STYLE :
- Professionnel et techniquement exact.
- Ton naturel, dynamique et accessible.
- Une pointe d'humour subtile.
- Accroche : "NOUVEAUTÉ EN STOCK".
- Pas de prix.
- Pas de promotions inventées.
- Pas de liens ni de citations.
- Pas de rubriques artificielles.
- Pas de caractéristiques non fournies.
- Pas de promesses exagérées.
- Ne confonds pas les techniques de pêche.

FACEBOOK :
120 à 170 mots environ.
Paragraphes aérés.
Bénéfices concrets pour les pêcheurs.
Question finale pertinente.
Quelques emojis.

INSTAGRAM :
65 à 100 mots environ.
Accroche efficace.
Texte court et rythmé.
3 à 5 hashtags pertinents.
Question finale.

Utilise UNIQUEMENT les données fournies.
Ne crée aucun chiffre supplémentaire.

Réponds uniquement avec ce JSON :

{
  "facebook": "texte complet",
  "instagram": "texte complet"
}
`,
        input: JSON.stringify({
          produit,
          reference,
          caracteristiques,
          applications
        }),
        max_output_tokens: 1300
      });

      const textes = lireJSON(lireTexte(redaction));

      facebook = nettoyer(textes.facebook);
      instagram = nettoyer(textes.instagram);
    }

    const avertissements = [...incertitudes];

    if (!identifie) {
      avertissements.unshift(
        "Référence exacte non confirmée."
      );
    }

    if (!caracteristiques.length) {
      avertissements.push(
        "Aucune caractéristique suffisamment documentée."
      );
    }

    return res.status(200).json({
      produit,
      reference,
      facebook,
      instagram,
      caracteristiques,
      sources: sourcesRecherche,
      avertissement: avertissements.join(" "),
      identification_confirmee: identifie
    });

  } catch (error) {
    console.error("GALAXIE PÊCHE :", error);

    return res.status(500).json({
      error: error.message ||
        "Erreur pendant la génération."
    });
  }
}
