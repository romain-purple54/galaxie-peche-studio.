
function cleanText(value) {
  return String(value || "")
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)\s]+\)/g, "")
    .replace(/https?:\/\/[^\s)]+/g, "")
    .replace(/【[^】]+】/g, "")
    .replace(/^\s*(Accroche|Caractéristiques techniques|Conclusion|Hashtags)\s*:?\s*$/gim, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function validUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function parseResult(text) {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  return JSON.parse(cleaned);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Méthode non autorisée"
    });
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

    const name = String(body.name || "")
      .trim().slice(0, 200);

    const ean = String(body.ean || "")
      .trim().slice(0, 80);

    if (!name && !ean) {
      return res.status(400).json({
        error: "Indique un nom ou une référence."
      });
    }

    const instructions = `
Tu es le responsable éditorial technique
de GALAXIE PÊCHE, magasin spécialisé
dans les différentes techniques de pêche.

MISSION :
Créer deux publications distinctes,
professionnelles et commercialement pertinentes,
pour Facebook et Instagram.

RECHERCHE TECHNIQUE :
Recherche le produit exact sur Internet.
Priorité absolue aux données du fabricant.

Ne confonds jamais deux générations,
tailles ou variantes d'un même produit.

Une donnée chiffrée ne doit être retenue
que si elle correspond à la référence exacte
et figure dans une source fiable.

Pour chaque donnée technique, recherche
une source précise qui la confirme.

Si deux sources se contredisent,
écarte la caractéristique concernée.

Ne calcule jamais la récupération de ligne
à partir du seul ratio d'un moulinet.

Ne déduis jamais la résistance du frein
à partir du poids ou de la taille du moulinet.

Ne confonds pas le nombre de roulements,
le ratio, la récupération et la capacité
de bobine.

Si une caractéristique est incertaine,
ne l'utilise pas dans les publications.

N'invente aucune technologie, spécification,
performance ou utilisation.

STYLE GALAXIE PÊCHE :
Français naturel, professionnel et précis.
Ton passionné, crédible et accessible.

Humour léger, subtil et intelligent,
en rapport avec le produit ou la pêche.

Aucune phrase absurde ou artificielle.
Aucun jargon inventé.
Aucune exagération commerciale.

Ne jamais écrire :
"Accroche"
"Caractéristiques techniques"
"Conclusion"
comme titres dans les publications.

Ne jamais mettre de lien, URL,
citation ou référence bibliographique
dans facebook ou instagram.

Les sources doivent apparaître
uniquement dans le champ sources.

Ne jamais afficher de prix.
Ne jamais affirmer qu'un produit est
en stock sans confirmation.

APPLICATIONS DE PÊCHE :
Expliquer à quoi sert concrètement le produit.
Préciser les techniques adaptées.
Citer des poissons uniquement lorsque
l'usage est techniquement cohérent.

Ne pas présenter une application
comme exclusive si elle ne l'est pas.

FACEBOOK :
120 à 180 mots environ.
Une accroche engageante.
Des paragraphes aérés.
Des caractéristiques fiables.
Leur intérêt réel sur le terrain.
Des exemples concrets d'utilisation.
Une touche humoristique subtile.
Une question finale pertinente.
3 à 5 hashtags ciblés.

INSTAGRAM :
65 à 110 mots environ.
Une accroche courte et percutante.
Paragraphes courts.
Quelques emojis bien choisis.
2 à 4 informations techniques fiables.
Bénéfices concrets pour le pêcheur.
Humour discret.
Question finale naturelle.
4 à 7 hashtags pertinents.

OPTIMISATION :
Privilégier les interactions authentiques.
Éviter le clickbait et les hashtags génériques.
Aucune promesse de performance algorithmique.

PHOTOS :
Aucune génération d'image IA.
Proposer uniquement des photos réelles
avec une licence commerciale explicite.
Si les droits ne sont pas démontrés,
retourner un tableau vide.

FORMAT :
Répondre uniquement en JSON valide,
sans balises Markdown.

{
 "product": "Nom exact du produit",
 "verified": false,
 "facebook": "Publication Facebook",
 "instagram": "Publication Instagram",
 "technicalFacts": [
   "Caractéristique vérifiée"
 ],
 "sources": [
   {
     "title": "Source",
     "url": "https://..."
   }
 ],
 "photos": []
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
            `Produit : ${name || "non renseigné"}\n` +
            `EAN ou référence : ${ean || "non renseigné"}`,
          max_output_tokens: 4000
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message ||
          "Erreur lors de la recherche"
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

    const result = parseResult(output);

    const sources = (
      Array.isArray(result.sources)
        ? result.sources : []
    ).filter(source =>
      validUrl(source.url)
    );

    const facts = (
      Array.isArray(result.technicalFacts)
        ? result.technicalFacts : []
    ).map(cleanText).filter(Boolean);

    return res.status(200).json({
      product: cleanText(result.product || name),
      verified: result.verified === true,
      facebook: cleanText(result.facebook),
      instagram: cleanText(result.instagram),
      publication: cleanText(result.facebook),
      technicalFacts: facts,
      sources,
      photos: [],
      photosToReview: [],
      photoStatus:
        "Recherche de photos autorisées à finaliser."
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message || "Erreur serveur"
    });
  }
}
