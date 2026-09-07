// api/webhook-instagram.js - COMBINADO: responde DM + comentario com palavra-chave -> DM
const VERIFY_TOKEN = process.env.IG_WEBHOOK_VERIFY_TOKEN || "jp_shoppew_2026";
const IG_TOKEN = process.env.IG_ACCESS_TOKEN; // token que voce gerou (Instagram Login)
const PAGE_TOKEN = process.env.FACEBOOK_PAGE_TOKEN || process.env.IG_ACCESS_TOKEN; // p/ private_reply

const KEYWORD_LINKS = {
  QUERO: "https://jp-variedades.vercel.app/",
  LINK: "https://jp-variedades.vercel.app/",
};

export default async function handler(req, res) {
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("Webhook verificado");
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Verificacao falhou");
  }

  if (req.method === "POST") {
    try {
      const body = req.body;
      console.log("WEBHOOK RECEBIDO:", JSON.stringify(body).slice(0, 2000));
      if (body.object !== "instagram") return res.status(404).send("Not Found");

      for (const entry of body.entry || []) {
        // 1) COMENTARIOS -> private reply
        for (const change of entry.changes || []) {
          if (change.field === "comments") {
            const comment = change.value || {};
            const commentId = comment.id;
            const text = (comment.text || "").toUpperCase().trim();
            console.log(`Comentario: "${text}" id:${commentId}`);
            const kw = Object.keys(KEYWORD_LINKS).find((k) => text.includes(k));
            if (kw && commentId) await sendPrivateReply(commentId, KEYWORD_LINKS[kw]);
          }
        }
        // 2) DIRECT MESSAGES -> responde no DM
        for (const msgEvent of entry.messaging || []) {
          const senderId = msgEvent.sender?.id;
          const text = msgEvent.message?.text || "";
          // ignora echo do proprio bot
          if (msgEvent.message?.is_echo || !senderId || !text) continue;
          console.log(`DM de ${senderId}: ${text}`);
          const reply = `Oi! Aqui da JP Variedades 👇\nMe fala o que voce procura ou comenta QUERO em qualquer post que te mando o link!`;
          await sendDM(senderId, reply);
        }
      }
      return res.status(200).send("EVENT_RECEIVED");
    } catch (err) {
      console.error("Erro:", err);
      return res.status(200).send("EVENT_RECEIVED");
    }
  }
  return res.status(405).send("Method Not Allowed");
}

async function sendPrivateReply(commentId, link) {
  const url = `https://graph.facebook.com/v21.0/${commentId}/private_replies`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: `Oi! Aqui esta o link que voce pediu 👇\n${link}`, access_token: PAGE_TOKEN }),
  });
  const data = await r.json();
  console.log("private_reply:", JSON.stringify(data).slice(0, 500));
}

async function sendDM(recipientId, text) {
  const url = `https://graph.instagram.com/v23.0/me/messages`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${IG_TOKEN}` },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
  });
  const data = await r.json();
  console.log("sendDM:", JSON.stringify(data).slice(0, 500));
}

export const config = { api: { bodyParser: true } };
