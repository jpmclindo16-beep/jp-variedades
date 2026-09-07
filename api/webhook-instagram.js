// api/webhook-instagram.js
// Endpoint de webhook do Instagram: recebe comentários e responde no Direct
// automaticamente quando o comentário contém uma palavra-chave.
//
// Rota final na Vercel: https://SEU-PROJETO.vercel.app/api/webhook-instagram

// ==== CONFIGURAÇÃO ====
const VERIFY_TOKEN = process.env.IG_WEBHOOK_VERIFY_TOKEN; // você inventa uma string qualquer, ex: "jp_shoppew_2026"
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN; // o mesmo token de longa duração que você já usa pro bot de ofertas

// Mapa de palavra-chave -> link que deve ser enviado
// Adicione quantas palavras-chave quiser aqui
const KEYWORD_LINKS = {
  QUERO: "https://seusite.com/produto-1",
  LINK: "https://seusite.com/produto-1",
  // "OUTRAPALAVRA": "https://seusite.com/produto-2",
};

export default async function handler(req, res) {
  // ---------- 1. VERIFICAÇÃO DO WEBHOOK (Meta chama isso 1x ao configurar) ----------
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("Webhook verificado com sucesso");
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Verificação falhou");
  }

  // ---------- 2. RECEBIMENTO DE EVENTOS (novos comentários) ----------
  if (req.method === "POST") {
    try {
      const body = req.body;

      if (body.object !== "instagram") {
        return res.status(404).send("Not Found");
      }

      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field === "comments") {
            const comment = change.value;
            const commentId = comment.id;
            const commentText = (comment.text || "").toUpperCase().trim();

            console.log(`Comentário recebido: "${commentText}" (id: ${commentId})`);

            // Verifica se alguma palavra-chave está contida no comentário
            const keywordFound = Object.keys(KEYWORD_LINKS).find((kw) =>
              commentText.includes(kw)
            );

            if (keywordFound) {
              const link = KEYWORD_LINKS[keywordFound];
              await sendPrivateReply(commentId, link);
            }
          }
        }
      }

      // Sempre responder 200 rápido pra Meta não re-enviar o evento
      return res.status(200).send("EVENT_RECEIVED");
    } catch (err) {
      console.error("Erro processando webhook:", err);
      // Mesmo com erro interno, responde 200 pra evitar reenvio em loop
      return res.status(200).send("EVENT_RECEIVED");
    }
  }

  return res.status(405).send("Method Not Allowed");
}

// ---------- 3. ENVIO DA PRIVATE REPLY ----------
async function sendPrivateReply(commentId, link) {
  const url = `https://graph.facebook.com/v21.0/${commentId}/private_replies`;

  const message = `Oi! Aqui está o link que você pediu 👇\n${link}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      access_token: PAGE_ACCESS_TOKEN,
    }),
  });

  const data = await response.json();

  if (data.error) {
    console.error("Erro ao enviar private reply:", data.error);
  } else {
    console.log("Private reply enviada com sucesso:", data);
  }
}

// Necessário pra Vercel não fazer parsing estranho do body em alguns casos
export const config = {
  api: {
    bodyParser: true,
  },
};
