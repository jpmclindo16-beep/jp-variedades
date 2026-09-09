// api/postar-manual.js
// Publica imagens do ImgBB no Instagram/Facebook e Telegram.
// IMPORTANTE: Instagram exige imagem JPEG pública. Se a imagem for PNG/WebP,
// configure IMGBB_API_KEY para o servidor converter e re-hospedar como JPG.

const jimpModule = require('jimp');
const Jimp = jimpModule.Jimp || jimpModule;
const JimpMime = jimpModule.JimpMime || {};

const GRAPH_VERSION = process.env.GRAPH_VERSION || 'v23.0';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  },
  maxDuration: 60
};

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchWithTimeout(url, options = {}, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readResponse(response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function graphPost(path, params, timeout = 45000) {
  const response = await fetchWithTimeout(
    `https://graph.facebook.com/${GRAPH_VERSION}/${path}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(params)
    },
    timeout
  );

  const data = await readResponse(response);

  if (!response.ok || data.error) {
    throw new Error(
      data.error?.message ||
      data.raw ||
      `Meta HTTP ${response.status}`
    );
  }

  return data;
}

async function graphGet(path, params, timeout = 30000) {
  const qs = new URLSearchParams(params);

  const response = await fetchWithTimeout(
    `https://graph.facebook.com/${GRAPH_VERSION}/${path}?${qs}`,
    {},
    timeout
  );

  const data = await readResponse(response);

  if (!response.ok || data.error) {
    throw new Error(
      data.error?.message ||
      data.raw ||
      `Meta HTTP ${response.status}`
    );
  }

  return data;
}

async function telegramPost(method, payload, token, timeout = 45000) {
  const response = await fetchWithTimeout(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    },
    timeout
  );

  const data = await readResponse(response);

  if (!response.ok || data.ok === false) {
    throw new Error(
      data.description ||
      data.raw ||
      `Telegram HTTP ${response.status}`
    );
  }

  return data;
}

function getJpegMime() {
  return (
    JimpMime.jpeg ||
    JimpMime.JPEG ||
    jimpModule.MIME_JPEG ||
    Jimp.MIME_JPEG ||
    'image/jpeg'
  );
}

async function toJpeg(buffer) {
  const image = await Jimp.read(buffer);

  if (typeof image.quality === 'function') {
    image.quality(90);
  }

  if (typeof image.background === 'function') {
    image.background(0xffffffff);
  }

  const mime = getJpegMime();

  if (typeof image.getBufferAsync === 'function') {
    return image.getBufferAsync(mime);
  }

  const result = image.getBuffer(mime);

  if (result && typeof result.then === 'function') {
    return await result;
  }

  if (Buffer.isBuffer(result)) {
    return result;
  }

  return await new Promise((resolve, reject) => {
    image.getBuffer(
      mime,
      (err, b) => {
        if (err) {
          reject(err);
        } else {
          resolve(b);
        }
      }
    );
  });
}

function isDirectImageUrl(url) {
  try {
    const u = new URL(url);

    return (
      (u.protocol === 'https:' || u.protocol === 'http:') &&
      !!u.hostname
    );
  } catch {
    return false;
  }
}

async function uploadImgBB(buffer, name) {
  const key = process.env.IMGBB_API_KEY;

  if (!key) {
    throw new Error(
      'IMGBB_API_KEY não configurada. Ela é necessária para converter PNG/WebP em JPEG para o Instagram.'
    );
  }

  const response = await fetchWithTimeout(
    `https://api.imgbb.com/1/upload?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        image: buffer.toString('base64'),
        name
      })
    },
    45000
  );

  const data = await readResponse(response);

  if (
    !response.ok ||
    !data.success ||
    !data.data?.url
  ) {
    throw new Error(
      `ImgBB: ${
        data.error?.message ||
        data.raw ||
        'falha no upload'
      }`
    );
  }

  return data.data.url;
}

async function prepararImagemInstagram(url) {
  if (!isDirectImageUrl(url)) {
    throw new Error(`URL de imagem inválida: ${url}`);
  }

  // Instagram aceita JPEG para publicação de imagem.
  // Sempre convertemos/re-hospedamos para evitar problemas
  // com PNG/WebP do gerador de IA.

  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    },
    30000
  );

  if (!response.ok) {
    throw new Error(
      `Não consegui baixar a imagem (${response.status}): ${url}`
    );
  }

  const contentType = (
    response.headers.get('content-type') || ''
  ).toLowerCase();

  if (!contentType.startsWith('image/')) {
    throw new Error(
      `A URL não retornou uma imagem (${
        contentType || 'tipo desconhecido'
      }): ${url}`
    );
  }

  const original = Buffer.from(
    await response.arrayBuffer()
  );

  if (original.length === 0) {
    throw new Error('A imagem veio vazia.');
  }

  const jpg = await toJpeg(original);

  return await uploadImgBB(
    jpg,
    `instagram-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.jpg`
  );
}

function normalizeImages(body) {
  let arr = body.imagens || body.images || [];

  if (!Array.isArray(arr)) {
    arr = [arr];
  }

  arr = [
    ...arr,
    body.imagem,
    body.image,
    body.imagem1,
    body.imagem2,
    body.imagem3,
    body.imagem4,
    body.imagem5
  ]
    .filter(x => typeof x === 'string')
    .map(x => x.trim())
    .filter(Boolean)
    .filter(isDirectImageUrl);

  return [...new Set(arr)].slice(0, 10);
}

function buildCaption(body) {
  const base = String(
    body.caption ||
    body.legenda ||
    body.texto ||
    ''
  ).trim();

  const current =
    body.precoAtual ||
    body.preco_atual ||
    '';

  const old =
    body.precoOriginal ||
    body.preco_original ||
    '';

  const link =
    body.linkAfiliado ||
    body.link_afiliado ||
    '';

  let c = base;

  if (current) {
    c += `\n\n💰 Preço: R$ ${current}`;
  }

  if (old) {
    c += `\n📉 De: R$ ${old}`;
  }

  if (link) {
    c += `\n\n🔗 Link: ${link}`;
  }

  return c.trim();
}

function normalizeNetworks(body) {
  const r = body.redes || body.networks;

  if (!r) {
    return {
      instagram: true,
      facebook: true,
      telegram: true
    };
  }

  const a = Array.isArray(r)
    ? r
    : Object.entries(r)
        .filter(([, v]) => v)
        .map(([k]) => k);

  return {
    instagram: a.includes('instagram'),
    facebook: a.includes('facebook'),
    telegram: a.includes('telegram')
  };
}

function limitedInstagramCaption(c) {
  return c.length <= 2200
    ? c
    : c.slice(0, 2197) + '...';
}

async function publishInstagram(images, caption) {
  const token = process.env.FACEBOOK_PAGE_TOKEN;
  const igId =
    process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

  if (!token) {
    return {
      success: false,
      skipped: true,
      error: 'FACEBOOK_PAGE_TOKEN não configurado'
    };
  }

  if (!igId) {
    return {
      success: false,
      skipped: true,
      error:
        'INSTAGRAM_BUSINESS_ACCOUNT_ID não configurado'
    };
  }

  if (!process.env.IMGBB_API_KEY) {
    return {
      success: false,
      error:
        'IMGBB_API_KEY não configurada. Como suas imagens são PNG, preciso converter para JPEG antes do Instagram.'
    };
  }

  try {
    const jpgUrls = [];

    for (const url of images) {
      jpgUrls.push(
        await prepararImagemInstagram(url)
      );
    }

    caption = limitedInstagramCaption(caption);

    // UMA IMAGEM
    if (jpgUrls.length === 1) {
      const media = await graphPost(
        `${igId}/media`,
        {
          image_url: jpgUrls[0],
          caption,
          access_token: token
        }
      );

      const published =
        await publishInstagramContainer(
          media.id,
          token
        );

      return {
        success: true,
        postId: published.id
      };
    }

    // CARROSSEL
    const children = [];

    for (const url of jpgUrls) {
      const child = await graphPost(
        `${igId}/media`,
        {
          image_url: url,
          is_carousel_item: 'true',
          access_token: token
        }
      );

      children.push(child.id);

      await delay(1200);
    }

    const carousel = await graphPost(
      `${igId}/media`,
      {
        media_type: 'CAROUSEL',
        children: children.join(','),
        caption,
        access_token: token
      }
    );

    const published =
      await publishInstagramContainer(
        carousel.id,
        token
      );

    return {
      success: true,
      postId: published.id
    };

  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

async function publishInstagramContainer(
  creationId,
  token
) {
  let last = '';

  // Verifica o status antes de publicar.
  for (let i = 0; i < 8; i++) {
    try {
      const status = await graphGet(
        creationId,
        {
          fields: 'status_code,status',
          access_token: token
        }
      );

      const code = status.status_code;

      if (
        code === 'ERROR' ||
        code === 'EXPIRED'
      ) {
        throw new Error(
          status.status ||
          `Container ${code}`
        );
      }

      if (
        code === 'FINISHED' ||
        !code
      ) {
        break;
      }

      last = `Instagram container: ${code}`;

    } catch (err) {
      last = err.message;
    }

    await delay(3000);
  }

  const published = await graphPost(
    `${process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID}/media_publish`,
    {
      creation_id: creationId,
      access_token: token
    }
  );

  return published;
}

async function publishFacebook(images, caption) {
  const pageId =
    process.env.FACEBOOK_PAGE_ID;

  const token =
    process.env.FACEBOOK_PAGE_TOKEN;

  if (!pageId) {
    return {
      success: false,
      skipped: true,
      error:
        'FACEBOOK_PAGE_ID não configurado'
    };
  }

  if (!token) {
    return {
      success: false,
      skipped: true,
      error:
        'FACEBOOK_PAGE_TOKEN não configurado'
    };
  }

  try {
    // UMA IMAGEM
    if (images.length === 1) {
      const data = await graphPost(
        `${pageId}/photos`,
        {
          url: images[0],
          message: caption,
          access_token: token
        }
      );

      return {
        success: true,
        postId: data.post_id || data.id
      };
    }

    // VÁRIAS IMAGENS
    const ids = [];

    for (const url of images) {
      const p = await graphPost(
        `${pageId}/photos`,
        {
          url,
          published: 'false',
          access_token: token
        }
      );

      ids.push(p.id);
    }

    const params = {
      message: caption,
      access_token: token
    };

    ids.forEach((id, i) => {
      params[`attached_media[${i}]`] =
        JSON.stringify({
          media_fbid: id
        });
    });

    const feed = await graphPost(
      `${pageId}/feed`,
      params
    );

    return {
      success: true,
      postId: feed.id
    };

  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

async function publishTelegram(
  images,
  caption
) {
  const token =
    process.env.TELEGRAM_BOT_TOKEN;

  const chatId =
    process.env.TELEGRAM_CHAT_ID;

  if (!token) {
    return {
      success: false,
      skipped: true,
      error:
        'TELEGRAM_BOT_TOKEN não configurado'
    };
  }

  if (!chatId) {
    return {
      success: false,
      skipped: true,
      error:
        'TELEGRAM_CHAT_ID não configurado'
    };
  }

  try {
    // UMA IMAGEM
    if (images.length === 1) {

      if (caption.length <= 1024) {
        const d = await telegramPost(
          'sendPhoto',
          {
            chat_id: chatId,
            photo: images[0],
            caption
          },
          token
        );

        return {
          success: true,
          postId:
            d.result?.message_id
        };
      }

      const d = await telegramPost(
        'sendPhoto',
        {
          chat_id: chatId,
          photo: images[0]
        },
        token
      );

      await telegramPost(
        'sendMessage',
        {
          chat_id: chatId,
          text: caption
        },
        token
      );

      return {
        success: true,
        postId:
          d.result?.message_id
      };
    }

    // VÁRIAS IMAGENS
    const media = images.map(
      (url, i) => ({
        type: 'photo',
        media: url,
        ...(i === 0 &&
        caption.length <= 1024
          ? { caption }
          : {})
      })
    );

    const d = await telegramPost(
      'sendMediaGroup',
      {
        chat_id: chatId,
        media
      },
      token
    );

    if (caption.length > 1024) {
      await telegramPost(
        'sendMessage',
        {
          chat_id: chatId,
          text: caption
        },
        token
      );
    }

    return {
      success: true,
      postId:
        d.result?.[0]?.message_id
    };

  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

function settled(x) {
  return x.status === 'fulfilled'
    ? x.value
    : {
        success: false,
        error:
          x.reason?.message ||
          'Erro desconhecido'
      };
}

export default async function handler(
  req,
  res
) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Método não permitido'
    });
  }

  try {
    const body = req.body || {};

    const caption =
      buildCaption(body);

    const images =
      normalizeImages(body);

    const networks =
      normalizeNetworks(body);

    if (!caption) {
      return res.status(400).json({
        success: false,
        error:
          'É necessário enviar uma legenda.'
      });
    }

    if (!images.length) {
      return res.status(400).json({
        success: false,
        error:
          'É necessário enviar pelo menos uma URL de imagem válida.'
      });
    }

    const tasks = [
      networks.instagram
        ? publishInstagram(
            images,
            caption
          )
        : Promise.resolve({
            success: false,
            skipped: true,
            error: 'Não selecionado'
          }),

      networks.facebook
        ? publishFacebook(
            images,
            caption
          )
        : Promise.resolve({
            success: false,
            skipped: true,
            error: 'Não selecionado'
          }),

      networks.telegram
        ? publishTelegram(
            images,
            caption
          )
        : Promise.resolve({
            success: false,
            skipped: true,
            error: 'Não selecionado'
          })
    ];

    const raw =
      await Promise.allSettled(tasks);

    const resultados = {
      instagram: settled(raw[0]),
      facebook: settled(raw[1]),
      telegram: settled(raw[2])
    };

    const success =
      resultados.instagram.success ||
      resultados.facebook.success ||
      resultados.telegram.success;

    return res.status(
      success ? 200 : 500
    ).json({
      success,
      message: success
        ? 'Postagem processada.'
        : 'Nenhuma rede conseguiu publicar.',
      resultados
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
        }
