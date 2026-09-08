// api/webhook-instagram.js - VERSÃO CORRIGIDA PARA ENVIO DE RESPOSTA
const VERIFY_TOKEN = process.env.IG_WEBHOOK_VERIFY_TOKEN || "jp_shoppew_2026";
const IG_TOKEN = process.env.IG_ACCESS_TOKEN;
const PAGE_TOKEN = process.env.FACEBOOK_PAGE_TOKEN;
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

const PUBLIC_REPLY_MESSAGE = "Já te chamei no Direct 📩 Segue nosso Instagram pra não perder as próximas promoções! 🔥";

const processedCommentIds = new Set();
const MAX_CACHE_SIZE = 500;
const REQUEST_TIMEOUT = 15000;

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

    // Responde 200 imediatamente
    res.status(200).send("EVENT_RECEIVED");

    // Processa de forma assíncrona
    try {
      if (body && (body.object === "instagram" || body.object === "page")) {
        if (body.entry && Array.isArray(body.entry)) {
          for (const entry of body.entry) {
            await processEntry(entry);
          }
        }
      }
    } catch (err) {
      console.error("Erro no processamento:", err);
    }

    return;
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

    console.log("Dados do comentário:", {
      commentId,
      fromId,
      text,
      mediaId: comment.media?.id
    });

    if (!commentId || !fromId) {
      console.log("Comentário sem ID ou autor");
      return;
    }

    if (fromId === IG_BUSINESS_ID) {
      console.log("Ignorando comentário do próprio bot");
      return;
    }

    if (processedCommentIds.has(commentId)) {
      console.log(`Comentário duplicado ignorado: ${commentId}`);
      return;
    }

    addToCache(processedCommentIds, commentId);

    console.log(`Comentário recebido: "${text}"`);

    const hasKeyword = KEYWORDS.some(keyword => text.includes(keyword));
    
    if (hasKeyword) {
      console.log(`Palavra-chave detectada, tentando responder...`);
      
      // Tenta com IG_TOKEN primeiro
      let replySent = await sendReplyWithIGToken(commentId, PUBLIC_REPLY_MESSAGE);
      
      // Se falhar, tenta com PAGE_TOKEN
      if (!replySent) {
        console.log("Tentando com PAGE_TOKEN...");
        replySent = await sendReplyWithPageToken(commentId, PUBLIC_REPLY_MESSAGE);
      }
      
      // Se ambos falharem, tenta endpoint alternativo
      if (!replySent) {
        console.log("Tentando endpoint alternativo...");
        replySent = await sendReplyAlternative(commentId, PUBLIC_REPLY_MESSAGE);
      }
      
      if (replySent) {
        console.log(`✅ Resposta enviada com sucesso!`);
      } else {
        console.error(`❌ Todas as tentativas falharam`);
      }
    }
  } catch (err) {
    console.error("Erro ao processar comentário:", err);
  }
}

// Tenta com IG_TOKEN
async function sendReplyWithIGToken(commentId, text) {
  try {
    console.log(`Usando IG_TOKEN para responder ${commentId}`);
    
    const url = `https://graph.instagram.com/v21.0/${commentId}/replies`;
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json", 
        "Authorization": `Bearer ${IG_TOKEN}` 
      },
      body: JSON.stringify({ 
        message: text 
      }),
    });

    const data = await response.json();
    console.log("Resposta IG_TOKEN:", JSON.stringify(data));
    
    if (!data.error) {
      return true;
    }
    
    console.error("Erro IG_TOKEN:", data.error);
    return false;
  } catch (err) {
    console.error("Exceção IG_TOKEN:", err);
    return false;
  }
}

// Tenta com PAGE_TOKEN
async function sendReplyWithPageToken(commentId, text) {
  try {
    console.log(`Usando PAGE_TOKEN para responder ${commentId}`);
    
    const url = `https://graph.facebook.com/v21.0/${commentId}/replies`;
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json", 
        "Authorization": `Bearer ${PAGE_TOKEN}` 
      },
      body: JSON.stringify({ 
        message: text 
      }),
    });

    const data = await response.json();
    console.log("Resposta PAGE_TOKEN:", JSON.stringify(data));
    
    if (!data.error) {
      return true;
    }
    
    console.error("Erro PAGE_TOKEN:", data.error);
    return false;
  } catch (err) {
    console.error("Exceção PAGE_TOKEN:", err);
    return false;
  }
}

// Tenta endpoint alternativo
async function sendReplyAlternative(commentId, text) {
  try {
    console.log(`Usando endpoint alternativo para ${commentId}`);
    
    // Tenta com o endpoint do Graph API v20.0
    const url = `https://graph.facebook.com/v20.0/${commentId}/replies`;
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json", 
        "Authorization": `Bearer ${PAGE_TOKEN}` 
      },
      body: JSON.stringify({ 
        message: text 
      }),
    });

    const data = await response.json();
    console.log("Resposta alternativa:", JSON.stringify(data));
    
    if (!data.error) {
      return true;
    }
    
    console.error("Erro alternativa:", data.error);
    return false;
  } catch (err) {
    console.error("Exceção alternativa:", err);
    return false;
  }
}

async function fetchWithTimeout(url, options = {}, timeout = REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

function addToCache(cacheSet, item) {
  cacheSet.add(item);
  
  if (cacheSet.size > MAX_CACHE_SIZE) {
    const firstItem = cacheSet.values().next().value;
    cacheSet.delete(firstItem);
  }
}

export const config = { 
  api: { 
    bodyParser: true,
    maxDuration: 60,
  } 
};
                  
