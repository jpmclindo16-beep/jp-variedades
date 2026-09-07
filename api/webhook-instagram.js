// api/webhook-instagram.js - VERSÃO CORRIGIDA (sem duplicidade)
const VERIFY_TOKEN = process.env.IG_WEBHOOK_VERIFY_TOKEN || "jp_shoppew_2026";
const PAGE_TOKEN = process.env.FACEBOOK_PAGE_TOKEN;
const IG_BUSINESS_ID = "17841467530671368";

// Todas as palavras/variações que disparam a resposta automática.
// Adicione novas palavras aqui, sempre em MAIÚSCULO.
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

// Resposta pública no próprio comentário (o ManyChat cuida do envio do link no Direct)
const PUBLIC_REPLY_MESSAGE = "Já te chamei no Direct 📩 Segue nosso Instagram pra não perder as próximas promoções! 🔥";

// Cache de deduplicação (best-effort — não sobrevive a cold start,
// mas ajuda quando a mesma instância recebe reenvio rápido da Meta)
const processedCommentIds = new Set();
const MAX_CACHE_SIZE = 500;
const REQUEST_TIMEOUT = 10000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Verificação do webhook (GET)
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

  // Processamento de eventos (POST)
  if (req.method === "POST") {
    const body = req.body;

    // *** PONTO CRÍTICO DA CORREÇÃO ***
    // Responde 200 IMEDIATAMENTE, antes de processar qualquer coisa.
    // Isso evita que a Meta ache que a requisição falhou e reenvie o mesmo evento.
    res.status(200).send("EVENT_RECEIVED");

    // Processa de forma assíncrona (não bloqueia a resposta)
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

  // Método OPTIONS para CORS
  if (req.method === "OPTIONS") {
    return res.status(200).send("OK");
  }

  // Método não permitido
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
      const replySent = await sendCommentReply(commentId, PUBLIC_REPLY_MESSAGE);
      
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
    
    // Usa o endpoint correto para respostas a comentários
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
    
    if (!data.error) {
      console.log("Resposta enviada com sucesso");
      return true;
    }
    
    console.error("Erro ao responder comentário:", data.error);
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
