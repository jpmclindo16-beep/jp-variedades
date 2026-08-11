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

    if (!cliente || !cliente.nome || !cliente.telefone || !cliente.cpf) {
      return res.status(400).json({
        error: "Dados do cliente incompletos. Nome, telefone e CPF são obrigatórios."
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

    // Limpa CPF (só números)
    const cpfLimpo = cliente.cpf.replace(/\D/g, "");
    const telLimpo = cliente.telefone.replace(/\D/g, "");
    const emailCliente = cliente.email || `cliente${Date.now()}@jpvariedades.com`;

    const preference = new Preference(client);

    const externalRef = `JP-${produto.id}-${Date.now()}`;

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
          email: emailCliente,
          phone: {
            number: telLimpo
          },
          identification: {
            type: "CPF",
            number: cpfLimpo
          }
        },

        back_urls: {
          success: `${process.env.SITE_URL}/pedido.html?status=sucesso`,
          failure: `${process.env.SITE_URL}/checkout.html?id=${encodeURIComponent(produto.id)}&status=erro`,
          pending: `${process.env.SITE_URL}/pedido.html?status=pendente`
        },

        auto_return: "approved",

        notification_url: `${process.env.SITE_URL}/api/pagamento-webhook`,

        external_reference: externalRef,

        metadata: {
          produto_id: String(produto.id),
          cliente_nome: cliente.nome,
          cliente_email: emailCliente,
          cliente_cpf: cpfLimpo,
          cliente_telefone: telLimpo,
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

    // ===== SALVA PEDIDO NO SUPABASE =====
    const pedidoBody = {
      mp_preference_id: resultado.id,
      external_reference: externalRef,
      produto_id: String(produto.id),
      produto_nome: produto.nome,
      valor: preco,
      custo: produto.custo || 0,
      status: "aguardando_pagamento",
      cliente_nome: cliente.nome,
      cliente_email: emailCliente,
      cliente_cpf: cpfLimpo,
      cliente_telefone: telLimpo,
      cliente_cep: cliente.cep || "",
      cliente_endereco: cliente.endereco || "",
      cliente_numero: cliente.numero || "",
      cliente_complemento: cliente.complemento || "",
      cliente_bairro: cliente.bairro || "",
      cliente_cidade: cliente.cidade || "",
      cliente_estado: cliente.estado || "",
      criado_em: new Date().toISOString()
    };

    await fetch(`${supabaseUrl}/rest/v1/pedidos`, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify(pedidoBody)
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
