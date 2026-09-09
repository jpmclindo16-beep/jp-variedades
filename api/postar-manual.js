// ======================================================
// PUBLICAR IMAGEM ÚNICA NO INSTAGRAM
// ======================================================
async function publicarImagemUnicaInstagram(imageUrl, caption, token, instagramId) {
  // 1. Criar container de mídia
  const container = await graphPost(`${instagramId}/media`, {
    image_url: imageUrl,
    caption: caption,
    access_token: token,
  });

  if (!container.id) {
    throw new Error("Falha ao criar o container de mídia do Instagram.");
  }

  // Aguardar processamento do container
  await delay(3000);

  // 2. Publicar container criado
  const publish = await graphPost(`${instagramId}/media_publish`, {
    creation_id: container.id,
    access_token: token,
  });

  return {
    success: true,
    id: publish.id,
  };
}

// ======================================================
// PUBLICAR CARROSSEL NO INSTAGRAM
// ======================================================
async function publicarCarrosselInstagram(imagens, caption, token, instagramId) {
  // 1. Criar containers individuais para cada imagem do carrossel
  const itemIds = [];

  for (const imageUrl of imagens) {
    const itemContainer = await graphPost(`${instagramId}/media`, {
      image_url: imageUrl,
      is_carousel_item: "true",
      access_token: token,
    });

    if (itemContainer.id) {
      itemIds.push(itemContainer.id);
    }
    await delay(1000);
  }

  if (itemIds.length === 0) {
    throw new Error("Nenhum item do carrossel pôde ser processado.");
  }

  // 2. Criar container principal do carrossel
  const carouselContainer = await graphPost(`${instagramId}/media`, {
    media_type: "CAROUSEL",
    children: itemIds.join(","),
    caption: caption,
    access_token: token,
  });

  if (!carouselContainer.id) {
    throw new Error("Falha ao criar container do carrossel no Instagram.");
  }

  // Aguardar processamento da montagem
  await delay(3000);

  // 3. Publicar container principal
  const publish = await graphPost(`${instagramId}/media_publish`, {
    creation_id: carouselContainer.id,
    access_token: token,
  });

  return {
    success: true,
    id: publish.id,
  };
}

// ======================================================
// PUBLICAR NO FACEBOOK
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
      // Postagem apenas de texto
      const post = await graphPost(`${pageId}/feed`, {
        message: caption,
        access_token: token,
      });

      return { success: true, id: post.id };
    }

    if (imagens.length === 1) {
      // Imagem única
      const post = await graphPost(`${pageId}/photos`, {
        url: imagens[0],
        caption: caption,
        access_token: token,
      });

      return { success: true, id: post.id || post.post_id };
    }

    // Múltiplas imagens (Carrossel / Álbum)
    const attachedMedia = [];

    for (const url of imagens) {
      const upload = await graphPost(`${pageId}/photos`, {
        url: url,
        published: "false",
        access_token: token,
      });

      if (upload.id) {
        attachedMedia.push({ media_fbid: upload.id });
      }
    }

    const payload = {
      message: caption,
      access_token: token,
    };

    attachedMedia.forEach((media, index) => {
      payload[`attached_media[${index}]`] = JSON.stringify(media);
    });

    const feedPost = await graphPost(`${pageId}/feed`, payload);

    return { success: true, id: feedPost.id };
  } catch (err) {
    console.error("Facebook erro:", err.message);
    return { success: false, error: err.message };
  }
}

// ======================================================
// PUBLICAR NO TELEGRAM
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
      const resp = await telegramPost("sendMessage", {
        chat_id: chatId,
        text: caption,
        parse_mode: "HTML",
      }, token);

      return { success: true, result: resp.result };
    }

    if (imagens.length === 1) {
      const resp = await telegramPost("sendPhoto", {
        chat_id: chatId,
        photo: imagens[0],
        caption: caption,
        parse_mode: "HTML",
      }, token);

      return { success: true, result: resp.result };
    }

    // Grupo de mídias (Carrossel no Telegram)
    const media = imagens.map((img, index) => ({
      type: "photo",
      media: img,
      caption: index === 0 ? caption : undefined,
      parse_mode: "HTML",
    }));

    const resp = await telegramPost("sendMediaGroup", {
      chat_id: chatId,
      media: media,
    }, token);

    return { success: true, result: resp.result };
  } catch (err) {
    console.error("Telegram erro:", err.message);
    return { success: false, error: err.message };
  }
}

// ======================================================
// HANDLER PRINCIPAL (API ROUTE)
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

    // Processamento de imagens via ImgBB se aplicável
    const imagensProntas = await processarImagensParaMeta(imagensOriginais);

    // Executa as postagens em paralelo para otimizar tempo
    const [instagramResult, facebookResult, telegramResult] = await Promise.all([
      publicarNoInstagram(imagensProntas, legenda),
      publicarNoFacebook(imagensProntas, legenda),
      publicarNoTelegram(imagensOriginais, legenda),
    ]);

    return res.status(200).json({
      success: true,
      results: {
        instagram: instagramResult,
        facebook: facebookResult,
        telegram: telegramResult,
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
