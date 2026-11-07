
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

    return url.protocol === "https:"
      ? url.href
      : "";
  } catch {
    return "";
  }
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
      data.error?.message || "Erreur OpenAI."
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
      error: "Clé OpenAI absente sur Vercel."
    });
  }

  try {
    const body = req.body || {};

    const produit = String(
      body.produit || body.name || ""
    ).trim().slice(0, 200);

    const reference = String(
      body.reference || ""
    ).trim().slice(0, 100);

    if (!produit) {
      return res.status(400).json({
        error: "Nom du produit manquant."
      });
    }

    const recherche = await demanderOpenAI(apiKey, {
      model: "gpt-4.1-mini",
      tools: [{
        type: "web_search_preview",
        search_context_size: "medium"
      }],
      input: `
Recherche des pages officielles contenant
des photographies du produit suivant :

PRODUIT : ${produit}
RÉFÉRENCE : ${reference || "non précisée"}

Priorité :
1. Site officiel du fabricant.
2. Pages produit officielles.
3. Distributeurs reconnus.

Ne confonds jamais les variantes.

Recherche des adresses directes d'images
lorsqu'elles sont publiquement accessibles.

Pour chaque résultat, indique :
- nom du produit ;
- URL directe de l'image si elle est identifiable ;
- URL de la page source ;
- propriétaire ou éditeur ;
- information explicite sur les droits de réutilisation.

Ne suppose jamais qu'une image est libre
pour un usage commercial.

Ne crée aucune URL fictive.
`,
      max_output_tokens: 1500
    });

    const rapport = lireTexte(recherche);

    const extraction = await demanderOpenAI(apiKey, {
      model: "gpt-4.1-mini",
      instructions: `
Tu extrais les photographies mentionnées
dans le rapport documentaire.

Ne crée aucun lien.
Ne devine aucune adresse d'image.

Une photo est autorisée commercialement
uniquement si une permission explicite
est présente dans le rapport.

Réponds uniquement en JSON :

{
  "photos": [
    {
      "image_url": "https://...",
      "source_url": "https://...",
      "produit": "nom exact",
      "droits": "information sur les droits",
      "autorisation_confirmee": false
    }
  ],
  "message": "résumé court"
}
`,
      input: rapport,
      max_output_tokens: 1200
    });

    const resultat = lireJSON(lireTexte(extraction));

    const photos = (
      Array.isArray(resultat.photos)
        ? resultat.photos
        : []
    )
      .filter(item =>
        item &&
        urlSure(item.image_url) &&
        urlSure(item.source_url)
      )
      .slice(0, 8)
      .map(item => ({
        image_url: urlSure(item.image_url),
        source_url: urlSure(item.source_url),
        produit: String(item.produit || produit),
        droits: String(
          item.droits || "Droits à vérifier"
        ),
        autorisation_confirmee:
          item.autorisation_confirmee === true
      }));

    return res.status(200).json({
      produit,
      reference,
      photos,
      message: String(
        resultat.message ||
        (photos.length
          ? "Photos trouvées. Vérifiez les droits."
          : "Aucune photo directe confirmée.")
      )
    });

  } catch (error) {
    console.error("GALAXIE PÊCHE PHOTOS :", error);

    return res.status(500).json({
      error: error.message ||
        "Erreur pendant la recherche des photos."
    });
  }
}

