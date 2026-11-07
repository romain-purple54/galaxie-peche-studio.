
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

async function detecterVariantes(apiKey, recherche) {
  const resultat = await demanderOpenAI(apiKey, {
    model: "gpt-4.1-mini",
    tools: [{
      type: "web_search_preview",
      search_context_size: "medium"
    }],
    input: `
Tu identifies les variantes d'un produit de pêche.

PRODUIT :
${recherche}

Recherche en priorité sur le site du fabricant.

Identifie les références exactes appartenant
à la même famille et à la même génération.

Ne mélange pas différentes générations.
N'invente aucune référence.

Présente :
- nom exact ;
- référence fabricant ;
- différences entre variantes ;
- sources consultées.

Si la recherche correspond déjà à une
référence précise, signale-le.

Ne rédige aucune publication.
`,
    max_output_tokens: 900
  });

  const rapport = lireTexte(resultat);

  const analyse = await demanderOpenAI(apiKey, {
    model: "gpt-4.1-mini",
    instructions: `
Tu extrais les variantes documentées.

Ne crée aucune variante.
Ne confonds pas taille, génération et ratio.

Réponds uniquement en JSON :

{
  "variantes": [
    {
      "nom": "nom exact",
      "reference": "référence fabricant",
      "description": "différence technique courte"
    }
  ],
  "ambiguite": false
}
`,
    input: rapport,
    max_output_tokens: 800
  });

  const fiche = lireJSON(lireTexte(analyse));

  const variantes = Array.isArray(fiche.variantes)
    ? fiche.variantes
        .filter(v => v && v.nom)
        .slice(0, 12)
        .map(v => ({
          nom: String(v.nom).slice(0, 150),
          reference: String(v.reference || "").slice(0, 100),
          description: String(v.description || "").slice(0, 200)
        }))
    : [];

  return {
    variantes,
    ambiguite: fiche.ambiguite === true,
    sources: extraireSources(resultat)
  };
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

    const variante = String(
      body.variante || ""
    ).trim().slice(0, 200);

    if (!nom && !ean) {
      return res.status(400).json({
        error: "Indique un nom ou un code-barres."
      });
    }

    const produitInitial = [nom, ean]
      .filter(Boolean)
      .join(" | ");

    // MODE DÉTECTION DES VARIANTES
    // Activé par la future interface index.html.

    if (body.action === "variantes") {
      const resultat = await detecterVariantes(
        apiKey,
        produitInitial
      );

      return res.status(200).json({
        selection_variante: true,
        ...resultat
      });
    }

    // MODE GÉNÉRATION
    // Compatible avec l'interface actuelle.

    const produitRecherche = [
      variante || nom,
      ean
    ].filter(Boolean).join(" | ");

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

Priorité absolue au site officiel du fabricant.

Identifie :
- nom commercial exact ;
- référence fabricant exacte ;
- taille et génération ;
- ratio et version éventuelle (HG, XG, PG...) ;
- caractéristiques techniques ;
- techniques de pêche adaptées.

RÈGLE ESSENTIELLE :
Une version 2500 n'est pas automatiquement
une version 2500 HG ou 2500 XG.

Ne transfère jamais une caractéristique
d'une variante vers une autre.

Si la variante exacte n'est pas confirmée,
indique clairement l'ambiguïté.

Pour chaque caractéristique, donne sa source.

Ne considère pas une donnée comme vérifiée
sans confirmation explicite.

Présente un rapport documentaire structuré.
Ne rédige aucune publication commerciale.
`,
      max_output_tokens: 1900
    });

    const rapport = lireTexte(recherche);
    const sourcesRecherche = extraireSources(recherche);

    if (!rapport.trim()) {
      throw new Error("Recherche documentaire vide.");
    }

    // ÉTAPE 2 : CONTRÔLE TECHNIQUE

    const analyse = await demanderOpenAI(apiKey, {
      model: "gpt-4.1-mini",
      instructions: `
Tu es contrôleur technique de matériel de pêche.

Analyse exclusivement le rapport fourni.
N'invente aucune information.

Une caractéristique n'est confirmée que si
elle concerne exactement la référence recherchée
et possède une source identifiable.

Ne confonds jamais :
- 2500 et 2500 HG ;
- HG et XG ;
- différentes générations ;
- différentes tailles ;
- différentes références fabricant.

Si la variante recherchée est ambiguë,
identification_confirmee doit être false.

Exclus les caractéristiques contradictoires.

Réponds uniquement avec un JSON valide :

{
  "produit": "nom exact ou chaîne vide",
  "reference": "référence exacte ou chaîne vide",
  "identification_confirmee": false,
  "caracteristiques": [
    {
      "texte": "caractéristique exacte",
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

RAPPORT :
${rapport}

SOURCES :
${JSON.stringify(sourcesRecherche)}
`,
      max_output_tokens: 1500
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

    const identifie =
      fiche.identification_confirmee === true &&
      Boolean(String(fiche.reference || "").trim());

    const produit = identifie
      ? String(fiche.produit || variante || nom || ean)
      : String(variante || nom || ean);

    const reference = identifie
      ? String(fiche.reference || "")
      : "";

    // ÉTAPE 3 : PUBLICATIONS

    let facebook = "";
    let instagram = "";

    if (identifie && caracteristiques.length > 0) {
      const redaction = await demanderOpenAI(apiKey, {
        model: "gpt-4.1-mini",
        instructions: `
Tu rédiges pour GALAXIE PÊCHE,
magasin spécialisé dans les articles de pêche.

Produis deux publications commerciales distinctes.

STYLE :
- Professionnel et techniquement exact.
- Naturel, dynamique, accessible.
- Une pointe d'humour subtile.
- Commence par "NOUVEAUTÉ EN STOCK".
- Aucun prix.
- Aucune promotion inventée.
- Aucun lien ou citation.
- Aucune rubrique artificielle.
- Aucun chiffre non fourni.
- Aucun mélange entre variantes.

Explique concrètement à quels types
de pêcheurs et de techniques le produit convient.

FACEBOOK :
120 à 170 mots environ.
Paragraphes aérés.
Avantages concrets.
Question finale pertinente.
Quelques emojis.

INSTAGRAM :
65 à 100 mots environ.
Accroche dynamique.
3 à 5 hashtags pertinents.
Question finale.

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
        "Référence exacte non confirmée. Sélectionnez la variante précise avant publication."
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
