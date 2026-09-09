// ======================================================
// HELPERS
// ======================================================
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function extrairTexto(body, keys = []) {
  for (const key of keys) {
    const value = body?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizarImagens(body) {
  const imagens = [];

  for (let i = 1; i <= 10; i++) {
    const key = `imagem${i}`;
    const value = body?.[key];

    if (typeof value === "string" && value.trim()) {
      imagens.push(value.trim());
    }
  }

  if (Array.isArray(body?.imagens)) {
    for (const img of body.imagens) {
      if (typeof img === "string" && img.trim()) {
        imagens.push(img.trim());
      }
    }
  }

  return [...new Set(imagens)];
}

function montarLegenda(body) {
  const legenda = extrairTexto(body, ["legenda", "caption", "texto"]);
  return legenda;
}

async function aguardarProcessamentoInstagram(containerId, token) {
  const maxTentativas = 12;
  const intervalo = 2000;

  for (let i = 0; i < maxTentativas; i++) {
    const status = await graphGet(`${containerId}`, {
      fields: "status_code",
      access_token: token,
    });

    if (status?.status_code === "FINISHED") return true;

    if (status?.status_code === "ERROR") {
      throw new Error(`Container do Instagram com erro: ${containerId}`);
    }

    await delay(intervalo);
  }

  throw new Error(`Timeout aguardando processamento do container ${containerId}`);
}

async function processarImagensParaMeta(imagens) {
  if (!Array.isArray(imagens) || imagens.length === 0) return [];

  // Se você já converte imagem para URL pública antes, pode só retornar imagens.
  // Mantido aqui caso você tenha pipeline com ImgBB ou similar.
  return imagens;
}

// ======================================================
// INSTAGRAM
// ======================================================
async function publicarImagemUnicaInstagram(imageUrl, caption, token, instagramId) {
  const container = await graphPost(`${instagramId}/media`, {
    image_url: imageUrl,
    caption: caption,
    access_token: token,
  });

  if (!container?.id) {
    throw new Error("Falha ao criar o container de mídia do Instagram.");
  }

  await aguardarProcessamentoInstagram(container.id, token);

  const publish = await graphPost(`${instagramId}/media_publish`, {
    creation_id: container.id,
    access_token: token,
  });

  if (!publish?.id) {
    throw new Error("Falha ao publicar no Instagram.");
  }

  return { success: true, id: publish.id };
}

async function publicarCarrosselInstagram(imagens, caption, token, instagramId) {
  if (!Array.isArray(imagens) || imagens.length < 2) {
    throw new Error("Carrossel do Instagram exige no mínimo 2 imagens.");
  }

  if (imagens.length > 10) {
    throw new Error("Carrossel do Instagram permite no máximo 10 itens.");
  }

  const itemIds = [];

  for (const imageUrl of imagens) {
    const itemContainer = await graphPost(`${instagramId}/media`, {
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

  const carouselContainer = await graphPost(`${instagramId}/media`, {
    media_type: "CAROUSEL",
    children: itemIds,
    caption: caption,
    access_token: token,
  });

  if (!carouselContainer?.id) {
    throw new Error("Falha ao criar container do carrossel no Instagram.");
  }

  await aguardarProcessamentoInstagram(carouselContainer.id, token);

  const publish = await graphPost(`${instagramId}/media_publish`, {
    creation_id: carouselContainer.id,
    access_token: token,
  });

  if (!publish?.id) {
    throw new Error("Falha ao publicar carrossel no Instagram.");
  }

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

// ======================================================
// FACEBOOK
// ======================================================
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
      const post = await graphPost(`${pageId}/feed`, {
        message: caption,
        access_token: token,
      });

      return { success: true, id: post?.id };
    }

    if (imagens.length === 1) {
      const post = await graphPost(`${pageId}/photos`, {
        url: imagens[0],
        caption: caption,
        published: true,
        access_token: token,
      });

      return { success: true, id: post?.id || post?.post_id };
    }

    const attachedMedia = [];

    for (const url of imagens.slice(0, 10)) {
      const upload = await graphPost(`${pageId}/photos`, {
        url: url,
        published: false,
        access_token: token,
      });

      if (upload?.id) {
        attachedMedia.push({ media_fbid: upload.id });
      }
    }

    if (attachedMedia.length === 0) {
      throw new Error("Nenhuma imagem foi enviada para o Facebook.");
    }

    const payload = {
      message: caption,
      access_token: token,
    };

    attachedMedia.forEach((media, index) => {
      payload[`attached_media[${index}]`] = JSON.stringify(media);
    });

    const feedPost = await graphPost(`${pageId}/feed`, payload);

    return { success: true, id: feedPost?.id };
  } catch (err) {
    console.error("Facebook erro:", err.message);
    return { success: false, error: err.message };
  }
}

// ======================================================
// TELEGRAM
// ======================================================
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
        {
          chat_id: chatId,
          text: caption,
          parse_mode: "HTML",
        },
        token
      );

      return { success: true, result: resp?.result };
    }

    if (imagens.length === 1) {
      const resp = await telegramPost(
        "sendPhoto",
        {
          chat_id: chatId,
          photo: imagens[0],
          caption: caption,
          parse_mode: "HTML",
        },
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
      {
        chat_id: chatId,
        media: media,
      },
      token
    );

    return { success: true, result: resp?.result };
  } catch (err) {
    console.error("Telegram erro:", err.message);
    return { success: false, error: err.message };
  }
}

// ======================================================
// HANDLER PRINCIPAL
// ======================================================
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
