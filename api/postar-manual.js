// api/postar-manual.js - VERSÃO COM TIMEOUT E RETRY
const { Jimp } = require('jimp');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  const FACEBOOK_PAGE_ID = process.env.FACEBOOK_PAGE_ID;
  const FACEBOOK_PAGE_TOKEN = process.env.FACEBOOK_PAGE_TOKEN;
  const INSTAGRAM_BUSINESS_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const IMGBB_API_KEY = process.env.IMGBB_API_KEY;
  const THREADS_USER_ID = process.env.THREADS_USER_ID;
  const THREADS_ACCESS_TOKEN = process.env.THREADS_ACCESS_TOKEN;

  // Função de fetch com timeout
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

  // Função de fetch com retry
  async function fetchWithRetry(url, options = {}, maxRetries = 3, timeout = 30000) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetchWithTimeout(url, options, timeout);
        
        if (response.ok) {
          return response;
        }
        
        // Se for erro 4xx ou 5xx, tenta novamente
        console.log(`Tentativa ${i + 1} falhou com status ${response.status}, tentando novamente...`);
        
        // Espera antes de tentar novamente
        await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
      } catch (err) {
        console.log(`Tentativa ${i + 1} falhou: ${err.message}`);
        
        if (i === maxRetries - 1) {
          throw err;
        }
        
        // Espera antes de tentar novamente
        await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
      }
    }
    
    throw new Error('Todas as tentativas falharam');
  }

  // Baixa a imagem original, converte para JPEG e re-hospeda no imgbb.
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

      const uploadResp = await fetchWithTimeout(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ image: base64 }),
      }, 30000);

      const uploadData = await uploadResp.json();

      if (uploadData.success) {
        return uploadData.data.url;
      } else {
        console.error('Falha ao re-hospedar no imgbb:', JSON.stringify(uploadData));
        return urlOriginal;
      }
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
        error: "É necessário enviar uma legenda" 
      });
    }

    if (!imagens || !Array.isArray(imagens) || imagens.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: "É necessário enviar pelo menos uma imagem" 
      });
    }

    const imagensValidas = imagens.filter(img => img && img.trim() !== "");
    
    if (imagensValidas.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: "É necessário enviar pelo menos uma imagem válida" 
      });
    }

    console.log(`Processando ${imagensValidas.length} imagens...`);

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

    console.log("Legenda completa:", legendaCompleta.slice(0, 200));

    // Rehospeda as imagens
    const imagensProcessadas = [];
    
    for (let i = 0; i < imagensValidas.length; i++) {
      try {
        console.log(`Rehospedando imagem ${i + 1}...`);
        const imagemProcessada = await rehospedarImagem(imagensValidas[i]);
        console.log(`Imagem ${i + 1} processada`);
        imagensProcessadas.push(imagemProcessada);
      } catch (err) {
        console.error(`Erro ao processar imagem ${i + 1}:`, err);
        imagensProcessadas.push(imagensValidas[i]); // Usa original
      }
    }

    console.log("Imagens processadas:", imagensProcessadas);

    // Publica no Instagram
    const resultado = await publicarNoInstagram(imagensProcessadas, legendaCompleta);

    if (resultado.success) {
      console.log("✅ Postagem realizada com sucesso!");
      return res.status(200).json({ 
        success: true, 
        message: "Postagem realizada com sucesso!",
        postId: resultado.postId
      });
    } else {
      console.error("❌ Falha ao publicar:", resultado.error);
      return res.status(500).json({ 
        success: false, 
        error: resultado.error 
      });
    }

  } catch (err) {
    console.error("Erro geral:", err);
    return res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
}

// Função para publicar no Instagram
async function publicarNoInstagram(imagens, caption) {
  try {
    const IG_TOKEN = process.env.IG_ACCESS_TOKEN;
    const IG_BUSINESS_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || "17841467530671368";

    if (!IG_TOKEN) {
      throw new Error("IG_TOKEN não configurado");
    }

    console.log(`Publicando no Instagram com ${imagens.length} imagens...`);

    if (imagens.length === 1) {
      return await publicarImagemUnica(imagens[0], caption, IG_TOKEN, IG_BUSINESS_ID);
    }
    
    return await publicarCarrossel(imagens, caption, IG_TOKEN, IG_BUSINESS_ID);
    
  } catch (err) {
    console.error("Erro ao publicar no Instagram:", err);
    return {
      success: false,
      error: err.message
    };
  }
}

// Publica uma única imagem
async function publicarImagemUnica(imagemUrl, caption, token, businessId) {
  try {
    console.log("Publicando imagem única...");
    
    const createUrl = `https://graph.instagram.com/v21.0/${businessId}/media`;
    const createResponse = await fetchWithTimeout(createUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image_url: imagemUrl,
        caption: caption,
        access_token: token
      }),
    }, 30000);

    const createData = await createResponse.json();
    
    if (createData.error) {
      throw new Error(`Erro ao criar container: ${createData.error.message}`);
    }

    console.log("Container criado:", createData.id);

    const publishUrl = `https://graph.instagram.com/v21.0/${businessId}/media_publish`;
    const publishResponse = await fetchWithTimeout(publishUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        creation_id: createData.id,
        access_token: token
      }),
    }, 30000);

    const publishData = await publishResponse.json();
    
    if (publishData.error) {
      throw new Error(`Erro ao publicar: ${publishData.error.message}`);
    }

    console.log("Publicado com sucesso:", publishData.id);

    return {
      success: true,
      postId: publishData.id
    };

  } catch (err) {
    console.error("Erro ao publicar imagem única:", err);
    return {
      success: false,
      error: err.message
    };
  }
}

// Publica carrossel de imagens
async function publicarCarrossel(imagens, caption, token, businessId) {
  try {
    console.log("Publicando carrossel...");
    
    const containerIds = [];
    
    for (let i = 0; i < imagens.length; i++) {
      console.log(`Criando container para imagem ${i + 1}...`);
      console.log(`URL da imagem ${i + 1}:`, imagens[i]);
      
      try {
        const createUrl = `https://graph.instagram.com/v21.0/${businessId}/media`;
        const createResponse = await fetchWithTimeout(createUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            image_url: imagens[i],
            is_carousel_item: true,
            access_token: token
          }),
        }, 45000); // Timeout maior para containers

        const createData = await createResponse.json();
        
        if (createData.error) {
          console.error(`Erro detalhado container ${i + 1}:`, createData.error);
          throw new Error(`Erro ao criar container ${i + 1}: ${createData.error.message}`);
        }

        containerIds.push(createData.id);
        console.log(`Container ${i + 1} criado:`, createData.id);
        
        // Delay entre containers
        if (i < imagens.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      } catch (err) {
        console.error(`Falha ao criar container ${i + 1}:`, err);
        
        // Se falhar, tenta com a imagem original (sem rehospedar)
        if (i === imagens.length - 1 && containerIds.length >= 1) {
          console.log("Tentando continuar com as imagens que funcionaram...");
          break; // Continua com as imagens que já foram criadas
        }
        
        throw err;
      }
    }

    if (containerIds.length === 0) {
      throw new Error("Nenhum container foi criado com sucesso");
    }

    console.log(`Containers criados: ${containerIds.length} de ${imagens.length}`);

    // Se só tem 1 container, publica como imagem única
    if (containerIds.length === 1) {
      console.log("Apenas 1 container, publicando como imagem única...");
      const publishUrl = `https://graph.instagram.com/v21.0/${businessId}/media_publish`;
      const publishResponse = await fetchWithTimeout(publishUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          creation_id: containerIds[0],
          access_token: token
        }),
      }, 30000);

      const publishData = await publishResponse.json();
      
      if (publishData.error) {
        throw new Error(`Erro ao publicar: ${publishData.error.message}`);
      }

      return {
        success: true,
        postId: publishData.id
      };
    }

    // Cria o container do carrossel
    console.log("Criando container do carrossel...");
    const carouselUrl = `https://graph.instagram.com/v21.0/${businessId}/media`;
    const carouselResponse = await fetchWithTimeout(carouselUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        media_type: "CAROUSEL",
        children: containerIds,
        caption: caption,
        access_token: token
      }),
    }, 30000);

    const carouselData = await carouselResponse.json();
    
    if (carouselData.error) {
      throw new Error(`Erro ao criar carrossel: ${carouselData.error.message}`);
    }

    console.log("Carrossel criado:", carouselData.id);

    // Publica o carrossel
    console.log("Publicando carrossel...");
    const publishUrl = `https://graph.instagram.com/v21.0/${businessId}/media_publish`;
    const publishResponse = await fetchWithTimeout(publishUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        creation_id: carouselData.id,
        access_token: token
      }),
    }, 30000);

    const publishData = await publishResponse.json();
    
    if (publishData.error) {
      throw new Error(`Erro ao publicar carrossel: ${publishData.error.message}`);
    }

    console.log("Carrossel publicado com sucesso:", publishData.id);

    return {
      success: true,
      postId: publishData.id
    };

  } catch (err) {
    console.error("Erro ao publicar carrossel:", err);
    return {
      success: false,
      error: err.message
    };
  }
}

export const config = { 
  api: { 
    bodyParser: true,
    maxDuration: 120,
  } 
};
