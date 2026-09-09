// api/postar-manual.js
const jimpModule = require("jimp");

const Jimp = jimpModule.Jimp || jimpModule;

const GRAPH_VERSION = "v21.0";

// ======================================================
// FETCH COM TIMEOUT
// ======================================================
async function fetchWithTimeout(url, options = {}, timeout = 30000) {
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
// LER JSON COM SEGURANÇA
// ======================================================
async function lerJsonSeguro(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

// ======================================================
// CONVERTER IMAGEM PARA JPEG
// ======================================================
async function obterBufferJpeg(image) {
  const mime = Jimp.MIME_JPEG || "image/jpeg";

  if (typeof image.quality === "function") {
    image.quality(90);
  }

  if (typeof image.getBufferAsync === "function") {
    return await image.getBufferAsync(mime);
  }

  try {
    const result = image.getBuffer(mime);

    if (result && typeof result.then === "function") {
      return await result;
    }

    if (Buffer.isBuffer(result)) {
      return result;
    }
  } catch {
    // tenta método com callback abaixo
  }

  return await new Promise((resolve, reject) => {
    image.getBuffer(mime, (err, buffer) => {
      if (err) reject(err);
      else resolve(buffer);
    });
  });
}

// ======================================================
// RE-HOSPEDAR IMAGEM NO IMGBB
// ======================================================
async function rehospedarImagem(urlOriginal) {
  const IMGBB_API_KEY = process.env.IMGBB_API_KEY;

  if (!urlOriginal || !IMGBB_API_KEY) {
    return urlOriginal;
  }

  try {
    console.log("Baixando imagem original:", urlOriginal);

    const imgResp = await fetchWithTimeout(urlOriginal, {}, 20000);

    if (!imgResp.ok) {
      console.error("Falha ao baixar imagem original:", imgResp.status);
      return urlOriginal;
    }

    const bufferOriginal = Buffer.from(await imgResp.arrayBuffer());

    let bufferFinal = bufferOriginal;

    try {
      const image = await Jimp.read(bufferOriginal);
      bufferFinal = await obterBufferJpeg(image);
      console.log("Imagem convertida para JPEG");
    } catch (convErr) {
      console.error("Falha ao converter imagem para JPEG, usando original:", convErr.message);
    }

    const base64 = bufferFinal.toString("base64");

    const uploadResp = await fetchWithTimeout(
      `https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          image: base64,
        }),
      },
      45000
    );

    const uploadData = await lerJsonSeguro(uploadResp);

    if (uploadData.success && uploadData.data && uploadData.data.url) {
      console.log("Imagem re-hospedada:", uploadData.data.url);
      return uploadData.data.url;
    }

    console.error("Falha ao re-hospedar no imgbb:", JSON.stringify(uploadData));
    return urlOriginal;
  } catch (err) {
    console.error("Erro ao re-hospedar imagem:", err.message);
    return urlOriginal;
  }
}

// ======================================================
// PUBLICAR NO INSTAGRAM
// USA O MESMO TOKEN DO FACEBOOK
// ======================================================
async function publicarNoInstagram(imagens, caption) {
  try {
    const IG_TOKEN = process.env.FACEBOOK_PAGE_TOKEN;
    const IG_BUSINESS_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

    if (!IG_TOKEN) {
      return {
        success: false,
        skipped: true,
        error: "FACEBOOK_PAGE_TOKEN não configurado",
      };
    }

    if (!IG_BUSINESS_ID) {
      return {
        success: false,
        skipped: true,
        error: "INSTAGRAM_BUSINESS_ACCOUNT_ID não configurado",
      };
    }

    console.log(`Publicando no Instagram com ${imagens.length} imagem(ns)...`);

    const imagensLimitadas = imagens.slice(0, 10);

    if (imagensLimitadas.length === 1) {
      return await publicarImagemUnicaInstagram(
        imagensLimitadas[0],
        caption,
        IG_TOKEN,
        IG_BUSINESS_ID
      );
    }

    return await publicarCarrosselInstagram(
      imagensLimitadas,
      caption,
      IG_TOKEN,
      IG_BUSINESS_ID
    );
  } catch (err) {
    console.error("Erro ao publicar no Instagram:", err.message);

    return {
      success: false,
      error: err.message,
    };
  }
}

// ======================================================
// INSTAGRAM - IMAGEM ÚNICA
// ======================================================
async function publicarImagemUnicaInstagram(imagemUrl, caption, token, businessId) {
  try {
    console.log("Criando container Instagram imagem única...");

    const createUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${businessId}/media`;

    const createResponse = await fetchWithTimeout(
      createUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          image_url: imagemUrl,
          caption,
          access_token: token,
        }),
      },
      45000
    );

    const createData = await lerJsonSeguro(createResponse);

    if (!createResponse.ok || createData.error) {
      throw new Error(
        createData.error?.message || "Erro ao criar container do Instagram"
      );
    }

    console.log("Container Instagram criado:", createData.id);

    await new Promise(resolve => setTimeout(resolve, 8000));

    const publishUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${businessId}/media_publish`;

    const publishResponse = await fetchWithTimeout(
      publishUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          creation_id: createData.id,
          access_token: token,
        }),
      },
      45000
    );

    const publishData = await lerJsonSeguro(publishResponse);

    if (!publishResponse.ok || publishData.error) {
      throw new Error(
        publishData.error?.message || "Erro ao publicar no Instagram"
      );
    }

    console.log("Instagram publicado com sucesso:", publishData.id);

    return {
      success: true,
      postId: publishData.id,
    };
  } catch (err) {
    console.error("Erro Instagram imagem única:", err.message);

    return {
      success: false,
      error: err.message,
    };
  }
}

// ======================================================
// INSTAGRAM - CARROSSEL
// ======================================================
async function publicarCarrosselInstagram(imagens, caption, token, businessId) {
  try {
    console.log("Criando carrossel Instagram...");

    const containerIds = [];

    for (let i = 0; i < imagens.length; i++) {
      console.log(`Criando container Instagram ${i + 1}...`);

      const createUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${businessId}/media`;

      const createResponse = await fetchWithTimeout(
        createUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            image_url: imagens[i],
            is_carousel_item: "true",
            access_token: token,
          }),
        },
        45000
      );

      const createData = await lerJsonSeguro(createResponse);

      if (!createResponse.ok || createData.error) {
        throw new Error(
          createData.error?.message ||
          `Erro ao criar container Instagram ${i + 1}`
        );
      }

      containerIds.push(createData.id);

      console.log(`Container Instagram ${i + 1} criado:`, createData.id);

      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    console.log("Containers filhos Instagram:", containerIds);

    const carouselUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${businessId}/media`;

    const carouselResponse = await fetchWithTimeout(
      carouselUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          media_type: "CAROUSEL",
          children: containerIds.join(","),
          caption,
          access_token: token,
        }),
      },
      45000
    );

    const carouselData = await lerJsonSeguro(carouselResponse);

    if (!carouselResponse.ok || carouselData.error) {
      throw new Error(
        carouselData.error?.message ||
        "Erro ao criar container principal do carrossel Instagram"
      );
    }

    console.log("Container principal do carrossel Instagram criado:", carouselData.id);

    await new Promise(resolve => setTimeout(resolve, 10000));

    const publishUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${businessId}/media_publish`;

    const publishResponse = await fetchWithTimeout(
      publishUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          creation_id: carouselData.id,
          access_token: token,
        }),
      },
      45000
    );

    const publishData = await lerJsonSeguro(publishResponse);

    if (!publishResponse.ok || publishData.error) {
      throw new Error(
        publishData.error?.message ||
        "Erro ao publicar carrossel no Instagram"
      );
    }

    console.log("Carrossel Instagram publicado com sucesso:", publishData.id);

    return {
      success: true,
      postId: publishData.id,
    };
  } catch (err) {
    console.error("Erro Instagram carrossel:", err.message);

    return {
      success: false,
      error: err.message,
    };
  }
}

// ======================================================
// PUBLICAR NO FACEBOOK
// ======================================================
async function publicarNoFacebook(imagens, caption) {
  try {
    const FACEBOOK_PAGE_ID = process.env.FACEBOOK_PAGE_ID;
    const FACEBOOK_PAGE_TOKEN = process.env.FACEBOOK_PAGE_TOKEN;

    if (!FACEBOOK_PAGE_ID) {
      return {
        success: false,
        skipped: true,
        error: "FACEBOOK_PAGE_ID não configurado",
      };
    }

    if (!FACEBOOK_PAGE_TOKEN) {
      return {
        success: false,
        skipped: true,
        error: "FACEBOOK_PAGE_TOKEN não configurado",
      };
    }

    console.log(`Publicando no Facebook com ${imagens.length} imagem(ns)...`);

    const imagensLimitadas = imagens.slice(0, 10);

    if (imagensLimitadas.length === 1) {
      return await publicarFotoUnicaFacebook(
        imagensLimitadas[0],
        caption,
        FACEBOOK_PAGE_ID,
        FACEBOOK_PAGE_TOKEN
      );
    }

    return await publicarMultiplasFotosFacebook(
      imagensLimitadas,
      caption,
      FACEBOOK_PAGE_ID,
      FACEBOOK_PAGE_TOKEN
    );
  } catch (err) {
    console.error("Erro ao publicar no Facebook:", err.message);

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
    console.log("Publicando foto única no Facebook...");

    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/photos`;

    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          url: imagemUrl,
          caption,
          access_token: token,
        }),
      },
      45000
    );

    const data = await lerJsonSeguro(response);

    if (!response.ok || data.error) {
      throw new Error(
        data.error?.message || "Erro ao publicar foto no Facebook"
      );
    }

    console.log("Facebook publicado com sucesso:", data.post_id || data.id);

    return {
      success: true,
      postId: data.post_id || data.id,
    };
  } catch (err) {
    console.error("Erro Facebook foto única:", err.message);

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
    console.log("Publicando múltiplas fotos no Facebook...");

    const mediaFbids = [];

    for (let i = 0; i < imagens.length; i++) {
      console.log(`Enviando imagem Facebook ${i + 1} como não publicada...`);

      const photoUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/photos`;

      const photoResponse = await fetchWithTimeout(
        photoUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            url: imagens[i],
            published: "false",
            access_token: token,
          }),
        },
        45000
      );

      const photoData = await lerJsonSeguro(photoResponse);

      if (!photoResponse.ok || photoData.error) {
        throw new Error(
          photoData.error?.message ||
          `Erro ao enviar imagem Facebook ${i + 1}`
        );
      }

      mediaFbids.push(photoData.id);

      console.log(`Imagem Facebook ${i + 1} enviada:`, photoData.id);
    }

    const feedUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/feed`;

    const params = new URLSearchParams({
      message: caption,
      access_token: token,
    });

    mediaFbids.forEach((id, index) => {
      params.append(
        `attached_media[${index}]`,
        JSON.stringify({
          media_fbid: id,
        })
      );
    });

    const feedResponse = await fetchWithTimeout(
      feedUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      },
      45000
    );

    const feedData = await lerJsonSeguro(feedResponse);

    if (!feedResponse.ok || feedData.error) {
      throw new Error(
        feedData.error?.message ||
        "Erro ao publicar post com múltiplas imagens no Facebook"
      );
    }

    console.log("Facebook múltiplas fotos publicado com sucesso:", feedData.id);

    return {
      success: true,
      postId: feedData.id,
    };
  } catch (err) {
    console.error("Erro Facebook múltiplas fotos:", err.message);

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
    const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    if (!TELEGRAM_TOKEN) {
      return {
        success: false,
        skipped: true,
        error: "TELEGRAM_BOT_TOKEN não configurado",
      };
    }

    if (!TELEGRAM_CHAT_ID) {
      return {
        success: false,
        skipped: true,
        error: "TELEGRAM_CHAT_ID não configurado",
      };
    }

    console.log(`Publicando no Telegram com ${imagens.length} imagem(ns)...`);

    const imagensLimitadas = imagens.slice(0, 10);

    if (imagensLimitadas.length === 1) {
      return await publicarFotoUnicaTelegram(
        imagensLimitadas[0],
        caption,
        TELEGRAM_TOKEN,
        TELEGRAM_CHAT_ID
      );
    }

    return await publicarAlbumTelegram(
      imagensLimitadas,
      caption,
      TELEGRAM_TOKEN,
      TELEGRAM_CHAT_ID
    );
  } catch (err) {
    console.error("Erro ao publicar no Telegram:", err.message);

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
    console.log("Publicando foto única no Telegram...");

    const url = `https://api.telegram.org/bot${token}/sendPhoto`;

    const captionCurta = caption.length <= 1024;

    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: chatId,
          photo: imagemUrl,
          caption: captionCurta ? caption : undefined,
        }),
      },
      30000
    );

    const data = await lerJsonSeguro(response);

    if (!response.ok || data.ok === false) {
      throw new Error(
        data.description || "Erro ao enviar foto para o Telegram"
      );
    }

    if (!captionCurta) {
      await enviarMensagemTelegram(caption, token, chatId);
    }

    console.log("Telegram publicado com sucesso:", data.result?.message_id);

    return {
      success: true,
      postId: data.result?.message_id,
    };
  } catch (err) {
    console.error("Erro Telegram foto única:", err.message);

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
    console.log("Publicando álbum no Telegram...");

    const url = `https://api.telegram.org/bot${token}/sendMediaGroup`;

    const captionCurta = caption.length <= 1024;

    const media = imagens.map((imagemUrl, index) => ({
      type: "photo",
      media: imagemUrl,
      caption: index === 0 && captionCurta ? caption : undefined,
    }));

    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: chatId,
          media,
        }),
      },
      45000
    );

    const data = await lerJsonSeguro(response);

    if (!response.ok || data.ok === false) {
      throw new Error(
        data.description || "Erro ao enviar álbum para o Telegram"
      );
    }

    if (!captionCurta) {
      await enviarMensagemTelegram(caption, token, chatId);
    }

    console.log("Álbum Telegram publicado com sucesso");

    return {
      success: true,
      postId: data.result?.[0]?.message_id,
    };
  } catch (err) {
    console.error("Erro Telegram álbum:", err.message);

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
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: texto,
      }),
    },
    30000
  );

  const data = await lerJsonSeguro(response);

  if (!response.ok || data.ok === false) {
    throw new Error(
      data.description || "Erro ao enviar mensagem para o Telegram"
    );
  }

  return data;
}

// ========================================================
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
    .filter(img => img !== "");

  return [...new Set(imagensValidas)];
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

    const caption = body.caption || body.legenda || body.texto || "";
    const precoAtual = body.precoAtual || body.preco_atual || "";
    const precoOriginal = body.precoOriginal || body.preco_original || "";
    const linkAfiliado = body.linkAfiliado || body.link_afiliado || "";

    if (!caption || caption.trim() === "") {
      return res.status(400).json({
        success: false,
        error: "É necessário enviar uma legenda",
      });
    }

    const imagensValidas = normalizarImagens(body);

    if (imagensValidas.length === 0) {
      return res.status(400).json({
        success: false,
        error: "É necessário enviar pelo menos uma imagem válida",
      });
    }

    console.log(`Total de imagens válidas: ${imagensValidas.length}`);

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

    console.log("Legenda completa:", legendaCompleta.slice(0, 300));

    const imagensProcessadas = [];

    for (let i = 0; i < imagensValidas.length; i++) {
      try {
        console.log(`Processando imagem ${i + 1}...`);

        const imagemProcessada = await rehospedarImagem(imagensValidas[i]);

        imagensProcessadas.push(imagemProcessada);

        console.log(`Imagem ${i + 1} pronta:`, imagemProcessada);
      } catch (err) {
        console.error(`Erro ao processar imagem ${i + 1}:`, err.message);

        imagensProcessadas.push(imagensValidas[i]);
      }
    }

    console.log("Imagens finais:", imagensProcessadas);

    const [instagram, facebook, telegram] = await Promise.all([
      publicarNoInstagram(imagensProcessadas, legendaCompleta),
      publicarNoFacebook(imagensProcessadas, legendaCompleta),
      publicarNoTelegram(imagensProcessadas, legendaCompleta),
    ]);

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
        message: "Postagem processada para Instagram, Facebook e Telegram.",
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
