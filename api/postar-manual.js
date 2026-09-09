// api/postar-manual.js

export const config = {
  maxDuration: 60,
};

const GRAPH_VERSION = "v21.0";

// ======================================================
// DELAY
// ======================================================
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ======================================================
// FETCH COM TIMEOUT
// ======================================================
async function fetchWithTimeout(url, options = {}, timeout = 25000) {
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

// ======================================================
// LER RESPOSTA COM SEGURANÇA
// ======================================================
async function lerResposta(response) {
  const texto = await response.text();

  try {
    return JSON.parse(texto);
  } catch {
    return {
      raw: texto,
    };
  }
}

// ======================================================
// POST GRAPH API FACEBOOK/INSTAGRAM
// ======================================================
async function graphPost(path, params, timeout = 25000) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${path}`;

  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params),
    },
    timeout
  );

  const data = await lerResposta(response);

  if (!response.ok || data.error) {
    throw new Error(
      data.error?.message ||
      data.description ||
      data.raw ||
      "Erro na API Graph"
    );
  }

  return data;
}

// ======================================================
// POST TELEGRAM
// ======================================================
async function telegramPost(method, payload, token, timeout = 25000) {
  const url = `https://api.telegram.org/bot${token}/${method}`;

  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    timeout
  );

  const data = await lerResposta(response);

  if (!response.ok || data.ok === false) {
    throw new Error(
      data.description ||
      data.raw ||
      "Erro na API do Telegram"
    );
  }

  return data;
}

// ======================================================
// NORMALIZAR IMAGENS
// ======================================================
function normalizarImagens(body) {
  let imagens = body.imagens || body.images || [];

  if (!Array.isArray(imagens)) {
    imagens = [imagens];
  }

  const extras = [
    body.imagem,
    body.image,
    body.imagem1,
    body.imagem2,
    body.imagem3,
    body.imagem4,
    body.imagem5,
    body.image1,
    body.image2,
    body.image3,
    body.image4,
    body.image5,
  ];

  imagens = [...imagens, ...extras];

  const imagensValidas = imagens
    .filter(img => typeof img === "string")
    .map(img => img.trim())
    .filter(img => img !== "")
    .filter(img => img.startsWith("http://") || img.startsWith("https://"));

  return [...new Set(imagensValidas)].slice(0, 10);
}

// ======================================================
// MONTAR LEGENDA
// ======================================================
function montarLegenda(body) {
  const caption = body.caption || body.legenda || body.texto || "";
  const precoAtual = body.precoAtual || body.preco_atual || "";
  const precoOriginal = body.precoOriginal || body.preco_original || "";
  const linkAfiliado = body.linkAfiliado || body.link_afiliado || "";

  let legendaCompleta = caption.trim();

  if (precoAtual) {
    legendaCompleta += `\n\n💰 Preço: R$ ${precoAtual}`;
  }

  if (precoOriginal) {
    legendaCompleta += `\n📉 De: R$ ${precoOriginal}`;
  }

  if (linkAfiliado) {
    legendaCompleta += `\n\n🔗 Link: ${linkAfiliado}`;
  }

  return legendaCompleta;
}

// ======================================================
// LIMITAR LEGENDA INSTAGRAM
// ======================================================
function limitarLegendaInstagram(caption) {
  if (caption.length <= 2200) {
    return caption;
  }

  return caption.slice(0, 2190) + "...";
}

// ======================================================
// PUBLICAR NO INSTAGRAM
// USA O MESMO TOKEN DO FACEBOOK
// ======================================================
async function publicarNoInstagram(imagens, caption) {
  try {
    const token = process.env.FACEBOOK_PAGE_TOKEN;
    const instagramId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

    if (!token) {
      return {
        success: false,
        skipped: true,
        error: "FACEBOOK_PAGE_TOKEN não configurado",
      };
    }

    if (!instagramId) {
      return {
        success: false,
        skipped: true,
        error: "INSTAGRAM_BUSINESS_ACCOUNT_ID não configurado",
      };
    }

    const legendaInstagram = limitarLegendaInstagram(caption);

    console.log(`Instagram: publicando ${imagens.length} imagem(ns)`);

    if (imagens.length === 1) {
      return await publicarImagemUnicaInstagram(
        imagens[0],
        legendaInstagram,
        token,
        instagramId
      );
    }

    return await publicarCarrosselInstagram(
      imagens,
      legendaInstagram,
      token,
      instagramId
    );
  } catch (err) {
    console.error("Instagram erro:", err.message);

    return {
      success: false,
      error: err.message,
    };
  }
}

// ======================================================
// INSTAGRAM - IMAGEM ÚNICA
// ======================================================
async function publicarImagemUnicaInstagram(imagemUrl, caption, token, instagramId) {
  try {
    console.log("Instagram: criando container de imagem única");

    const media = await graphPost(
      `${instagramId}/media`,
      {
        image_url: imagemUrl,
        caption,
        access_token: token,
      },
      25000
    );

    console.log("Instagram: container criado:", media.id);

    await delay(5000);

    const publicado = await publicarContainerInstagramComRetry(
      media.id,
      token,
      instagramId
    );

    return {
      success: true,
      postId: publicado.id,
    };
  } catch (err) {
    console.error("Instagram imagem única erro:", err.message);

    return {
      success: false,
      error: err.message,
    };
  }
}

// ======================================================
// INSTAGRAM - CARROSSEL
// ======================================================
async function publicarCarrosselInstagram(imagens, caption, token, instagramId) {
  try {
    console.log("Instagram: criando carrossel");

    const containerIds = [];

    for (let i = 0; i < imagens.length; i++) {
      console.log(`Instagram: criando container filho ${i + 1}`);

      const media = await graphPost(
        `${instagramId}/media`,
        {
          image_url: imagens[i],
          is_carousel_item: "true",
          access_token: token,
        },
        25000
      );

      containerIds.push(media.id);

      console.log(`Instagram: container filho ${i + 1} criado:`, media.id);

      await delay(1500);
    }

    console.log("Instagram: criando container principal do carrossel");

    const carousel = await graphPost(
      `${instagramId}/media`,
      {
        media_type: "CAROUSEL",
        children: containerIds.join(","),
        caption,
        access_token: token,
      },
      25000
    );

    console.log("Instagram: container principal criado:", carousel.id);

    await delay(5000);

    const publicado = await publicarContainerInstagramComRetry(
      carousel.id,
      token,
      instagramId
    );

    return {
      success: true,
      postId: publicado.id,
    };
  } catch (err) {
    console.error("Instagram carrossel erro:", err.message);

    return {
      success: false,
      error: err.message,
    };
  }
}

// ======================================================
// INSTAGRAM - PUBLICAR CONTAINER COM RETRY
// ======================================================
async function publicarContainerInstagramComRetry(creationId, token, instagramId) {
  let ultimoErro = null;

  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      console.log(`Instagram: tentando publicar, tentativa ${tentativa}`);

      const publicado = await graphPost(
        `${instagramId}/media_publish`,
        {
          creation_id: creationId,
          access_token: token,
        },
        25000
      );

      console.log("Instagram: publicado com sucesso:", publicado.id);

      return publicado;
    } catch (err) {
      ultimoErro = err;

      console.error(`Instagram: tentativa ${tentativa} falhou:`, err.message);

      if (tentativa < 3) {
        await delay(5000);
      }
    }
  }

  throw ultimoErro;
}

// ======================================================
// PUBLICAR NO FACEBOOK
// ======================================================
async function publicarNoFacebook(imagens, caption) {
  try {
    const pageId = process.env.FACEBOOK_PAGE_ID;
    const token = process.env.FACEBOOK_PAGE_TOKEN;

    if (!pageId) {
      return {
        success: false,
        skipped: true,
        error: "FACEBOOK_PAGE_ID não configurado",
      };
    }

    if (!token) {
      return {
        success: false,
        skipped: true,
        error: "FACEBOOK_PAGE_TOKEN não configurado",
      };
    }

    console.log(`Facebook: publicando ${imagens.length} imagem(ns)`);

    if (imagens.length === 1) {
      return await publicarFotoUnicaFacebook(
        imagens[0],
        caption,
        pageId,
        token
      );
    }

    return await publicarMultiplasFotosFacebook(
      imagens,
      caption,
      pageId,
      token
    );
  } catch (err) {
    console.error("Facebook erro:", err.message);

    return {
      success: false,
      error: err.message,
    };
  }
}

// ======================================================
// FACEBOOK - FOTO ÚNICA
// ======================================================
async function publicarFotoUnicaFacebook(imagemUrl, caption, pageId, token) {
  try {
    const data = await graphPost(
      `${pageId}/photos`,
      {
        url: imagemUrl,
        caption,
        access_token: token,
      },
      25000
    );

    console.log("Facebook: foto publicada:", data.post_id || data.id);

    return {
      success: true,
      postId: data.post_id || data.id,
    };
  } catch (err) {
    console.error("Facebook foto única erro:", err.message);

    return {
      success: false,
      error: err.message,
    };
  }
}

// ======================================================
// FACEBOOK - MÚLTIPLAS FOTOS
// ======================================================
async function publicarMultiplasFotosFacebook(imagens, caption, pageId, token) {
  try {
    const mediaFbids = [];

    for (let i = 0; i < imagens.length; i++) {
      console.log(`Facebook: enviando imagem ${i + 1}`);

      const photo = await graphPost(
        `${pageId}/photos`,
        {
          url: imagens[i],
          published: "false",
          access_token: token,
        },
        25000
      );

      mediaFbids.push(photo.id);

      console.log(`Facebook: imagem ${i + 1} enviada:`, photo.id);
    }

    const params = {
      message: caption,
      access_token: token,
    };

    mediaFbids.forEach((id, index) => {
      params[`attached_media[${index}]`] = JSON.stringify({
        media_fbid: id,
      });
    });

    const feed = await graphPost(
      `${pageId}/feed`,
      params,
      25000
    );

    console.log("Facebook: post publicado:", feed.id);

    return {
      success: true,
      postId: feed.id,
    };
  } catch (err) {
    console.error("Facebook múltiplas fotos erro:", err.message);

    return {
      success: false,
      error: err.message,
    };
  }
}

// ======================================================
// PUBLICAR NO TELEGRAM
// ======================================================
async function publicarNoTelegram(imagens, caption) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token) {
      return {
        success: false,
        skipped: true,
        error: "TELEGRAM_BOT_TOKEN não configurado",
      };
    }

    if (!chatId) {
      return {
        success: false,
        skipped: true,
        error: "TELEGRAM_CHAT_ID não configurado",
      };
    }

    console.log(`Telegram: publicando ${imagens.length} imagem(ns)`);

    if (imagens.length === 1) {
      return await publicarFotoUnicaTelegram(
        imagens[0],
        caption,
        token,
        chatId
      );
    }

    return await publicarAlbumTelegram(
      imagens,
      caption,
      token,
      chatId
    );
  } catch (err) {
    console.error("Telegram erro:", err.message);

    return {
      success: false,
      error: err.message,
    };
  }
}

// ======================================================
// TELEGRAM - FOTO ÚNICA
// ======================================================
async function publicarFotoUnicaTelegram(imagemUrl, caption, token, chatId) {
  try {
    const captionCurta = caption.length <= 1024;

    const data = await telegramPost(
      "sendPhoto",
      {
        chat_id: chatId,
        photo: imagemUrl,
        caption: captionCurta ? caption : undefined,
      },
      token,
      25000
    );

    if (!captionCurta) {
      await enviarMensagemTelegram(caption, token, chatId);
    }

    console.log("Telegram: foto publicada:", data.result?.message_id);

    return {
      success: true,
      postId: data.result?.message_id,
    };
  } catch (err) {
    console.error("Telegram foto erro:", err.message);

    return {
      success: false,
      error: err.message,
    };
  }
}

// ======================================================
// TELEGRAM - ÁLBUM
// ======================================================
async function publicarAlbumTelegram(imagens, caption, token, chatId) {
  try {
    const captionCurta = caption.length <= 1024;

    const media = imagens.map((imagemUrl, index) => ({
      type: "photo",
      media: imagemUrl,
      caption: index === 0 && captionCurta ? caption : undefined,
    }));

    const data = await telegramPost(
      "sendMediaGroup",
      {
        chat_id: chatId,
        media,
      },
      token,
      25000
    );

    if (!captionCurta) {
      await enviarMensagemTelegram(caption, token, chatId);
    }

    console.log("Telegram: álbum publicado");

    return {
      success: true,
      postId: data.result?.[0]?.message_id,
    };
  } catch (err) {
    console.error("Telegram álbum erro:", err.message);

    return {
      success: false,
      error: err.message,
    };
  }
}

// ======================================================
// TELEGRAM - MENSAGEM SEPARADA
// ======================================================
async function enviarMensagemTelegram(texto, token, chatId) {
  return await telegramPost(
    "sendMessage",
    {
      chat_id: chatId,
      text: texto,
    },
    token,
    25000
  );
}

// ======================================================
// NORMALIZAR RESULTADO PROMISE
// ======================================================
function resultadoPromise(resultado) {
  if (resultado.status === "fulfilled") {
    return resultado.value;
  }

  return {
    success: false,
    error: resultado.reason?.message || "Erro desconhecido",
  };
}

// ======================================================
// HANDLER PRINCIPAL
// ======================================================
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Método não permitido",
    });
  }

  try {
    const body = req.body || {};

    console.log("Body recebido:", JSON.stringify(body).slice(0, 1000));

    const legendaCompleta = montarLegenda(body);
    const imagensValidas = normalizarImagens(body);

    if (!legendaCompleta || legendaCompleta.trim() === "") {
      return res.status(400).json({
        success: false,
        error: "É necessário enviar uma legenda",
      });
    }

    if (imagensValidas.length === 0) {
      return res.status(400).json({
        success: false,
        error: "É necessário enviar pelo menos uma imagem válida",
      });
    }

    console.log("Legenda:", legendaCompleta.slice(0, 300));
    console.log("Imagens:", imagensValidas);

    const resultadosRaw = await Promise.allSettled([
      publicarNoInstagram(imagensValidas, legendaCompleta),
      publicarNoFacebook(imagensValidas, legendaCompleta),
      publicarNoTelegram(imagensValidas, legendaCompleta),
    ]);

    const instagram = resultadoPromise(resultadosRaw[0]);
    const facebook = resultadoPromise(resultadosRaw[1]);
    const telegram = resultadoPromise(resultadosRaw[2]);

    const resultados = {
      instagram,
      facebook,
      telegram,
    };

    const sucessoGeral =
      instagram.success ||
      facebook.success ||
      telegram.success;

    if (sucessoGeral) {
      return res.status(200).json({
        success: true,
        message: "Postagem processada.",
        resultados,
      });
    }

    return res.status(500).json({
      success: false,
      error: "Nenhuma rede conseguiu publicar.",
      resultados,
    });
  } catch (err) {
    console.error("Erro geral:", err.message);

    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}
  
