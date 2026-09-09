// api/postar-manual.js

const jimpModule = require("jimp");

const Jimp = jimpModule.Jimp || jimpModule;
const JimpMime = jimpModule.JimpMime || {};

const GRAPH_VERSION = "v21.0";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
  maxDuration: 60,
};

// ======================================================
// DELAY
// ======================================================
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ======================================================
// FETCH COM TIMEOUT
// ======================================================
async function fetchWithTimeout(url, options = {}, timeout = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
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
// POST GRAPH API
// ======================================================
async function graphPost(path, params, timeout = 30000) {
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
async function telegramPost(method, payload, token, timeout = 30000) {
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
// PEGAR MIME JPEG DO JIMP
// ======================================================
function getJpegMime() {
  return (
    JimpMime.jpeg ||
    JimpMime.JPEG ||
    jimpModule.MIME_JPEG ||
    Jimp.MIME_JPEG ||
    "image/jpeg"
  );
}

// ======================================================
// CONVERTER BUFFER PARA JPEG
// ======================================================
async function converterParaJpeg(bufferOriginal) {
  const mimeJpeg = getJpegMime();

  const image = await Jimp.read(bufferOriginal);

  if (typeof image.quality === "function") {
    image.quality(90);
  }

  if (typeof image.background === "function") {
    image.background(0xffffffff);
  }

  if (typeof image.getBufferAsync === "function") {
    return await image.getBufferAsync(mimeJpeg);
  }

  const result = image.getBuffer(mimeJpeg);

  if (result && typeof result.then === "function") {
    return await result;
  }

  if (Buffer.isBuffer(result)) {
    return result;
  }

  return await new Promise((resolve, reject) => {
    image.getBuffer(mimeJpeg, (err, buffer) => {
      if (err) reject(err);
      else resolve(buffer);
    });
  });
}

// ======================================================
// RE-HOSPEDAR IMAGEM NO IMGBB COMO JPG
// ======================================================
const DOMINIOS_CONFIAVEIS = [
  "i.ibb.co",
  "ibb.co",
];

function urlJaConfiavel(urlOriginal) {
  try {
    const host = new URL(urlOriginal).hostname;
    return DOMINIOS_CONFIAVEIS.some(
      dominio => host === dominio || host.endsWith(`.${dominio}`)
    );
  } catch {
    return false;
  }
}

async function rehospedarImagemNoImgBB(urlOriginal) {
  const IMGBB_API_KEY = process.env.IMGBB_API_KEY;

  if (!IMGBB_API_KEY) {
    console.log("IMGBB_API_KEY não configurada. Usando imagem original.");
    return urlOriginal;
  }

  if (urlJaConfiavel(urlOriginal)) {
    console.log("Imagem já está em domínio confiável, pulando re-hospedagem:", urlOriginal);
    return urlOriginal;
  }

  try {
    console.log("Baixando imagem:", urlOriginal);

    let imgResp;
    try {
      imgResp = await fetchWithTimeout(urlOriginal, {}, 25000);
    } catch (errPrimeiraTentativa) {
      console.error("Primeira tentativa de baixar imagem falhou, tentando de novo:", errPrimeiraTentativa.message);
      await delay(2000);
      imgResp = await fetchWithTimeout(urlOriginal, {}, 25000);
    }

    if (!imgResp.ok) {
      console.error("Falha ao baixar imagem:", imgResp.status);
      return urlOriginal;
    }

    const bufferOriginal = Buffer.from(await imgResp.arrayBuffer());

    let bufferFinal = bufferOriginal;

    try {
      bufferFinal = await converterParaJpeg(bufferOriginal);
      console.log("Imagem convertida para JPG");
    } catch (err) {
      console.error("Não conseguiu converter para JPG, usando original:", err.message);
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
          name: `produto-${Date.now()}.jpg`,
        }),
      },
      45000
    );

    const uploadData = await lerResposta(uploadResp);

    if (uploadData.success && uploadData.data?.url) {
      console.log("Imagem re-hospedada no ImgBB:", uploadData.data.url);
      return uploadData.data.url;
    }

    console.error("ImgBB falhou:", JSON.stringify(uploadData).slice(0, 500));
    return urlOriginal;
  } catch (err) {
    console.error("Erro ao re-hospedar imagem:", err.message);
    return urlOriginal;
  }
}

// ======================================================
// NORMALIZAR IMAGENS DO FORMULÁRIO
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
  const caption = body.caption || body.legenda || body.texto || body.legendaCompleta || "";
  const precoAtual = body.precoAtual || body.preco_atual || "";
  const precoOriginal = body.precoOriginal || body.preco_original || "";
  const linkAfiliado = body.linkAfiliado || body.link_afiliado || "";

  let legendaCompleta = String(caption).trim();

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
// LIMITAR LEGENDA DO INSTAGRAM
// ======================================================
function limitarLegendaInstagram(caption) {
  if (caption.length <= 2200) {
    return caption;
  }

  return caption.slice(0, 2190) + "...";
}

// ======================================================
// PROCESSAR IMAGENS PARA META
// ======================================================
async function processarImagensParaMeta(imagens) {
  const imagensProcessadas = [];

  for (let i = 0; i < imagens.length; i++) {
    console.log(`Processando imagem ${i + 1}/${imagens.length}`);

    const imagemFinal = await rehospedarImagemNoImgBB(imagens[i]);

    imagensProcessadas.push(imagemFinal);
  }

  return imagensProcessadas;
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

    if (!imagens || imagens.length === 0) {
      return {
        success: false,
        error: "Nenhuma imagem para postar no Instagram",
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
      45000
    );

    console.log("Instagram: container criado:", media.id);

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
        45000
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
      45000
    );

    console.log("Instagram: container principal criado:", carousel.id);

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
// INSTAGRAM - PUBLICAR COM RETRY
// ======================================================
async function publicarContainerInstagramComRetry(creationId, token, instagramId) {
  let ultimoErro = null;

  for (let tentativa = 1; tentativa <= 5; tentativa++) {
    try {
      const espera = tentativa === 1 ? 5000 : 4000;

      console.log(`Instagram: aguardando ${espera / 1000}s antes da tentativa ${tentativa}`);
      await delay(espera);

      console.log(`Instagram: publicando container, tentativa ${tentativa}`);

      const publicado = await graphPost(
        `${instagramId}/media_publish`,
        {
          creation_id: creationId,
          access_token: token,
        },
        45000
      );

      console.log("Instagram: publicado com sucesso:", publicado.id);

      return publicado;
    } catch (err) {
      ultimoErro = err;

      console.error(`Instagram: tentativa ${tentativa} falhou:`, err.message);
    }
  }

  throw ultimoErro || new Error("Não conseguiu publicar no Instagram");
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

    if (!imagens || imagens.length === 0) {
      return {
        success: false,
        error: "Nenhuma imagem para postar no Facebook",
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
    console.log("Facebook: publicando foto única");

    const data = await graphPost(
      `${pageId}/photos`,
      {
        url: imagemUrl,
        message: caption,
        access_token: token,
      },
      45000
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
    console.log("Facebook: publicando múltiplas fotos");

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
        45000
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
      45000
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

    if (!imagens || imagens.length === 0) {
      return {
        success: false,
        error: "Nenhuma imagem para postar no Telegram",
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
    console.log("Telegram: publicando foto única");

    const captionCurta = caption.length <= 1024;

    const data = await telegramPost(
      "sendPhoto",
      {
        chat_id: chatId,
        photo: imagemUrl,
        caption: captionCurta ? caption : undefined,
      },
      token,
      30000
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
    console.log("Telegram: publicando álbum");

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
      45000
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
    30000
  );
}

// ======================================================
// NORMALIZAR RESULTADO
// ======================================================
function normalizarResultado(resultado) {
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
    const imagensOriginais = normalizarImagens(body);

    if (!legendaCompleta || legendaCompleta.trim() === "") {
      return res.status(400).json({
        success: false,
        error: "É necessário enviar uma legenda",
      });
    }

    if (imagensOriginais.length === 0) {
      return res.status(400).json({
        success: false,
        error: "É necessário enviar pelo menos uma imagem válida",
      });
    }

    console.log("Legenda:", legendaCompleta.slice(0, 300));
    console.log("Imagens originais:", imagensOriginais);

    const imagensMeta = await processarImagensParaMeta(imagensOriginais);

    console.log("Imagens para Meta:", imagensMeta);

    const resultadosRaw = await Promise.allSettled([
      publicarNoInstagram(imagensMeta, legendaCompleta),
      publicarNoFacebook(imagensMeta, legendaCompleta),
      publicarNoTelegram(imagensOriginais, legendaCompleta),
    ]);

    const instagram = normalizarResultado(resultadosRaw[0]);
    const facebook = normalizarResultado(resultadosRaw[1]);
    const telegram = normalizarResultado(resultadosRaw[2]);

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
