
function nettoyer(texte) {
  return String(texte || "")
    .replace(/【[^】]+】/g, "")
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1")
    .replace(/https?:\/\/[^\s)]+/g, "")
    .replace(/^\s*(Accroche|Caractéristiques techniques|Conclusion|Hashtags)\s*:\s*$/gim, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function texteReponse(data) {
  if (data.output_text) return data.output_text;

  return (data.output || [])
    .flatMap(item => item.content || [])
    .filter(item => item.type === "output_text")
    .map(item => item.text || "")
    .join("\n");
}

function extraireJSON(texte) {
  const propre = String(texte || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  try {
    return JSON.parse(propre);
  } catch {
    const debut = propre.indexOf("{");
    const fin = propre.lastIndexOf("}");

    if (debut >= 0 && fin > debut) {
      return JSON.parse(propre.slice(debut, fin + 1));
    }

    throw new Error("Réponse impossible à interpréter.");
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Méthode non autorisée"
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "Clé OpenAI absente dans Vercel."
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
        error: "Indique un produit ou un code-barres."
      });
    }

    const recherche = [nom, ean]
      .filter(Boolean)
      .join(" - ");

    const instructions = `
Tu es responsable de la communication du magasin
GALAXIE PÊCHE, spécialisé dans les articles de pêche.

Tu dois rechercher et vérifier les informations
techniques d'un produit avant de rédiger.

PRIORITÉS ABSOLUES :
1. Exactitude technique.
2. Identification de la référence exacte.
3. Utilité concrète pour les pêcheurs.
4. Communication professionnelle et naturelle.

RECHERCHE :
- Privilégie le site officiel du fabricant.
- Vérifie les caractéristiques de la variante exacte.
- Ne confonds jamais deux générations de produits.
- Ne confonds jamais deux tailles de moulinets.
- Ne déduis pas une caractéristique non confirmée.
- Si une donnée est incertaine, ne la mentionne pas.
- N'invente ni stock, ni promotion, ni disponibilité.
- Ne présente pas une information comme vérifiée
  si aucune source fiable ne la confirme.

RÉDACTION :
- Français naturel et irréprochable.
- Ton professionnel, technique et commercial.
- Une petite pointe d'humour subtile.
- Pas de blagues lourdes.
- Pas de superlatifs excessifs.
- Pas de prix.
- Pas de liens dans les publications.
- Pas de citations bibliographiques dans les textes.
- Pas de titres artificiels comme "Accroche".
- Pas de caractéristiques inventées.
- Utilise les unités françaises.
- Relie les caractéristiques aux techniques de pêche.
- Explique quels pêcheurs peuvent utiliser ce produit.
- Termine par une question pertinente.
- Utilise les hashtags avec modération.
- Évite les promesses sur les algorithmes.

FACEBOOK :
- 120 à 180 mots environ.
- Accroche intéressante dès la première phrase.
- Description technique accessible.
- Applications concrètes en situation de pêche.
- Paragraphes courts.
- Quelques emojis pertinents.
- Invitation naturelle à commenter.

INSTAGRAM :
- 65 à 110 mots environ.
- Accroche courte et percutante.
- Texte aéré et agréable sur mobile.
- 2 à 4 caractéristiques seulement si vérifiées.
- Applications de pêche concrètes.
- 3 à 5 hashtags ciblés.
- Une touche d'humour légère.

Réponds UNIQUEMENT avec un objet JSON valide :

{
  "produit": "nom exact du produit",
  "reference": "référence ou chaîne vide",
  "facebook": "publication Facebook complète",
  "instagram": "publication Instagram complète",
  "caracteristiques": [
    "caractéristique vérifiée 1",
    "caractéristique vérifiée 2"
  ],
  "sources": [
    {
      "titre": "nom de la source",
      "url": "https://..."
    }
  ],
  "avertissement": "précision éventuelle"
}

Les sources sont séparées des publications.
Si le produit est ambigu, indique-le dans
avertissement et évite toute donnée incertaine.
`;

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          instructions,
          input: `Recherche ce produit : ${recherche}`,
          tools: [
            {
              type: "web_search_preview",
              search_context_size: "medium"
            }
          ],
          max_output_tokens: 2200
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error?.message ||
        "Erreur lors de la recherche du produit."
      );
    }

    const contenu = texteReponse(data);

    if (!contenu) {
      throw new Error(
        "Aucun texte reçu du service OpenAI."
      );
    }

    const resultat = extraireJSON(contenu);

    const facebook = nettoyer(resultat.facebook);
    const instagram = nettoyer(resultat.instagram);

    if (!facebook || !instagram) {
      throw new Error(
        "Les deux publications n'ont pas été générées."
      );
    }

    const caracteristiques = Array.isArray(
      resultat.caracteristiques
    )
      ? resultat.caracteristiques
          .map(nettoyer)
          .filter(Boolean)
      : [];

    const sources = Array.isArray(resultat.sources)
      ? resultat.sources.filter(source => {
          try {
            return (
              new URL(source.url).protocol === "https:"
            );
          } catch {
            return false;
          }
        })
      : [];

    return res.status(200).json({
      produit: resultat.produit || nom || ean,
      reference: resultat.reference || "",
      facebook,
      instagram,
      caracteristiques,
      sources,
      avertissement: resultat.avertissement || ""
    });

  } catch (error) {
    console.error("GALAXIE PÊCHE :", error.message);

    return res.status(500).json({
      error: error.message ||
        "Erreur pendant la génération."
    });
  }
}
