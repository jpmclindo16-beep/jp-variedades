const { MercadoPagoConfig, Preference } = require("mercadopago");

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN
});

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const { items, cliente } = req.body || {};

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Carrinho vazio" });
    }

    if (!cliente || !cliente.nome || !cliente.telefone || !cliente.cpf) {
      return res.status(400).json({
        error: "Dados do cliente incompletos. Nome, telefone e CPF são obrigatórios."
      });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const siteUrl = process.env.SITE_URL;

    if (!supabaseUrl || !supabaseKey || !siteUrl) {
      return res.status(500).json({ error: "Configuração incompleta no servidor" });
    }

    // Limpa documentos
    const cpfLimpo = cliente.cpf.replace(/\D/g, "");
    const telLimpo = cliente.telefone.replace(/\D/g, "");
    const emailCliente = cliente.email || `cliente${Date.now()}@jpvariedades.com`;

    // Monta items do Mercado Pago
    const mpItems = items.map((it, idx) => ({
      id: String(it.id) || `item-${idx}`,
      title: String(it.nome).substring(0, 256),
      quantity: Number(it.qty) || 1,
      unit_price: Number(it.preco) || 0,
      currency_id: "BRL",
      picture_url: it.imagem || undefined
    }));

    const totalValor = mpItems.reduce((s, it) => s + (it.unit_price * it.quantity), 0);

    const externalRef = `JP-${Date.now()}`;

    const preference = new Preference(client);

    const resultado = await preference.create({
      body: {
        items: mpItems,
        payer: {
          name: cliente.nome,
          email: emailCliente,
          phone: { number: telLimpo },
          identification: { type: "CPF", number: cpfLimpo }
        },
        back_urls: {
          success: `${siteUrl}/pedido.html?status=sucesso`,
          failure: `${siteUrl}/pedido.html?status=erro`,
          pending: `${siteUrl}/pedido.html?status=pendente`
        },
        auto_return: "approved",
        notification_url: `${siteUrl}/api/pagamento-webhook`,
        external_reference: externalRef,
        metadata: {
          external_reference: externalRef,
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
          items_json: JSON.stringify(items)
        }
      }
    });

    // Salva pedido no Supabase
    const pedidoBody = {
      mp_preference_id: resultado.id,
      external_reference: externalRef,
      produto_id: String(items[0].id),
      produto_nome: items.map(it => it.nome).join(", "),
      valor: totalValor,
      status: "aguardando_pagamento",
      status_pedido: "aguardando_pagamento",
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
      items: items,
      criado_em: new Date().toISOString()
    };

    const saveRes = await fetch(`${supabaseUrl}/rest/v1/pedidos`, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify(pedidoBody)
    });

    if (!saveRes.ok) {
      const txt = await saveRes.text();
      console.error("Erro ao salvar pedido:", txt);
      // Não falha o checkout, apenas loga
    }

    return res.status(200).json({
      id: resultado.id,
      init_point: resultado.init_point,
      sandbox_init_point: resultado.sandbox_init_point,
      external_reference: externalRef
    });

  } catch (error) {
    console.error("ERRO CHECKOUT:", error);
    return res.status(500).json({
      error: "Não foi possível criar o pagamento: " + (error.message || "Erro interno")
    });
  }
};
