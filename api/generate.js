
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "Clé OpenAI non configurée" });
  }

  try {
    const { ean: barcode, name: productName } = req.body || {};

    if (!barcode && !productName) {
      return res.status(400).json({
        error: "Indique un code-barres ou un nom de produit."
      });
    }

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          tools: [{ type: "web_search" }],
          instructions: `Tu es un expert en matériel de pêche
et rédacteur pour GALAXIE PÊCHE.

Rédige une publication Facebook professionnelle
en français, avec le titre "NOUVEAUTÉ EN STOCK".

Présente les caractéristiques techniques du produit,
ses avantages et les techniques de pêche adaptées.

Explique à quels pêcheurs il s'adresse et dans
quelles situations il est particulièrement utile.

N'invente jamais de caractéristiques techniques.
Si une donnée n'est pas vérifiée, ne la mentionne pas.

Adopte un ton professionnel, accessible et commercial.
Ne mentionne aucun prix.
Termine par une invitation à découvrir le produit
chez GALAXIE PÊCHE et quelques hashtags pertinents.`,
          input: `Code-barres : ${barcode || "Non renseigné"}
Nom du produit : ${productName || "Non renseigné"}`
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || "Erreur OpenAI"
      });
    }

    const publication = (data.output || [])
      .flatMap(item => item.content || [])
      .filter(item => item.type === "output_text")
      .map(item => item.text)
      .join("\n");

    return res.status(200).json({ publication });
  } catch (error) {
    return res.status(500).json({
      error: "Erreur lors de la génération."
    });
  }
}
