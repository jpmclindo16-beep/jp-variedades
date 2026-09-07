// api/webhook-instagram.js - VERSÃO CORRIGIDA (sem duplicidade)
const VERIFY_TOKEN = process.env.IG_WEBHOOK_VERIFY_TOKEN || "jp_shoppew_2026";
const PAGE_TOKEN = process.env.FACEBOOK_PAGE_TOKEN;
const IG_BUSINESS_ID = "17841467530671368";

// Site que vai ser enviado no Direct
const SITE_LINK = "https://jp-variedades.vercel.app/";

// Todas as palavras/variações que disparam o envio do link.
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

const PRIVATE_REPLY_MESSAGE = `Oi! Aqui está o site que você pediu 👇\n${SITE_LINK}`;

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
    // Isso evita que a Meta ache que a requisição falhou por demora
    // e reenvie o mesmo evento (causa mais comum de duplicidade).
    res.status(200).send("EVENT_RECEIVED");

    // A partir daqui, tudo roda "depois" de já termos respondido.
    try {
      if (!body || (body.object !== "instagram" && body.object !== "page")) {
        return;
      }

      if (body.entry && Array.isArray(body.entry)) {
        for (const entry of body.entry) {
          await processEntry(entry);
        }
      }
    } catch (err) {
      console.error("Erro no processamento em segundo plano:", err);
    }
    return;
  }

  if (req.method === "OPTIONS") {
    return res.status(200).send("OK");
  }

  return res.status(405).send("Method Not Allowed");
}

async function processEntry(entry) {
  try {
    if (entry.changes && Array.isArray(entry.changes)) {
      for (const change of entry.changes) {
        if (change.field === "comments") {
          await processComment(change.value);
        }
      }
    }
  } catch (err) {
    console.error("Erro ao processar entry:", err);
  }
}

async function processComment(comment) {
  try {
    const commentId = comment.id;
    const fromId = comment.from?.id?.toString();
    const text = (comment.text || "").toUpperCase().trim();

    if (!commentId || !fromId) return;

    // Ignora comentários do próprio bot
    if (fromId === IG_BUSINESS_ID) return;

    // Deduplicação (best-effort)
    if (processedCommentIds.has(commentId)) {
      console.log(`Comentário duplicado ignorado: ${commentId}`);
      return;
    }
    addToCache(processedCommentIds, commentId);

    console.log(`Comentário recebido: "${text}" (ID: ${commentId}, Autor: ${fromId})`);

    // Verifica se alguma palavra-chave bate com o comentário
    const matched = KEYWORDS.some((kw) => text.includes(kw));

    if (matched) {
      console.log(`Palavra-chave encontrada no comentário ${commentId}, enviando private reply...`);
      await sendPrivateReply(commentId, PRIVATE_REPLY_MESSAGE);
    }
  } catch (err) {
    console.error("Erro ao processar comentário:", err);
  }
}

// Envia a DM diretamente em resposta ao comentário.
// Esse é o endpoint correto para "comentário -> Direct", funciona mesmo
// sem conversa aberta previamente (diferente de /me/messages).
async function sendPrivateReply(commentId, text) {
  try {
    const url = `https://graph.facebook.com/v21.0/${commentId}/private_replies`;

    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        access_token: PAGE_TOKEN,
      }),
    });

    const data = await response.json();

    if (data.error) {
      console.error("Erro ao enviar private reply:", data.error);
      return false;
    }

    console.log("Private reply enviada com sucesso:", data);
    return true;
  } catch (err) {
    console.error("Exceção ao enviar private reply:", err);
    return false;
  }
}

async function fetchWithTimeout(url, options = {}, timeout = REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
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
  },
};
