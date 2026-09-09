// api/postar-manual.js - VERSÃO CORRIGIDA (aceita "legenda" e "caption")
const { Jimp } = require('jimp');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === "OPTIONS") {
    return res.status(200).send("OK");
  }

  if (req.method === "POST") {
    try {
      const body = req.body;
      
      console.log("Body recebido:", JSON.stringify(body).slice(0, 1000));

      // Aceita tanto "caption" quanto "legenda"
      const caption = body.caption || body.legenda || body.texto || "";
      const imagens = body.imagens || body.images || [];
      const precoAtual = body.precoAtual || body.preco_atual || "";
      const precoOriginal = body.precoOriginal || body.preco_original || "";
      const linkAfiliado = body.linkAfiliado || body.link_afiliado || "";

      console.log("Dados extraídos:", {
        caption: caption.slice(0, 100),
        numImagens: imagens.length,
        precoAtual,
        precoOriginal,
        linkAfiliado
      });

      // Validações
      if (!caption || caption.trim() === "") {
        console.error("Legenda vazia");
        return res.status(400).json({ 
          success: false, 
          error: "É necessário enviar uma legenda" 
        });
      }

      if (!imagens || !Array.isArray(imagens) || imagens.length === 0) {
        console.error("Sem imagens");
        return res.status(400).json({ 
          success: false, 
          error: "É necessário enviar pelo menos uma imagem" 
        });
      }

      // Filtra imagens vazias
      const imagensValidas = imagens.filter(img => img && img.trim() !== "");
      
      if (imagensValidas.length === 0) {
        console.error("Nenhuma imagem válida");
        return res.status(400).json({ 
          success: false, 
          error: "É necessário enviar pelo menos uma imagem válida" 
        });
      }

      console.log(`Processando ${imagensValidas.length} imagens...`);

      // Monta a legenda completa
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

      // Publica no Instagram
      const resultado = await publicarNoInstagram(imagensValidas, legendaCompleta);

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

  return res.status(405).json({ error: "Method Not Allowed" });
}

// Função para publicar no Instagram
async function publicarNoInstagram(imagens, caption) {
  try {
    const IG_TOKEN = process.env.IG_ACCESS_TOKEN;
    const IG_BUSINESS_ID = process.env.IG_BUSINESS_ID || "17841467530671368";

    if (!IG_TOKEN) {
      throw new Error("IG_TOKEN não configurado");
    }

    console.log(`Publicando no Instagram com ${imagens.length} imagens...`);

    // Se for apenas uma imagem
    if (imagens.length === 1) {
      return await publicarImagemUnica(imagens[0], caption, IG_TOKEN, IG_BUSINESS_ID);
    }
    
    // Se forem múltiplas imagens (carrossel)
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
    console.log("URL da imagem:", imagemUrl);
    
    // Cria o container
    const createUrl = `https://graph.instagram.com/v21.0/${businessId}/media`;
    const createResponse = await fetch(createUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image_url: imagemUrl,
        caption: caption,
        access_token: token
      }),
    });

    const createData = await createResponse.json();
    console.log("Resposta criação container:", JSON.stringify(createData));
    
    if (createData.error) {
      throw new Error(`Erro ao criar container: ${createData.error.message}`);
    }

    console.log("Container criado:", createData.id);

    // Publica o container
    const publishUrl = `https://graph.instagram.com/v21.0/${businessId}/media_publish`;
    const publishResponse = await fetch(publishUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        creation_id: createData.id,
        access_token: token
      }),
    });

    const publishData = await publishResponse.json();
    console.log("Resposta publicação:", JSON.stringify(publishData));
    
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
    
    // Cria containers para cada imagem
    const containerIds = [];
    
    for (let i = 0; i < imagens.length; i++) {
      console.log(`Criando container para imagem ${i + 1}...`);
      
      const createUrl = `https://graph.instagram.com/v21.0/${businessId}/media`;
      const createResponse = await fetch(createUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          image_url: imagens[i],
          is_carousel_item: true,
          access_token: token
        }),
      });

      const createData = await createResponse.json();
      
      if (createData.error) {
        throw new Error(`Erro ao criar container ${i + 1}: ${createData.error.message}`);
      }

      containerIds.push(createData.id);
      console.log(`Container ${i + 1} criado:`, createData.id);
      
      // Pequeno delay entre containers
      if (i < imagens.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Cria o container do carrossel
    console.log("Criando container do carrossel...");
    const carouselUrl = `https://graph.instagram.com/v21.0/${businessId}/media`;
    const carouselResponse = await fetch(carouselUrl, {
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
    });

    const carouselData = await carouselResponse.json();
    
    if (carouselData.error) {
      throw new Error(`Erro ao criar carrossel: ${carouselData.error.message}`);
    }

    console.log("Carrossel criado:", carouselData.id);

    // Publica o carrossel
    console.log("Publicando carrossel...");
    const publishUrl = `https://graph.instagram.com/v21.0/${businessId}/media_publish`;
    const publishResponse = await fetch(publishUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        creation_id: carouselData.id,
        access_token: token
      }),
    });

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
