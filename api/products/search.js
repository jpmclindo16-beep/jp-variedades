export default async function handler(req, res) {
  // Permite somente GET
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Método não permitido"
    });
  }

  try {
    const source = String(req.query.source || "").toLowerCase();
    const q = String(req.query.q || "").trim();

    if (!q) {
      return res.status(400).json({
        error: "Digite o nome do produto para pesquisar."
      });
    }

    if (q.length < 2) {
      return res.status(400).json({
        error: "Digite pelo menos 2 caracteres."
      });
    }

    // Limita o tamanho da pesquisa
    const busca = q.substring(0, 100);

    /*
     * =========================================================
     * MERCADO LIVRE
     * =========================================================
     */
    if (
      source === "mercadolivre" ||
      source === "mercado livre" ||
      source === "mercado-livre" ||
      source === "meli"
    ) {
      const url =
        "https://api.mercadolibre.com/sites/MLB/search" +
        "?q=" +
        encodeURIComponent(busca) +
        "&limit=20";

      const response = await fetch(url);

      if (!response.ok) {
        const texto = await response.text();

        return res.status(response.status).json({
          error: "Erro ao consultar o Mercado Livre.",
          details: texto
        });
      }

      const data = await response.json();

      const products = (data.results || []).map((item) => ({
        id: item.id || "",
        title: item.title || "",
        price: Number(item.price || 0),
        original_price:
          item.original_price !== null &&
          item.original_price !== undefined
            ? Number(item.original_price)
            : null,

        currency_id: item.currency_id || "BRL",

        image_url:
          item.thumbnail ||
          (Array.isArray(item.pictures) && item.pictures[0]
            ? item.pictures[0].url
            : ""),

        url: item.permalink || "",

        source: "Mercado Livre",
        source_id: item.id || "",

        category_id: item.category_id || "",

        available_quantity:
          item.available_quantity !== undefined
            ? item.available_quantity
            : null,

        condition: item.condition || "",

        shipping_free:
          item.shipping &&
          item.shipping.free_shipping === true,

        seller_id: item.seller?.id || null
      }));

      return res.status(200).json({
        source: "Mercado Livre",
        query: busca,
        total: data.paging?.total || products.length,
        products
      });
    }

    /*
     * =========================================================
     * SHOPEE
     * =========================================================
     *
     * A integração da Shopee será adicionada depois usando
     * as credenciais da sua aplicação.
     */
    if (
      source === "shopee"
    ) {
      return res.status(501).json({
        error:
          "A integração da Shopee ainda não está configurada.",
        source: "Shopee"
      });
    }

    /*
     * =========================================================
     * SHEIN
     * =========================================================
     *
     * A SHEIN exige integração pela Open Platform e autorização
     * da aplicação. Não vamos colocar credenciais no frontend.
     */
    if (
      source === "shein"
    ) {
      return res.status(501).json({
        error:
          "A integração da SHEIN ainda precisa ser autorizada e configurada.",
        source: "SHEIN"
      });
    }

    return res.status(400).json({
      error: "Fonte de produtos não reconhecida.",
      allowed: [
        "Mercado Livre",
        "Shopee",
        "SHEIN"
      ]
    });

  } catch (error) {
    console.error("Erro em /api/products/search:", error);

    return res.status(500).json({
      error: "Erro interno ao pesquisar produtos.",
      details: error.message
    });
  }
}
