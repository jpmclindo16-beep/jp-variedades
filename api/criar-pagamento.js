const { MercadoPagoConfig, Preference } = require("mercadopago");

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN
});

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Método não permitido"
    });
  }

  try {
    const { produto_id, cliente } = req.body || {};

    if (!produto_id) {
      return res.status(400).json({
        error: "Produto não informado"
      });
    }

    if (!cliente || !cliente.nome || !cliente.telefone) {
      return res.status(400).json({
        error: "Dados do cliente incompletos"
      });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({
        error: "Supabase não configurado na Vercel"
      });
    }

    const produtoResponse = await fetch(
      `${supabaseUrl}/rest/v1/produtos?id=eq.${encodeURIComponent(produto_id)}&ativo=eq.true&limit=1`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`
        }
      }
    );

    if (!produtoResponse.ok) {
      throw new Error("Erro ao consultar produto");
    }

    const produtos = await produtoResponse.json();

    if (!produtos.length) {
      return res.status(404).json({
        error: "Produto não encontrado"
      });
    }

    const produto = produtos[0];

    if (
      produto.tipo &&
      produto.tipo.toLowerCase() !== "dropshipping"
    ) {
      return res.status(400).json({
        error: "Este produto não é de dropshipping"
      });
    }

    const preco = Number(produto.preco_atual);

    if (!preco || preco <= 0) {
      return res.status(400).json({
        error: "Preço do produto inválido"
      });
    }

    const preference = new Preference(client);

    const resultado = await preference.create({
      body: {
        items: [
          {
            id: String(produto.id),
            title: String(produto.nome).substring(0, 256),
            quantity: 1,
            unit_price: preco,
            currency_id: "BRL"
          }
        ],

        payer: {
          name: cliente.nome,
          phone: {
            number: cliente.telefone.replace(/\D/g, "")
          }
        },

        back_urls: {
          success: `${process.env.SITE_URL}/pedido.html?status=sucesso`,
          failure: `${process.env.SITE_URL}/checkout.html?id=${encodeURIComponent(produto.id)}&status=erro`,
          pending: `${process.env.SITE_URL}/pedido.html?status=pendente`
        },

        auto_return: "approved",

        notification_url:
          `${process.env.SITE_URL}/api/pagamento-webhook`,

        external_reference:
          `JP-${produto.id}-${Date.now()}`,

        metadata: {
          produto_id: String(produto.id),
          cliente_nome: cliente.nome,
          cliente_cpf: cliente.cpf || "",
          cliente_telefone: cliente.telefone,
          cliente_cep: cliente.cep || "",
          cliente_endereco: cliente.endereco || "",
          cliente_numero: cliente.numero || "",
          cliente_complemento: cliente.complemento || "",
          cliente_bairro: cliente.bairro || "",
          cliente_cidade: cliente.cidade || "",
          cliente_estado: cliente.estado || ""
        }
      }
    });

    return res.status(200).json({
      id: resultado.id,
      init_point: resultado.init_point,
      sandbox_init_point: resultado.sandbox_init_point
    });

  } catch (error) {

    console.error("ERRO MERCADO PAGO:", error);

    return res.status(500).json({
      error: "Não foi possível criar o pagamento"
    });
  }
};
