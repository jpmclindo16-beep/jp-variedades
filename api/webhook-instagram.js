// api/webhook-instagram.js - VERSÃO COM LINK POR PRODUTO (via Supabase) + DM PRIVADO
const VERIFY_TOKEN = process.env.IG_WEBHOOK_VERIFY_TOKEN || "jp_shoppew_2026";
const IG_TOKEN = process.env.IG_ACCESS_TOKEN;
const PAGE_TOKEN = process.env.FACEBOOK_PAGE_TOKEN;
const IG_BUSINESS_ID = "17841467530671368";

// Credenciais do Supabase (adicionar na Vercel: Settings > Environment Variables)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

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
const FALLBACK_DM_MESSAGE = "Oi! Vi seu comentário 😊 Ainda não configurei o link desse produto específico, mas dá uma olhada no nosso perfil que tem tudo por lá!";

const processedCommentIds = new Map();
const MAX_CACHE_SIZE = 1000;
const CACHE_EXPIRY = 60000; // 1 minuto (aumentado para evitar duplicidade)

// Fila de processamento para evitar bloqueio
let isProcessing = false;
const processingQueue = [];

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
    const mediaId = comment.media?.id; // ID do post/reel comentado

    console.log("Comentário recebido:", { commentId, fromId, text, mediaId });

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
      console.log(`Palavra-chave detectada, adicionando à fila...`);

      processingQueue.push({ commentId, fromId, mediaId });

      await processQueue();
    }
  } catch (err) {
    console.error("Erro ao processar comentário:", err);
  }
}

// Processa a fila com delay entre respostas
async function processQueue() {
  if (isProcessing) {
    console.log("Já está processando, aguardando...");
    return;
  }

  isProcessing = true;

  try {
    while (processingQueue.length > 0) {
      const item = processingQueue.shift();

      console.log(`Processando comentário ${item.commentId}...`);

      // 1. Busca o link de afiliado do produto vinculado a esse post
      const link = await getLinkByMediaId(item.mediaId);
      const dmMessage = link
        ? `Oi! Aqui está o link do produto 🛍️\n\n${link}`
        : FALLBACK_DM_MESSAGE;

      // 2. Envia a resposta PÚBLICA no comentário
      const replySent = await sendCommentReply(item.commentId, PUBLIC_REPLY_MESSAGE);

      // 3. Envia o link (ou fallback) no DIRECT (DM privado)
      const dmSent = await sendPrivateReply(item.commentId, dmMessage);

      if (replySent && dmSent) {
        console.log(`✅ Resposta e DM enviados com sucesso!`);
      } else {
        console.error(`❌ Falha ao enviar resposta/DM para o comentário ${item.commentId}`);
      }

      // Delay entre respostas (5 segundos)
      if (processingQueue.length > 0) {
        console.log("Aguardando 5 segundos antes da próxima resposta...");
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  } finally {
    isProcessing = false;
  }
}

// Busca o link de afiliado cadastrado para o post (media_id) no Supabase
async function getLinkByMediaId(mediaId) {
  if (!mediaId || !SUPABASE_URL || !SUPABASE_KEY) {
    console.log("mediaId ou credenciais do Supabase ausentes, usando fallback");
    return null;
  }

  try {
    const url = `${SUPABASE_URL}/rest/v1/produtos_instagram?media_id=eq.${mediaId}&select=link_afiliado`;

    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });

    const data = await response.json();

    if (Array.isArray(data) && data.length > 0) {
      console.log(`Link encontrado para o post ${mediaId}: ${data[0].link_afiliado}`);
      return data[0].link_afiliado;
    }

    console.log(`Nenhum link cadastrado pro post ${mediaId}`);
    return null;
  } catch (err) {
    console.error("Erro ao buscar link no Supabase:", err.message);
    return null;
  }
}

// Responde publicamente o comentário
async function sendCommentReply(commentId, text) {
  try {
    const url = `https://graph.facebook.com/v21.0/${commentId}/replies`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${IG_TOKEN}`
      },
      body: JSON.stringify({ message: text }),
    });

    const data = await response.json();
    console.log("Resposta comentário:", JSON.stringify(data));

    if (!data.error) {
      console.log("✅ Resposta ao comentário enviada");
      return true;
    }

    console.error("Erro resposta comentário:", data.error);
    return false;
  } catch (err) {
    console.error("Exceção resposta comentário:", err.message);
    return false;
  }
}

// Envia mensagem privada (DM) em resposta ao comentário, com o link do produto
async function sendPrivateReply(commentId, text) {
  try {
    const url = `https://graph.facebook.com/v21.0/${commentId}/private_replies`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${IG_TOKEN}`
      },
      body: JSON.stringify({ message: text }),
    });

    const data = await response.json();
    console.log("Resposta private reply:", JSON.stringify(data));

    if (!data.error) {
      console.log("✅ DM enviado com sucesso");
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
