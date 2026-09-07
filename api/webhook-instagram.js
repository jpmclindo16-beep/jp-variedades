// api/webhook-instagram.js - VERSÃO SIMPLIFICADA: SÓ RESPONDE COMENTÁRIOS
const VERIFY_TOKEN = process.env.IG_WEBHOOK_VERIFY_TOKEN || "jp_shoppew_2026";
const IG_TOKEN = process.env.IG_ACCESS_TOKEN;
const PAGE_TOKEN = process.env.FACEBOOK_PAGE_TOKEN || process.env.IG_ACCESS_TOKEN;
const IG_BUSINESS_ID = "17841467530671368";

// Palavras-chave que ativam resposta
const KEYWORDS = ["QUERO", "EU QUERO", "QUERO SIM", "ACEITO"];

// Mensagem de resposta ao comentário
const COMMENT_REPLY_MESSAGE = "Te chamei no privado! Se não chegar, me chama no direct 👇";

const processedCommentIds = new Set();
const MAX_CACHE_SIZE = 500;
const REQUEST_TIMEOUT = 10000;

export default async function handler(req, res) {
  // Configuração CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Verificação do webhook (GET)
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("Webhook verificado com sucesso!");
      return res.status(200).send(challenge);
    }
    
    return res.status(403).send("Verificação falhou");
  }

  // Processamento de eventos (POST)
  if (req.method === "POST") {
    try {
      const body = req.body;
      
      if (!body || (body.object !== "instagram" && body.object !== "page")) {
        return res.status(200).send("EVENT_RECEIVED");
      }

      if (body.entry && Array.isArray(body.entry)) {
        for (const entry of body.entry) {
          await processEntry(entry);
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
  // Processa apenas comentários
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

    // Validações
    if (!commentId || !fromId) {
      console.log("Comentário sem ID ou autor");
      return;
    }

    // Ignora comentários do próprio bot
    if (fromId === IG_BUSINESS_ID) {
      console.log("Ignorando comentário do próprio bot");
      return;
    }

    // Verifica deduplicação
    if (processedCommentIds.has(commentId)) {
      console.log(`Comentário duplicado ignorado: ${commentId}`);
      return;
    }

    // Adiciona ao cache
    addToCache(processedCommentIds, commentId);

    console.log(`Comentário recebido: "${text}" (ID: ${commentId}, Autor: ${fromId})`);

    // Verifica se contém alguma palavra-chave
    const hasKeyword = KEYWORDS.some(keyword => text.includes(keyword));
    
    if (hasKeyword) {
      console.log(`Palavra-chave detectada no comentário ${commentId}`);
      
      // Responde ao comentário
      const replySent = await sendCommentReply(commentId, COMMENT_REPLY_MESSAGE);
      
      if (replySent) {
        console.log(`Resposta enviada com sucesso para o comentário ${commentId}`);
      } else {
        console.error(`Falha ao responder comentário ${commentId}`);
      }
    } else {
      console.log(`Nenhuma palavra-chave encontrada no comentário "${text}"`);
    }
  } catch (err) {
    console.error("Erro ao processar comentário:", err);
  }
}

// Função para responder comentário
async function sendCommentReply(commentId, text) {
  try {
    console.log(`Tentando responder comentário ${commentId}...`);
    
    // Tenta com IG_TOKEN primeiro
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
    
    if (!data.error) {
      console.log("Resposta enviada com sucesso via IG_TOKEN");
      return true;
    }
    
    console.error("Erro com IG_TOKEN:", data.error);
    
    // Fallback para PAGE_TOKEN
    console.log(`Tentando responder comentário ${commentId} com PAGE_TOKEN...`);
    
    const pageUrl = `https://graph.facebook.com/v21.0/${commentId}/replies`;
    const pageResponse = await fetchWithTimeout(pageUrl, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json", 
        "Authorization": `Bearer ${PAGE_TOKEN}` 
      },
      body: JSON.stringify({ 
        message: text 
      }),
    });

    const pageData = await pageResponse.json();
    
    if (!pageData.error) {
      console.log("Resposta enviada com sucesso via PAGE_TOKEN");
      return true;
    }
    
    console.error("Erro com PAGE_TOKEN:", pageData.error);
    return false;
    
  } catch (err) {
    console.error("Exceção ao responder comentário:", err);
    return false;
  }
}

// Função utilitária para fetch com timeout
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

// Função utilitária para adicionar ao cache com limite
function addToCache(cacheSet, item) {
  cacheSet.add(item);
  
  if (cacheSet.size > MAX_CACHE_SIZE) {
    const firstItem = cacheSet.values().next().value;
    cacheSet.delete(firstItem);
  }
}

// Configuração da API
export const config = { 
  api: { 
    bodyParser: true,
    maxDuration: 30,
  } 
};
