
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  res.setHeader("Cache-Control", "no-store");

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return res.status(500).json({
      error: "Clé OpenAI absente sur Vercel"
    });
  }

  try {
    const body = req.body || {};
    const barcode = String(body.ean || body.barcode || "")
      .trim().slice(0, 80);
    const productName = String(body.name || body.productName || "")
      .trim().slice(0, 200);

    if (!barcode && !productName) {
      return res.status(400).json({
        error: "Indique un code-barres ou un nom de produit."
      });
    }

    const instructions = `
Tu es le rédacteur technique de GALAXIE PÊCHE,
un magasin français spécialisé dans la pêche.

MISSION :
Identifier précisément le produit à partir de son
nom, de sa référence ou de son code-barres.

Utilise la recherche Web pour consulter en priorité
les sites officiels des fabricants et les notices.

Vérifie le modèle, sa génération et sa variante.
Ne confonds jamais deux références proches.

RÈGLES TECHNIQUES :
- N'invente aucune caractéristique.
- Ne déduis pas un poids, un ratio, un frein,
  une longueur ou une technologie non confirmés.
- Explique les avantages techniques concrets.
- Relie le produit aux pratiques de pêche adaptées.
- Distingue les faits des conseils d'utilisation.
- Si le modèle reste incertain, indique-le clairement.
- Ne mentionne jamais de prix.

STYLE :
Professionnel, précis, passionné et accessible.
Ajoute une pointe d'humour subtil lié à la pêche.
Évite les exagérations et les promesses irréalistes.
Ne présente pas un produit comme testé en magasin
si aucune information ne le confirme.

FACEBOOK :
Rédige une publication développée avec :
- Une accroche forte.
- Les caractéristiques techniques vérifiées.
- Les bénéfices pour le pêcheur.
- Les techniques de pêche adaptées.
- Une touche d'humour.
- Une question finale naturelle.
- La mention GALAXIE PÊCHE.
- Quelques hashtags pertinents.

INSTAGRAM :
Rédige une publication différente avec :
- Une accroche courte et engageante.
- Des paragraphes aérés.
- Les principaux bénéfices du produit.
- Des emojis utilisés avec modération.
- Une question ou invitation à commenter.
- Des hashtags spécifiques à la pêche.

PHOTOS :
Recherche des photos réelles du modèle exact.
Une photo visible sur Internet n'est pas forcément
autorisée pour une utilisation commerciale.

Ne propose une image que si une licence explicite
ou une autorisation commerciale vérifiable existe.
Sinon, retourne un tableau vide.
Ne fabrique jamais d'URL d'image.
Ne génère aucune illustration IA.

Réponds uniquement avec un objet JSON valide :
{
 "product": "Nom exact du produit ou référence incertaine",
 "verified": false,
 "facebook": "Publication Facebook",
 "instagram": "Publication Instagram",
 "technicalFacts": [
   "Caractéristique vérifiée"
 ],
 "sources": [
   {
     "title": "Nom de la source",
     "url": "https://..."
   }
 ],
 "photos": [
   {
     "url": "https://...image.jpg",
     "source": "https://...page-source",
     "license": "Autorisation commerciale explicite"
   }
 ]
}

La valeur verified est true uniquement lorsque
l'identification précise est confirmée.
N'ajoute aucune donnée non vérifiée.
`;

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4.1",
          tools: [{ type: "web_search" }],
          instructions,
          input:
            `Code-barres : ${barcode || "non fourni"}\n` +
            `Nom : ${productName || "non fourni"}`,
          text: {
            format: { type: "json_object" }
          },
          max_output_tokens: 3500
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message ||
          "Erreur lors de la recherche OpenAI"
      });
    }

    const output = (data.output || [])
      .flatMap(item => item.content || [])
      .filter(item => item.type === "output_text")
      .map(item => item.text)
      .join("");

    if (!output) {
      throw new Error("Aucun texte reçu d'OpenAI.");
    }

    const result = JSON.parse(output);

    const safeSources = (Array.isArray(result.sources)
      ? result.sources : []).filter(s =>
        /^https:\/\//i.test(s.url || "")
      );

    // Les images doivent être contrôlées avant
    // leur réutilisation commerciale.
    // On ne publie aucune URL photo automatiquement.
    const photosToReview = Array.isArray(result.photos)
      ? result.photos : [];

    return res.status(200).json({
      product: result.product || productName,
      verified: result.verified === true,
      facebook: result.facebook || "",
      instagram: result.instagram || "",
      publication: result.facebook || "",
      technicalFacts: result.technicalFacts || [],
      sources: safeSources,
      photos: [],
      photosToReview,
      photoStatus: photosToReview.length
        ? "Photos candidates à vérifier avant utilisation"
        : "Aucune photo autorisée confirmée"
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message || "Erreur serveur"
    });
  }
}
