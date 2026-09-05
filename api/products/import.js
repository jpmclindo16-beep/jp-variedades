export default async function handler(req, res) {
  // =========================================================
  // CONFIGURAÇÃO
  // =========================================================

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({
      error: "Supabase não configurado na Vercel.",
      message:
        "Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas Environment Variables."
    });
  }

  // =========================================================
  // MÉTODO
  // =========================================================

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Método não permitido."
    });
  }

  try {
    // =======================================================
    // DADOS RECEBIDOS
    // =======================================================

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

    const product = body?.product;
    const channels = Array.isArray(body?.channels)
      ? body.channels
      : [];

    if (!product || typeof product !== "object") {
      return res.status(400).json({
        error: "Produto não informado."
      });
    }

    // =======================================================
    // NORMALIZAÇÃO
    // =======================================================

    const nome =
      String(
        product.title ||
        product.nome ||
        ""
      ).trim();

    const imagem =
      String(
        product.image_url ||
        product.imagem_url ||
        product.thumbnail ||
        ""
      ).trim();

    const linkProduto =
      String(
        product.url ||
        product.link ||
        product.permalink ||
        product.link_afiliado ||
        ""
      ).trim();

    const loja =
      String(
        product.source ||
        product.loja_origem ||
        "Outro"
      ).trim();

    const preco =
      Number(
        product.price ??
        product.preco_atual ??
        0
      );

    const precoAntigo =
      Number(
        product.original_price ??
        product.preco_antigo ??
        0
      );

    // =======================================================
    // VALIDAÇÕES
    // =======================================================

    if (!nome) {
      return res.status(400).json({
        error: "O produto não possui nome."
      });
    }

    if (!imagem) {
      return res.status(400).json({
        error: "O produto não possui imagem."
      });
    }

    if (!preco || preco <= 0) {
      return res.status(400).json({
        error: "O produto não possui um preço válido."
      });
    }

    // =======================================================
    // EVITAR DUPLICADOS
    // =======================================================

    let produtoExistente = null;

    if (linkProduto) {
      const urlBusca =
        `${SUPABASE_URL}/rest/v1/produtos` +
        `?link_afiliado=eq.${encodeURIComponent(linkProduto)}` +
        `&select=id,nome,link_afiliado`;

      const checkResponse = await fetch(urlBusca, {
        method: "GET",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json"
        }
      });

      if (checkResponse.ok) {
        const existentes = await checkResponse.json();

        if (
          Array.isArray(existentes) &&
          existentes.length > 0
        ) {
          produtoExistente = existentes[0];
        }
      }
    }

    if (produtoExistente) {
      return res.status(409).json({
        error: "Este produto já está cadastrado.",
        product: produtoExistente
      });
    }

    // =======================================================
    // PREÇO
    // =======================================================

    // O preço importado é usado como preço atual.
    //
    // Se não houver preço antigo, usamos o mesmo preço.
    const precoFinal = Number(preco.toFixed(2));

    const precoDe =
      precoAntigo > precoFinal
        ? Number(precoAntigo.toFixed(2))
        : null;

    // =======================================================
    // DADOS PARA O SEU CATÁLOGO
    // =======================================================

    const novoProduto = {
      nome: nome.substring(0, 500),

      imagem_url: imagem,

      preco_antigo: precoDe,

      preco_atual: precoFinal,

      link_afiliado: linkProduto,

      categoria:
        String(
          product.category ||
          product.categoria ||
          "Ofertas"
        ).substring(0, 100),

      loja_origem: loja.substring(0, 100),

      destaque: false,

      ativo: true
    };

    // =======================================================
    // INSERIR NO SUPABASE
    // =======================================================

    const insertResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/produtos`,
      {
        method: "POST",

        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },

        body: JSON.stringify(novoProduto)
      }
    );

    const responseText =
      await insertResponse.text();

    let inserted;

    try {
      inserted = JSON.parse(responseText);
    } catch {
      inserted = responseText;
    }

    if (!insertResponse.ok) {
      console.error(
        "Erro Supabase:",
        insertResponse.status,
        inserted
      );

      return res.status(500).json({
        error: "Não foi possível cadastrar o produto no Supabase.",
        details: inserted
      });
    }

    // =======================================================
    // RESULTADO
    // =======================================================

    const produtoCriado =
      Array.isArray(inserted)
        ? inserted[0]
        : inserted;

    /*
     * IMPORTANTE:
     *
     * Neste momento o produto já foi salvo no SITE.
     *
     * Os canais abaixo são registrados como solicitados,
     * mas não vamos fingir que a publicação aconteceu.
     *
     * Telegram, WhatsApp, Facebook e Instagram precisam
     * de suas respectivas APIs/autorização.
     */

    return res.status(201).json({
      success: true,

      message:
        "Produto importado e cadastrado no catálogo.",

      product: produtoCriado,

      channels: channels,

      publication: {
        site: channels.includes("site"),
        telegram: false,
        whatsapp: false,
        facebook: false,
        instagram: false
      },

      next:
        channels.length > 0
          ? "O produto foi cadastrado. As publicações nas redes serão configuradas pelas APIs oficiais."
          : "Produto cadastrado no site."
    });

  } catch (error) {
    console.error(
      "Erro em /api/products/import:",
      error
    );

    return res.status(500).json({
      error: "Erro interno ao importar produto.",
      details: error.message
    });
  }
}
