// api/postar-manual.js
const { Jimp } = require('jimp');

// Função de fetch com timeout - fora do handler
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

// Função de fetch com retry - fora do handler
async function fetchWithRetry(url, options = {}, maxRetries = 3, timeout = 30000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetchWithTimeout(url, options, timeout);

      if (response.ok) {
        return response;
      }

      console.log(
        `Tentativa ${i + 1} falhou com status ${response.status}, tentando novamente...`
      );

      await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
    } catch (err) {
      console.log(`Tentativa ${i + 1} falhou: ${err.message}`);

      if (i === maxRetries - 1) {
        throw err;
      }

      await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
    }
  }

  throw new Error('Todas as tentativas falharam');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const IMGBB_API_KEY = process.env.IMGBB_API_KEY;

  async function rehospedarImagem(urlOriginal) {
    if (!urlOriginal || !IMGBB_API_KEY) return urlOriginal;

    try {
      const imgResp = await fetchWithTimeout(urlOriginal, {}, 15000);

      if (!imgResp.ok) {
        console.error('Falha ao baixar imagem original:', imgResp.status);
        return urlOriginal;
      }

      const bufferOriginal = Buffer.from(await imgResp.arrayBuffer());

      let bufferFinal = bufferOriginal;

      try {
        const image = await Jimp.read(bufferOriginal);
        bufferFinal = await image.getBuffer(Jimp.MIME_JPEG);
      } catch (convErr) {
        console.error('Falha ao converter imagem para JPEG, usando original:', convErr);
      }

      const base64 = bufferFinal.toString('base64');

      const uploadResp = await fetchWithTimeout(
        `https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ image: base64 }),
        },
        30000
      );

      const uploadData = await uploadResp.json();

      if (uploadData.success) {
        return uploadData.data.url;
      }

      console.error('Falha ao re-hospedar no imgbb:', JSON.stringify(uploadData));
      return urlOriginal;
    } catch (err) {
      console.error('Erro ao re-hospedar imagem:', err);
      return urlOriginal;
    }
  }

  try {
    const body = req.body;

    console.log("Body recebido:", JSON.stringify(body).slice(0, 1000));

    const caption = body.caption || body.legenda || body.texto || "";
    const imagens = body.imagens || body.images || [];
    const precoAtual = body.precoAtual || body.preco_atual || "";
    const precoOriginal = body.precoOriginal || body.preco_original || "";
    const linkAfiliado = body.linkAfiliado || body.link_afiliado || "";

    if (!caption || caption.trim() === "") {
      return res.status(400).json({
        success: false,
        error: "É necessário enviar uma legenda",
      });
    }

    if (!imagens || !Array.isArray(imagens) || imagens.length === 0) {
      return res.status(400).json({
        success: false,
        error: "É necessário enviar pelo menos uma imagem",
      });
    }

    const imagensValidas = imagens.filter(img => img && img.trim() !== "");

    if (imagensValidas.length === 0) {
      return res.status(400).json({
        success: false,
        error: "É necessário enviar pelo menos uma imagem válida",
      });
    }

    let legendaCompleta = caption;

    if (precoAtual) {
      legendaCompleta += `\n\n💰 Preço: R$ ${precoAtual}`;
    }

    if (precoOriginal) {
      legendaCompleta += `\n📉 De: R$ ${precoOriginal}`;
    }

    if (linkAfiliado) {
      legendaCompleta += `\n\n🔗 Link: ${linkAfiliado}`;
    }

    const imagensProcessadas = [];

    for (let i = 0; i < imagensValidas.length; i++) {
      try {
        console.log(`Rehospedando imagem ${i + 1}...`);
        const imagemProcessada = await rehospedarImagem(imagensValidas[i]);
        imagensProcessadas.push(imagemProcessada);
      } catch (err) {
        console.error(`Erro ao processar imagem ${i + 1}:`, err);
        imagensProcessadas.push(imagensValidas[i]);
      }
    }

    const resultado = await publicarNoInstagram(imagensProcessadas, legendaCompleta);

    if (resultado.success) {
      return res.status(200).json({
        success: true,
        message: "Postagem realizada com sucesso!",
        postId: resultado.postId,
      });
    }

    return res.status(500).json({
      success: false,
      error: resultado.error,
    });
  } catch (err) {
    console.error("Erro geral:", err);

    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}
