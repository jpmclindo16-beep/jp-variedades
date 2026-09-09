// api/postar-manual.js - VERSÃO CORRIGIDA
const VERIFY_TOKEN = process.env.IG_WEBHOOK_VERIFY_TOKEN || "jp_shoppew_2026";
const IG_TOKEN = process.env.IG_ACCESS_TOKEN;
const PAGE_TOKEN = process.env.FACEBOOK_PAGE_TOKEN;
const IG_BUSINESS_ID = "17841467530671368";

// Importa Jimp de forma correta
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
      
      console.log("Recebendo requisição de postagem manual");
      console.log("Body:", JSON.stringify(body).slice(0, 500));

      // Valida os dados
      if (!body || !body.imagens || !Array.isArray(body.imagens) || body.imagens.length === 0) {
        console.error("Dados inválidos: sem imagens");
        return res.status(400).json({ 
          success: false, 
          error: "É necessário enviar pelo menos uma imagem" 
        });
      }

      if (!body.caption || body.caption.trim() === "") {
        console.error("Dados inválidos: sem caption");
        return res.status(400).json({ 
          success: false, 
          error: "É necessário enviar uma legenda" 
        });
      }

      console.log(`Processando ${body.imagens.length} imagens...`);

      // Rehospeda as imagens
      const imagensProcessadas = await Promise.all(
        body.imagens.map(async (imagem, index) => {
          try {
            console.log(`Processando imagem ${index + 1}...`);
            const imagemProcessada = await rehospedarImagem(imagem);
            console.log(`Imagem ${index + 1} processada com sucesso`);
            return imagemProcessada;
          } catch (err) {
            console.error(`Erro ao processar imagem ${index + 1}:`, err);
            // Retorna a imagem original se falhar
            return imagem;
          }
        })
      );

      console.log("Imagens processadas:", imagensProcessadas.length);

      // Publica no Instagram
      const resultado = await publicarNoInstagram(imagensProcessadas, body.caption);

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

// Função para rehospedar imagem (corrigida)
async function rehospedarImagem(imagemUrl) {
  try {
    console.log(`Rehospedando imagem: ${imagemUrl}`);
    
    // Baixa a imagem
    const response = await fetch(imagemUrl);
    if (!response.ok) {
      throw new Error(`Falha ao baixar imagem: ${response.status}`);
    }
    
    const buffer = await response.arrayBuffer();
    const imageBuffer = Buffer.from(buffer);
    
    console.log(`Imagem baixada: ${imageBuffer.length} bytes`);
    
    // Tenta converter para JPEG usando Jimp
    try {
      // Usando a API correta do Jimp
      const image = await Jimp.read(imageBuffer);
      
      // Converte para JPEG e obtém o buffer
      const jpegBuffer = await image.getBuffer(Jimp.MIME_JPEG);
      
      console.log(`Imagem convertida para JPEG: ${jpegBuffer.length} bytes`);
      
      // Aqui você pode fazer upload para um serviço de hospedagem
      // Por enquanto, retorna a URL original
      return imagemUrl;
      
    } catch (jimpError) {
      console.error("Erro ao converter com Jimp:", jimpError);
      // Se falhar, usa a imagem original
      return imagemUrl;
    }
    
  } catch (err) {
    console.error("Erro ao rehospedar imagem:", err);
    // Retorna a URL original em caso de erro
    return imagemUrl;
  }
}

// Função para publicar no Instagram
async function publicarNoInstagram(imagens, caption) {
  try {
    console.log(`Publicando no Instagram com ${imagens.length} imagens...`);
    
    // Verifica se tem token
    if (!IG_TOKEN) {
      throw new Error("IG_TOKEN não configurado");
    }

    // Se for apenas uma imagem
    if (imagens.length === 1) {
      return await publicarImagemUnica(imagens[0], caption);
    }
    
    // Se forem múltiplas imagens (carrossel)
    return await publicarCarrossel(imagens, caption);
    
  } catch (err) {
    console.error("Erro ao publicar no Instagram:", err);
    return {
      success: false,
      error: err.message
    };
  }
}

// Publica uma única imagem
async function publicarImagemUnica(imagemUrl, caption) {
  try {
    console.log("Publicando imagem única...");
    
    // Primeiro, cria o container
    const createUrl = `https://graph.instagram.com/v21.0/${IG_BUSINESS_ID}/media`;
    const createResponse = await fetch(createUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image_url: imagemUrl,
        caption: caption,
        access_token: IG_TOKEN
      }),
    });

    const createData = await createResponse.json();
    
    if (createData.error) {
      throw new Error(`Erro ao criar container: ${createData.error.message}`);
    }

    console.log("Container criado:", createData.id);

    // Depois, publica o container
    const publishUrl = `https://graph.instagram.com/v21.0/${IG_BUSINESS_ID}/media_publish`;
    const publishResponse = await fetch(publishUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        creation_id: createData.id,
        access_token: IG_TOKEN
      }),
    });

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
async function publicarCarrossel(imagens, caption) {
  try {
    console.log("Publicando carrossel...");
    
    // Primeiro, cria containers para cada imagem
    const containerIds = [];
    
    for (let i = 0; i < imagens.length; i++) {
      const createUrl = `https://graph.instagram.com/v21.0/${IG_BUSINESS_ID}/media`;
      const createResponse = await fetch(createUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          image_url: imagens[i],
          is_carousel_item: true,
          access_token: IG_TOKEN
        }),
      });

      const createData = await createResponse.json();
      
      if (createData.error) {
        throw new Error(`Erro ao criar container ${i + 1}: ${createData.error.message}`);
      }

      containerIds.push(createData.id);
      console.log(`Container ${i + 1} criado:`, createData.id);
    }

    // Depois, cria o container do carrossel
    const carouselUrl = `https://graph.instagram.com/v21.0/${IG_BUSINESS_ID}/media`;
    const carouselResponse = await fetch(carouselUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        media_type: "CAROUSEL",
        children: containerIds,
        caption: caption,
        access_token: IG_TOKEN
      }),
    });

    const carouselData = await carouselResponse.json();
    
    if (carouselData.error) {
      throw new Error(`Erro ao criar carrossel: ${carouselData.error.message}`);
    }

    console.log("Carrossel criado:", carouselData.id);

    // Finalmente, publica o carrossel
    const publishUrl = `https://graph.instagram.com/v21.0/${IG_BUSINESS_ID}/media_publish`;
    const publishResponse = await fetch(publishUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        creation_id: carouselData.id,
        access_token: IG_TOKEN
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
    maxDuration: 120, // Aumentado para 2 minutos
  } 
};
