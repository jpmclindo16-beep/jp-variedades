// api/webhook-instagram.js - VERSÃO CORRIGIDA
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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

  if (req.method === "POST") {
    try {
      const body = req.body;
      
      if (!body || body.object !== "instagram") {
        return res.status(404).send("Not Found");
      }

      for (const entry of body.entry || []) {
        await processEntry(entry);
      }
      
      return res.status(200).send("EVENT_RECEIVED");
    } catch (err) {
      console.error("Erro no processamento:", err);
      return res.status(200).send("EVENT_RECEIVED");
    }
  }

  return res.status(405).send("Method Not Allowed");
}

async function processEntry(entry) {
  if (entry.changes) {
    for (const change of entry.changes) {
      if (change.field === "comments") {
        await processComment(change.value);
      }
    }
  }

  if (entry.messaging) {
    for (const msgEvent of entry.messaging) {
      await processMessage(msgEvent);
    }
  }
}

async function processComment(comment) {
  try {
    const commentId = comment.id;
    const fromId = comment.from?.id?.toString();
    const mediaId = comment.media?.id;
    const text = (comment.text || "").toUpperCase().trim();

    if (!commentId || !fromId) {
      console.warn("Comentário sem ID ou autor:", comment);
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

    console.log(`Comentário recebido: "${text}" (ID: ${commentId}, Autor: ${fromId})`);

    for (const [keyword, link] of Object.entries(KEYWORD_LINKS)) {
      if (text.includes(keyword)) {
        console.log(`Palavra-chave "${keyword}" detectada`);
        
        // Tenta enviar DM diretamente para o usuário
        const dmSent = await sendDMToUser(fromId, PRIVATE_REPLY_MESSAGE(link));
        
        if (!dmSent) {
          // Se DM falhar, tenta responder ao comentário
          console.log("DM falhou, tentando responder ao comentário...");
          await sendCommentReply(commentId, PUBLIC_REPLY_MESSAGE);
        }
        break;
      }
    }
  } catch (err) {
    console.error("Erro ao processar comentário:", err);
  }
}

async function processMessage(msgEvent) {
  try {
    const mid = msgEvent.message?.mid;
    const senderId = msgEvent.sender?.id;
    const text = msgEvent.message?.text || "";
    const isEcho = msgEvent.message?.is_echo || false;

    if (!senderId || isEcho) return;
    if (senderId.toString() === IG_BUSINESS_ID) return;
    
    if (mid && processedMids.has(mid)) return;
    if (mid) addToCache(processedMids, mid);

    if (!text) return;

    console.log(`DM recebida de ${senderId}: "${text}"`);
    
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
    maxDuration: 30,
  } 
};
