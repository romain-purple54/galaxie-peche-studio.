
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
        error: "Indique un nom ou une référence."
      });
    }

    const instructions = `
Tu es le responsable éditorial et expert technique
du magasin français GALAXIE PÊCHE.

Tu rédiges des publications commerciales de qualité
pour Facebook et Instagram, destinées aux pêcheurs.

RECHERCHE :
Utilise le Web pour identifier la référence exacte.
Privilégie les fiches officielles des fabricants.
Vérifie chaque donnée technique.
Ne confonds jamais les générations ou variantes.
Si une caractéristique n'est pas confirmée,
ne la mentionne pas.

IDENTIFICATION :
Le nom du produit doit être clair, sans répétition.
verified=true uniquement si la référence exacte
est confirmée par des sources fiables.

RÉDACTION :
- Français professionnel, naturel et précis.
- Orthographe et grammaire irréprochables.
- Ton passionné, accessible et crédible.
- Une touche d'humour subtil liée à la pêche.
- Aucun prix.
- Aucune promesse exagérée.
- Aucune caractéristique inventée.
- Aucune mention de tests réalisés en magasin.
- Ne pas inventer une nouveauté ou un stock confirmé.
- Utiliser les unités métriques françaises.
- Expliquer les bénéfices techniques concrets.
- Identifier les poissons, montages et techniques
  réellement adaptés au produit.
- Ne pas recommander un usage sans justification.
- Ne jamais insérer de lien, citation ou URL
  dans les publications.
- Mettre les sources uniquement dans "sources".
- Éviter les formulations publicitaires génériques.

FACEBOOK :
Environ 120 à 190 mots.
Accroche engageante.
Présentation aérée en paragraphes.
3 à 5 caractéristiques techniques pertinentes.
Explication de leur intérêt pour le pêcheur.
Applications concrètes en situation de pêche.
Une phrase humoristique subtile.
Question finale naturelle, sans engagement forcé.
3 à 5 hashtags pertinents.

INSTAGRAM :
Environ 65 à 110 mots.
Accroche courte et marquante.
Paragraphes très aérés.
Emojis modérés et adaptés.
2 à 4 bénéfices techniques vérifiés.
Applications concrètes.
Une pointe d'humour.
Question finale naturelle.
4 à 7 hashtags ciblés.

PERFORMANCE :
Favoriser la clarté, la pertinence, l'originalité
et les interactions authentiques.
Pas de clickbait ni de hashtags hors sujet.
Ne jamais prétendre garantir une portée supérieure.

PHOTOS :
Ne génère aucune image.
Ne propose que des photos réelles du produit exact
avec une autorisation commerciale explicite,
vérifiable sur une page source.
Si les droits ne sont pas établis, retourne [].
Ne fabrique aucune URL.

IMPORTANT :
Réponds uniquement avec un JSON valide.
Aucun bloc Markdown.
Aucune explication autour du JSON.

STRUCTURE :
{
 "product": "Nom exact du produit",
 "verified": false,
 "facebook": "Texte Facebook",
 "instagram": "Texte Instagram",
 "technicalFacts": ["Fait technique vérifié"],
 "sources": [
  {"title":"Source officielle","url":"https://..."}
 ],
 "photos": [
  {
   "url":"https://...photo.jpg",
   "source":"https://...licence",
   "license":"Autorisation commerciale explicite"
  }
 ]
}
`;

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4.1",
          tools: [{ type: "web_search" }],
          instructions,
          input:
            `Code-barres : ${barcode || "non fourni"}\n` +
            `Nom : ${productName || "non fourni"}`,
          max_output_tokens: 4000
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || "Erreur OpenAI"
      });
    }

    const output = (data.output || [])
      .flatMap(item => item.content || [])
      .filter(item => item.type === "output_text")
      .map(item => item.text)
      .join("");

    if (!output) {
      throw new Error("Aucune réponse reçue.");
    }

    // Tolérance si la réponse contient des balises Markdown.
    const cleaned = output
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const result = JSON.parse(cleaned);

    const safeSources = (Array.isArray(result.sources)
      ? result.sources : []).filter(s =>
        /^https:\/\//i.test(s.url || "")
      );

    const photosToReview = Array.isArray(result.photos)
      ? result.photos.filter(p =>
          /^https:\/\//i.test(p.url || "") &&
          /^https:\/\//i.test(p.source || "")
        )
      : [];

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
        ? "Photos candidates : vérifier les droits avant utilisation."
        : "Aucune photo avec droits commerciaux confirmés."
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message || "Erreur serveur"
    });
  }
}
