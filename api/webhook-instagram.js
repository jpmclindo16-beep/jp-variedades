// api/webhook-instagram.js - COMBINADO: responde DM + comentario com palavra-chave -> DM
const VERIFY_TOKEN = process.env.IG_WEBHOOK_VERIFY_TOKEN || "jp_shoppew_2026";
const IG_TOKEN = process.env.IG_ACCESS_TOKEN;
const PAGE_TOKEN = process.env.FACEBOOK_PAGE_TOKEN || process.env.IG_ACCESS_TOKEN;
const IG_BUSINESS_ID = "17841467530671368"; // seu IG business id do log

const KEYWORD_LINKS = {
  QUERO: "https://jp-variedades.vercel.app/",
};

// Mensagens personalizadas
const DM_REPLY_MESSAGE = "Oi! Aqui da JP Variedades 👇\nMe fala o que você procura ou comenta QUERO em qualquer post que te mando o site!";
const PRIVATE_REPLY_MESSAGE = (link) => `Oi! Aqui está o site que você pediu 👇\n${link}`;
const PUBLIC_REPLY_MESSAGE = "Te chamei no privado! Se não chegar, me chama no direct 👇";

const processedMids = new Set();
const processedCommentIds = new Set();
const MAX_CACHE_SIZE = 500;
const REQUEST_TIMEOUT = 10000; // 10 segundos

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
    
    console.warn("Falha na verificação do webhook:", { mode, token });
    return res.status(403).send("Verificação falhou");
  }

  // Processamento de eventos (POST)
  if (req.method === "POST") {
    try {
      const body = req.body;
      
      // Validação básica do payload
      if (!body || body.object !== "instagram") {
        return res.status(404).send("Not Found");
      }

      // Processa cada entry do webhook
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

// Processa cada entry do webhook
async function processEntry(entry) {
  // Processa mudanças (comentários)
  if (entry.changes) {
    for (const change of entry.changes) {
      if (change.field === "comments") {
        await processComment(change.value);
      }
    }
  }

  // Processa mensagens (DMs)
  if (entry.messaging) {
    for (const msgEvent of entry.messaging) {
      await processMessage(msgEvent);
    }
  }
}

// Processa comentários
async function processComment(comment) {
  try {
    const commentId = comment.id;
    const fromId = comment.from?.id?.toString();
    const mediaId = comment.media?.id; // ID da mídia/post
    const parentId = comment.parent_id;

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

    // Processa o texto do comentário
    const text = (comment.text || "").toUpperCase().trim();
    console.log(`Comentário recebido: "${text}" (ID: ${commentId}, Autor: ${fromId}, Media: ${mediaId})`);

    // Verifica palavras-chave
    for (const [keyword, link] of Object.entries(KEYWORD_LINKS)) {
      if (text.includes(keyword)) {
        console.log(`Palavra-chave "${keyword}" detectada no comentário ${commentId}`);
        await handleKeywordComment(commentId, link, mediaId);
        break;
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

    // Validações
    if (!senderId) {
      console.warn("Mensagem sem remetente:", msgEvent);
      return;
    }

    // Ignora mensagens de eco
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
    const dmSent = await sendDM(senderId, DM_REPLY_MESSAGE);
    
    if (dmSent) {
      console.log(`Resposta enviada com sucesso para ${senderId}`);
    } else {
      console.error(`Falha ao enviar resposta para ${senderId}`);
    }
  } catch (err) {
    console.error("Erro ao processar mensagem:", err);
  }
}

// Processa comentários com palavras-chave
async function handleKeywordComment(commentId, link, mediaId) {
  try {
    // Tenta enviar resposta privada primeiro
    const privateSent = await sendPrivateReply(commentId, link);
    
    if (!privateSent) {
      console.log(`Resposta privada falhou para ${commentId}, tentando resposta pública`);
      // Fallback para resposta pública
      await sendPublicReply(commentId, PUBLIC_REPLY_MESSAGE);
    }
  } catch (err) {
    console.error("Erro ao processar comentário com palavra-chave:", err);
  }
}

// Envia resposta privada para comentário
async function sendPrivateReply(commentId, link) {
  try {
    // Usando a API correta do Instagram para respostas privadas
    const url = `https://graph.facebook.com/v21.0/${commentId}/private_replies`;
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${PAGE_TOKEN}`
      },
      body: JSON.stringify({ 
        message: PRIVATE_REPLY_MESSAGE(link) 
      }),
    });

    const data = await response.json();
    
    if (data.error) {
      console.error("Erro na resposta privada:", data.error);
      
      // Se o erro for de permissão, tenta com o token do Instagram
      if (data.error.code === 100 || data.error.code === 190) {
        console.log("Tentando com token do Instagram...");
        return await sendPrivateReplyWithIGToken(commentId, link);
      }
      
      return false;
    }
    
    console.log("Resposta privada enviada com sucesso:", data.id);
    return true;
  } catch (err) {
    console.error("Exceção ao enviar resposta privada:", err);
    return false;
  }
}

// Tenta enviar resposta privada com token do Instagram
async function sendPrivateReplyWithIGToken(commentId, link) {
  try {
    const url = `https://graph.instagram.com/v21.0/${commentId}/replies`;
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${IG_TOKEN}`
      },
      body: JSON.stringify({ 
        message: PRIVATE_REPLY_MESSAGE(link) 
      }),
    });

    const data = await response.json();
    
    if (data.error) {
      console.error("Erro na resposta privada com IG Token:", data.error);
      return false;
    }
    
    console.log("Resposta privada enviada com sucesso (IG Token):", data.id);
    return true;
  } catch (err) {
    console.error("Exceção ao enviar resposta privada com IG Token:", err);
    return false;
  }
}

// Envia resposta pública para comentário
async function sendPublicReply(commentId, text) {
  try {
    // Usando o endpoint correto para respostas públicas
    const url = `https://graph.facebook.com/v21.0/${commentId}/replies`;
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
    
    if (data.error) {
      console.error("Erro na resposta pública:", data.error);
      
      // Tenta com PAGE_TOKEN se IG_TOKEN falhar
      if (data.error.code === 100 || data.error.code === 190) {
        console.log("Tentando resposta pública com PAGE_TOKEN...");
        return await sendPublicReplyWithPageToken(commentId, text);
      }
      
      return false;
    }
    
    console.log("Resposta pública enviada com sucesso:", data.id);
    return true;
  } catch (err) {
    console.error("Exceção ao enviar resposta pública:", err);
    return false;
  }
}

// Tenta resposta pública com PAGE_TOKEN
async function sendPublicReplyWithPageToken(commentId, text) {
  try {
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
    
    if (data.error) {
      console.error("Erro na resposta pública com PAGE_TOKEN:", data.error);
      return false;
    }
    
    console.log("Resposta pública enviada com sucesso (PAGE_TOKEN):", data.id);
    return true;
  } catch (err) {
    console.error("Exceção ao enviar resposta pública com PAGE_TOKEN:", err);
    return false;
  }
}

// Envia mensagem direta
async function sendDM(recipientId, text) {
  try {
    // Usando a API do Instagram para enviar DMs
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
    
    if (data.error) {
      console.error("Erro ao enviar DM:", data.error);
      
      // Se falhar com IG_TOKEN, tenta com PAGE_TOKEN
      if (data.error.code === 100 || data.error.code === 190) {
        console.log("Tentando enviar DM com PAGE_TOKEN...");
        return await sendDMWithPageToken(recipientId, text);
      }
      
      return false;
    }
    
    console.log("DM enviada com sucesso:", data.message_id);
    return true;
  } catch (err) {
    console.error("Exceção ao enviar DM:", err);
    return false;
  }
}

// Tenta enviar DM com PAGE_TOKEN
async function sendDMWithPageToken(recipientId, text) {
  try {
    const url = `https://graph.facebook.com/v21.0/me/messages`;
    const response = await fetchWithTimeout(url, {
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

    const data = await response.json();
    
    if (data.error) {
      console.error("Erro ao enviar DM com PAGE_TOKEN:", data.error);
      return false;
    }
    
    console.log("DM enviada com sucesso (PAGE_TOKEN):", data.message_id);
    return true;
  } catch (err) {
    console.error("Exceção ao enviar DM com PAGE_TOKEN:", err);
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
