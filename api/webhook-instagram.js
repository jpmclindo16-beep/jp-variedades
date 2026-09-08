// api/webhook-instagram.js - VERSÃO APENAS DM (FUNCIONANDO)
const VERIFY_TOKEN = process.env.IG_WEBHOOK_VERIFY_TOKEN || "jp_shoppew_2026";
const IG_TOKEN = process.env.IG_ACCESS_TOKEN;
const IG_BUSINESS_ID = "17841467530671368";

const KEYWORDS = [
  "QUERO",
  "EU QUERO",
  "QUERO SIM",
  "QUERO UM",
  "QUERO COMPRAR",
  "LINK",
  "MANDA O LINK",
  "ME MANDA O LINK",
  "CADE O LINK",
  "ONDE COMPRO",
  "COMO COMPRO",
  "COMO COMPRAR",
  "PRECO",
  "PREÇO",
  "QUANTO CUSTA",
  "TEM LINK",
  "MANDA",
];

// Mensagem que vai para o Direct
const DM_MESSAGE = "Já te chamei no Direct 📩 Segue nosso Instagram pra não perder as próximas promoções! 🔥";

const processedCommentIds = new Map();
const MAX_CACHE_SIZE = 1000;
const CACHE_EXPIRY = 10000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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

  if (req.method === "POST") {
    const body = req.body;

    try {
      if (body && (body.object === "instagram" || body.object === "page")) {
        if (body.entry && Array.isArray(body.entry)) {
          for (const entry of body.entry) {
            await processEntry(entry);
          }
        }
      }
      
      return res.status(200).send("EVENT_RECEIVED");
    } catch (err) {
      console.error("Erro no processamento:", err);
      return res.status(200).send("EVENT_RECEIVED");
    }
  }

  if (req.method === "OPTIONS") {
    return res.status(200).send("OK");
  }

  return res.status(405).send("Method Not Allowed");
}

async function processEntry(entry) {
  if (entry.changes && Array.isArray(entry.changes)) {
    for (const change of entry.changes) {
      if (change.field === "comments") {
        await processComment(change.value);
      }
    }
  }
}

async function processComment(comment) {
  try {
    const commentId = comment.id;
    const fromId = comment.from?.id?.toString();
    const text = (comment.text || "").toUpperCase().trim();

    console.log("Comentário recebido:", { commentId, fromId, text });

    if (!commentId || !fromId) {
      console.log("Comentário sem ID ou autor");
      return;
    }

    if (fromId === IG_BUSINESS_ID) {
      console.log("Ignorando comentário do próprio bot");
      return;
    }

    const now = Date.now();
    const lastProcessed = processedCommentIds.get(commentId);
    
    if (lastProcessed && (now - lastProcessed) < CACHE_EXPIRY) {
      console.log(`Comentário processado recentemente, ignorando...`);
      return;
    }

    addToCache(processedCommentIds, commentId, now);

    const hasKeyword = KEYWORDS.some(keyword => text.includes(keyword));
    
    if (hasKeyword) {
      console.log(`Palavra-chave detectada, enviando DM...`);
      
      // Envia DM para o usuário
      const dmSent = await sendDM(fromId, DM_MESSAGE);
      
      if (dmSent) {
        console.log(`✅ DM enviada com sucesso para ${fromId}`);
      } else {
        console.error(`❌ Falha ao enviar DM para ${fromId}`);
      }
    }
  } catch (err) {
    console.error("Erro ao processar comentário:", err);
  }
}

// Função para enviar DM
async function sendDM(recipientId, text) {
  try {
    console.log(`Enviando DM para ${recipientId}...`);
    
    const url = `https://graph.instagram.com/v21.0/me/messages`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json", 
        "Authorization": `Bearer ${IG_TOKEN}` 
      },
      body: JSON.stringify({ 
        recipient: { id: recipientId }, 
        message: { text } 
      }),
    });

    const data = await response.json();
    console.log("Resposta DM:", JSON.stringify(data));
    
    if (!data.error) {
      console.log("✅ DM enviada com sucesso");
      return true;
    }
    
    console.error("Erro DM:", data.error);
    return false;
  } catch (err) {
    console.error("Exceção DM:", err.message);
    return false;
  }
}

function addToCache(cacheMap, item, timestamp) {
  cacheMap.set(item, timestamp);
  
  if (cacheMap.size > MAX_CACHE_SIZE) {
    const firstKey = cacheMap.keys().next().value;
    cacheMap.delete(firstKey);
  }
}

export const config = { 
  api: { 
    bodyParser: true,
    maxDuration: 60,
  } 
};
