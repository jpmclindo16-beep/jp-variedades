// api/webhook-instagram.js - VERSÃO FINAL CORRIGIDA
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

const processedCommentIds = new Map();
const MAX_CACHE_SIZE = 1000;
const CACHE_EXPIRY = 10000;
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

    // NÃO responde imediatamente - processa primeiro
    try {
      if (body && (body.object === "instagram" || body.object === "page")) {
        if (body.entry && Array.isArray(body.entry)) {
          for (const entry of body.entry) {
            await processEntry(entry);
          }
        }
      }
      
      // Só responde depois de processar
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

    const now = Date.now();
    const lastProcessed = processedCommentIds.get(commentId);
    
    if (lastProcessed && (now - lastProcessed) < CACHE_EXPIRY) {
      console.log(`Comentário processado recentemente, ignorando...`);
      return;
    }

    addToCache(processedCommentIds, commentId, now);

    console.log(`Comentário recebido: "${text}" - Processando...`);

    const hasKeyword = KEYWORDS.some(keyword => text.includes(keyword));
    
    if (hasKeyword) {
      console.log(`Palavra-chave detectada, tentando responder...`);
      
      // Tenta responder diretamente
      const replySent = await sendReply(commentId, PUBLIC_REPLY_MESSAGE);
      
      if (replySent) {
        console.log(`✅ Resposta enviada com sucesso!`);
      } else {
        console.error(`❌ Falha ao enviar resposta`);
      }
    }
  } catch (err) {
    console.error("Erro ao processar comentário:", err);
  }
}

// Função única para responder comentário
async function sendReply(commentId, text) {
  console.log(`Iniciando resposta para ${commentId}...`);
  
  // Verifica se temos tokens
  if (!IG_TOKEN && !PAGE_TOKEN) {
    console.error("NENHUM TOKEN CONFIGURADO!");
    return false;
  }
  
  console.log("Tokens disponíveis:", {
    IG_TOKEN: IG_TOKEN ? "✅ Presente" : "❌ Ausente",
    PAGE_TOKEN: PAGE_TOKEN ? "✅ Presente" : "❌ Ausente"
  });

  // Tenta com IG_TOKEN
  if (IG_TOKEN) {
    try {
      console.log(`Tentando com IG_TOKEN...`);
      
      const url = `https://graph.instagram.com/v21.0/${commentId}/replies`;
      console.log(`URL: ${url}`);
      
      const response = await fetch(url, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json", 
          "Authorization": `Bearer ${IG_TOKEN}` 
        },
        body: JSON.stringify({ 
          message: text 
        }),
      });

      console.log(`Status da resposta: ${response.status}`);
      
      const data = await response.json();
      console.log("Resposta IG_TOKEN:", JSON.stringify(data));
      
      if (!data.error) {
        console.log("✅ Sucesso com IG_TOKEN");
        return true;
      }
      
      console.error("Erro IG_TOKEN:", data.error);
    } catch (err) {
      console.error("Exceção IG_TOKEN:", err.message);
    }
  }

  // Tenta com PAGE_TOKEN
  if (PAGE_TOKEN) {
    try {
      console.log(`Tentando com PAGE_TOKEN...`);
      
      const url = `https://graph.facebook.com/v21.0/${commentId}/replies`;
      console.log(`URL: ${url}`);
      
      const response = await fetch(url, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json", 
          "Authorization": `Bearer ${PAGE_TOKEN}` 
        },
        body: JSON.stringify({ 
          message: text 
        }),
      });

      console.log(`Status da resposta: ${response.status}`);
      
      const data = await response.json();
      console.log("Resposta PAGE_TOKEN:", JSON.stringify(data));
      
      if (!data.error) {
        console.log("✅ Sucesso com PAGE_TOKEN");
        return true;
      }
      
      console.error("Erro PAGE_TOKEN:", data.error);
    } catch (err) {
      console.error("Exceção PAGE_TOKEN:", err.message);
    }
  }

  console.error("❌ Todas as tentativas falharam");
  return false;
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
