const GRAPH_API_VERSION = "v22.0";
const META_GRAPH_BASE = https://graph.facebook.com/${GRAPH_API_VERSION};
const TELEGRAM_BASE = "https://api.telegram.org";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function graphPost(path, data) {
  const url = ${META_GRAPH_BASE}/${path};
  const body = new URLSearchParams();

  for (const [key, value] of Object.entries(data || {})) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      body.append(key, JSON.stringify(value));
    } else {
      body.append(key, String(value));
    }
  }

  const resp = await fetch(url, {
    method: "POST",
    body,
  });

  const json = await resp.json();

  if (!resp.ok || json.error) {
    throw new Error(json.error?.message || Erro na Graph API: ${resp.status});
  }

  return json;
}

async function graphGet(path, data = {}) {
  const url = new URL(${META_GRAPH_BASE}/${path});

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  const resp = await fetch(url.toString(), {
    method: "GET",
  });

  const json = await resp.json();

  if (!resp.ok || json.error) {
    throw new Error(json.error?.message || Erro na Graph API: ${resp.status});
  }

  return json;
}

async function telegramPost(method, data, token) {
  const url = ${TELEGRAM_BASE}/bot${token}/${method};
  const body = new URLSearchParams();

  for (const [key, value] of Object.entries(data || {})) {
    if (value === undefined || value === null) continue;

    if (typeof value === "object") {
      body.append(key, JSON.stringify(value));
    } else {
      body.append(key, String(value));
    }
  }

  const resp = await fetch(url, {
    method: "POST",
    body,
  });

  const json = await resp.json();

  if (!resp.ok || !json.ok) {
    throw new Error(json.description || Erro no Telegram: ${resp.status});
  }

  return json;
}

function extrairTexto(body, keys = []) {
  for (const key of keys) {
    const value = body?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizarImagens(body) {
  const imagens = [];

  for (let i = 1; i  10) {
    throw new Error("Carrossel do Instagram permite no máximo 10 itens.");
  }

  const itemIds = [];

  for (const imageUrl of imagens) {
    const itemContainer = await graphPost(${instagramId}/media, {
      image_url: imageUrl,
      is_carousel_item: true,
      access_token: token,
    });

    if (!itemContainer?.id) {
      throw new Error("Falha ao criar item do carrossel no Instagram.");
    }

    itemIds.push(itemContainer.id);
  }

  for (const itemId of itemIds) {
    await aguardarProcessamentoInstagram(itemId, token);
  }

  const carouselContainer = await graphPost(${instagramId}/media, {
    media_type: "CAROUSEL",
    children: itemIds,
    caption,
    access_token: token,
  });

  if (!carouselContainer?.id) {
    throw new Error("Falha ao criar o carrossel no Instagram.");
  }

  await aguardarProcessamentoInstagram(carouselContainer.id, token);

  const publish = await graphPost(${instagramId}/media_publish, {
    creation_id: carouselContainer.id,
    access_token: token,
  });

  if (!publish?.id) throw new Error("Falha ao publicar carrossel no Instagram.");

  return { success: true, id: publish.id };
}

async function publicarNoInstagram(imagens, caption) {
  try {
    const token = process.env.INSTAGRAM_TOKEN;
    const instagramId = process.env.INSTAGRAM_ID;

    if (!token || !instagramId) {
      return {
        success: false,
        skipped: true,
        error: "Credenciais do Instagram não configuradas.",
      };
    }

    if (!imagens || imagens.length === 0) {
      return {
        success: false,
        skipped: true,
        error: "Instagram exige pelo menos uma imagem para publicar.",
      };
    }

    if (imagens.length === 1) {
      return await publicarImagemUnicaInstagram(imagens[0], caption, token, instagramId);
    }

    return await publicarCarrosselInstagram(imagens, caption, token, instagramId);
  } catch (err) {
    console.error("Instagram erro:", err.message);
    return { success: false, error: err.message };
  }
}

async function publicarNoFacebook(imagens, caption) {
  try {
    const token = process.env.FACEBOOK_PAGE_TOKEN;
    const pageId = process.env.FACEBOOK_PAGE_ID;

    if (!token || !pageId) {
      return {
        success: false,
        skipped: true,
        error: "Credenciais do Facebook não configuradas.",
      };
    }

    if (!imagens || imagens.length === 0) {
      const post = await graphPost(${pageId}/feed, {
        message: caption,
        access_token: token,
      });

      return { success: true, id: post?.id };
    }

    if (imagens.length === 1) {
      const post = await graphPost(${pageId}/photos, {
        url: imagens[0],
        caption,
        published: true,
        access_token: token,
      });

      return { success: true, id: post?.id || post?.post_id };
    }

    const attachedMedia = [];

    for (const url of imagens.slice(0, 10)) {
      const upload = await graphPost(${pageId}/photos, {
        url,
        published: false,
        access_token: token,
      });

      if (upload?.id) attachedMedia.push({ media_fbid: upload.id });
    }

    if (attachedMedia.length === 0) {
      throw new Error("Nenhuma imagem foi enviada para o Facebook.");
    }

    const payload = {
      message: caption,
      access_token: token,
    };

    attachedMedia.forEach((media, index) => {
      payload[attached_media[${index}]] = JSON.stringify(media);
    });

    const feedPost = await graphPost(${pageId}/feed, payload);

    return { success: true, id: feedPost?.id };
  } catch (err) {
    console.error("Facebook erro:", err.message);
    return { success: false, error: err.message };
  }
}

async function publicarNoTelegram(imagens, caption) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
      return {
        success: false,
        skipped: true,
        error: "Credenciais do Telegram não configuradas.",
      };
    }

    if (!imagens || imagens.length === 0) {
      const resp = await telegramPost(
        "sendMessage",
        { chat_id: chatId, text: caption, parse_mode: "HTML" },
        token
      );

      return { success: true, result: resp?.result };
    }

    if (imagens.length === 1) {
      const resp = await telegramPost(
        "sendPhoto",
        { chat_id: chatId, photo: imagens[0], caption, parse_mode: "HTML" },
        token
      );

      return { success: true, result: resp?.result };
    }

    const media = imagens.slice(0, 10).map((img, index) => ({
      type: "photo",
      media: img,
      caption: index === 0 ? caption : undefined,
      parse_mode: "HTML",
    }));

    const resp = await telegramPost(
      "sendMediaGroup",
      { chat_id: chatId, media },
      token
    );

    return { success: true, result: resp?.result };
  } catch (err) {
    console.error("Telegram erro:", err.message);
    return { success: false, error: err.message };
  }
}

async function processarImagensParaMeta(imagens) {
  return Array.isArray(imagens) ? imagens : [];
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido. Utilize POST." });
  }

  try {
    const body = req.body || {};
    const imagensOriginais = normalizarImagens(body);
    const legenda = montarLegenda(body);

    if (imagensOriginais.length === 0 && !legenda) {
      return res.status(400).json({ error: "Nenhum conteúdo (imagem ou texto) fornecido." });
    }

    const imagensProntas = imagensOriginais.length > 0
      ? await processarImagensParaMeta(imagensOriginais)
      : [];

    const [instagramResult, facebookResult, telegramResult] = await Promise.allSettled([
      publicarNoInstagram(imagensProntas, legenda),
      publicarNoFacebook(imagensProntas, legenda),
      publicarNoTelegram(imagensOriginais, legenda),
    ]);

    return res.status(200).json({
      success: true,
      results: {
        instagram:
          instagramResult.status === "fulfilled"
            ? instagramResult.value
            : { success: false, error: instagramResult.reason?.message || "Falha desconhecida" },
        facebook:
          facebookResult.status === "fulfilled"
            ? facebookResult.value
            : { success: false, error: facebookResult.reason?.message || "Falha desconhecida" },
        telegram:
          telegramResult.status === "fulfilled"
            ? telegramResult.value
            : { success: false, error: telegramResult.reason?.message || "Falha desconhecida" },
      },
    });
  } catch (error) {
    console.error("Erro interno no handler:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message || "Erro interno do servidor.",
    });
  }
  }
