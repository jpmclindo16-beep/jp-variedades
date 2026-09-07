// api/webhook-instagram.js - VERSÃO COMPLETA E CORRIGIDA
const VERIFY_TOKEN = process.env.IG_WEBHOOK_VERIFY_TOKEN || "jp_shoppew_2026";
const IG_TOKEN = process.env.IG_ACCESS_TOKEN;
const PAGE_TOKEN = process.env.FACEBOOK_PAGE_TOKEN || process.env.IG_ACCESS_TOKEN;
const IG_BUSINESS_ID = "17841467530671368";

const KEYWORD_LINKS = {
  QUERO: "https://jp-variedades.vercel.app/",
};

const DM_REPLY_MESSAGE = "Oi! Aqui da JP Variedades 👇\nMe fala o que você procura ou comenta QUERO em qualquer post que te mando o site!";
const PRIVATE_REPLY_MESSAGE = (link) => `Oi! Aqui está o site que você pediu 👇\n${link}`;
const PUBLIC_REPLY_MESSAGE = "Te chamei no privado! Se não chegar, me chama no direct 👇";

const processedMids = new Set();
const processedCommentIds = new Set();
const MAX_CACHE_SIZE = 500;
const REQUEST_TIMEOUT = 10000;

export default async function handler(req, res) {
  // Configuração CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Log inicial para debug
  console.log("Requisição recebida:", {
    method: req.method,
    userAgent: req.headers['user-agent'],
    contentType: req.headers['content-type'],
    bodySize: JSON.stringify(req.body || {}).length
  });

  // Verificação do webhook (GET)
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    
    console.log("Verificação GET:", { mode, token, challenge });
    
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("Webhook verificado com sucesso!");
      return res.status(200).send(challenge);
    }
    
    console.warn("Falha na verificação do webhook");
    return res.status(403).send("Verificação falhou");
  }

  // Processamento de eventos (POST)
  if (req.method === "POST") {
    try {
      const body = req.body;
      
      // Log detalhado do body
      console.log("Body recebido:", JSON.stringify(body).slice(0, 1000));
      
      // Validação básica do payload
      if (!body) {
        console.log("Body vazio");
        return res.status(200).send("EVENT_RECEIVED");
      }

      // Aceita diferentes formatos de payload
      if (body.object !== "instagram" && body.object !== "page") {
        console.log("Object não reconhecido:", body.object);
        return res.status(200).send("EVENT_RECEIVED");
      }

      // Processa cada entry do webhook
      if (body.entry && Array.isArray(body.entry)) {
        for (const entry of body.entry) {
          await processEntry(entry);
        }
      } else {
        console.log("Sem entries para processar");
      }
      
      return res.status(200).send("EVENT_RECEIVED");
    } catch (err) {
      console.error("Erro no processamento:", err);
      return res.status(200).send("EVENT_RECEIVED");
    }
  }

  // Método OPTIONS para CORS
  if (req.method === "OPTIONS") {
    return res.status(200).send("OK");
  }

  // Método não permitido
  return res.status(405).send("Method Not Allowed");
}

// Processa cada entry do webhook
async function processEntry(entry) {
  try {
    // Log da entry
    console.log("Processando entry:", JSON.stringify(entry).slice(0, 500));

    // Processa mudanças (comentários)
    if (entry.changes && Array.isArray(entry.changes)) {
      for (const change of entry.changes) {
        if (change.field === "comments") {
          await processComment(change.value);
        }
      }
    }

    // Processa mensagens (DMs)
    if (entry.messaging && Array.isArray(entry.messaging)) {
      for (const msgEvent of entry.messaging) {
        await processMessage(msgEvent);
      }
    }
  } catch (err) {
    console.error("Erro ao processar entry:", err);
  }
}

// Processa comentários
async function processComment(comment) {
  try {
    const commentId = comment.id;
    const fromId = comment.from?.id?.toString();
    const mediaId = comment.media?.id;
    const text = (comment.text || "").toUpperCase().trim();

    // Log detalhado do comentário
    console.log("Comentário detalhado:", JSON.stringify(comment).slice(0, 500));

    // Validações
    if (!commentId || !fromId) {
      console.warn("Comentário sem ID ou autor:", comment);
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

    // Adiciona ao cache de processados
    addToCache(processedCommentIds, commentId);

    console.log(`Comentário recebido: "${text}" (ID: ${commentId}, Autor: ${fromId})`);

    // Verifica palavras-chave
    for (const [keyword, link] of Object.entries(KEYWORD_LINKS)) {
      if (text.includes(keyword)) {
        console.log(`Palavra-chave "${keyword}" detectada no comentário ${commentId}`);
        
        // Tenta enviar DM diretamente para o usuário
        const dmSent = await sendDMToUser(fromId, PRIVATE_REPLY_MESSAGE(link));
        
        if (!dmSent) {
          // Se DM falhar, tenta responder ao comentário
          console.log("DM falhou, tentando responder ao comentário...");
          await sendCommentReply(commentId, PUBLIC_REPLY_MESSAGE);
        }
        break; // Processa apenas a primeira palavra-chave encontrada
      }
    }
  } catch (err) {
    console.error("Erro ao processar comentário:", err);
  }
}

// Processa mensagens diretas
async function processMessage(msgEvent) {
  try {
    const mid = msgEvent.message?.mid;
    const senderId = msgEvent.sender?.id;
    const text = msgEvent.message?.text || "";
    const isEcho = msgEvent.message?.is_echo || false;
    const attachments = msgEvent.message?.attachments || [];

    // Log detalhado da mensagem
    console.log("Mensagem detalhada:", JSON.stringify(msgEvent).slice(0, 500));

    // Validações
    if (!senderId) {
      console.warn("Mensagem sem remetente:", msgEvent);
      return;
    }

    // Ignora mensagens de eco (enviadas pelo próprio bot)
    if (isEcho) {
      console.log("Ignorando mensagem de eco");
      return;
    }

    // Ignora mensagens do próprio bot
    if (senderId.toString() === IG_BUSINESS_ID) {
      console.log("Ignorando mensagem do próprio bot");
      return;
    }

    // Verifica deduplicação
    if (mid && processedMids.has(mid)) {
      console.log(`Mensagem duplicada ignorada: ${mid}`);
      return;
    }

    // Adiciona ao cache de processados
    if (mid) {
      addToCache(processedMids, mid);
    }

    // Verifica se é mensagem de texto ou mídia
    if (!text && attachments.length === 0) {
      console.log("Mensagem vazia ignorada");
      return;
    }

    console.log(`DM recebida de ${senderId}: "${text}"`);

    // Responde à mensagem
    const dmSent = await sendDMToUser(senderId, DM_REPLY_MESSAGE);
    
    if (dmSent) {
      console.log(`Resposta enviada com sucesso para ${senderId}`);
    } else {
      console.error(`Falha ao enviar resposta para ${senderId}`);
    }
  } catch (err) {
    console.error("Erro ao processar mensagem:", err);
  }
}

// Função principal para enviar DM
async function sendDMToUser(recipientId, text) {
  try {
    // Tenta primeiro com o token do Instagram
    console.log(`Tentando enviar DM para ${recipientId} com IG_TOKEN...`);
    
    const url = `https://graph.instagram.com/v21.0/me/messages`;
    const response = await fetchWithTimeout(url, {
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
    
    if (!data.error) {
      console.log("DM enviada com sucesso via IG_TOKEN");
      return true;
    }
    
    console.error("Erro com IG_TOKEN:", data.error);
    
    // Se falhar, tenta com PAGE_TOKEN
    console.log(`Tentando enviar DM para ${recipientId} com PAGE_TOKEN...`);
    
    const pageUrl = `https://graph.facebook.com/v21.0/me/messages`;
    const pageResponse = await fetchWithTimeout(pageUrl, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json", 
        "Authorization": `Bearer ${PAGE_TOKEN}` 
      },
      body: JSON.stringify({ 
        recipient: { id: recipientId }, 
        message: { text } 
      }),
    });

    const pageData = await pageResponse.json();
    
    if (!pageData.error) {
      console.log("DM enviada com sucesso via PAGE_TOKEN");
      return true;
    }
    
    console.error("Erro com PAGE_TOKEN:", pageData.error);
    return false;
    
  } catch (err) {
    console.error("Exceção ao enviar DM:", err);
    return false;
  }
}

// Função para responder comentário
async function sendCommentReply(commentId, text) {
  try {
    console.log(`Tentando responder comentário ${commentId}...`);
    
    // Tenta com o endpoint correto para respostas a comentários
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
      console.log("Resposta ao comentário enviada com sucesso");
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
  
  // Remove itens antigos se exceder o limite
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
        
