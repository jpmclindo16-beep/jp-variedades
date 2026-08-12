async function enviarEmailVenda(dadosPedido){
  const resendKey = process.env.RESEND_API_KEY;
  const emailDestino = process.env.NOTIFICACAO_EMAIL;

  if(!resendKey || !emailDestino){
    console.error("Resend nao configurado (RESEND_API_KEY ou NOTIFICACAO_EMAIL faltando)");
    return;
  }

  const endereco = [
    dadosPedido.cliente_endereco,
    dadosPedido.cliente_numero,
    dadosPedido.cliente_complemento
  ].filter(Boolean).join(", ");

  const cidadeUf = [dadosPedido.cliente_cidade, dadosPedido.cliente_estado].filter(Boolean).join("/");

  const html = `
    <h2>🎉 Nova venda na JP Variedades!</h2>
    <p><strong>Produto:</strong> ${dadosPedido.produto_nome}</p>
    <p><strong>Valor:</strong> R$ ${Number(dadosPedido.valor || 0).toFixed(2).replace(".", ",")}</p>
    <hr>
    <p><strong>Cliente:</strong> ${dadosPedido.cliente_nome}</p>
    <p><strong>CPF:</strong> ${dadosPedido.cliente_cpf || "-"}</p>
    <p><strong>Telefone:</strong> ${dadosPedido.cliente_telefone || "-"}</p>
    <p><strong>Endereço:</strong> ${endereco || "-"}</p>
    <p><strong>Bairro:</strong> ${dadosPedido.cliente_bairro || "-"}</p>
    <p><strong>Cidade/UF:</strong> ${cidadeUf || "-"}</p>
    <p><strong>CEP:</strong> ${dadosPedido.cliente_cep || "-"}</p>
  `;

  try{
    const resposta = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "JP Variedades <onboarding@resend.dev>",
        to: [emailDestino],
        subject: `Nova venda: ${dadosPedido.produto_nome}`,
        html: html
      })
    });

    if(!resposta.ok){
      const erro = await resposta.text();
      console.error("Erro ao enviar email:", erro);
    }
  }catch(e){
    console.error("Erro ao enviar email:", e);
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({
      error: "Método não permitido"
    });
  }

  try {
    const paymentId =
      req.query?.id ||
      req.body?.data?.id ||
      req.body?.id;

    if (!paymentId) {
      return res.status(200).json({
        received: true
      });
    }

    const mpToken = process.env.MP_ACCESS_TOKEN;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!mpToken || !supabaseUrl || !supabaseKey) {
      console.error("Variáveis de ambiente não configuradas");

      return res.status(500).json({
        error: "Configuração incompleta"
      });
    }

    const pagamentoResponse = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
      {
        headers: {
          Authorization: `Bearer ${mpToken}`
        }
      }
    );

    if (!pagamentoResponse.ok) {
      throw new Error("Não foi possível consultar o pagamento");
    }

    const pagamento = await pagamentoResponse.json();

    const referencia = pagamento.external_reference || "";

    const metadata = pagamento.metadata || {};

    const produtoId =
      metadata.produto_id
        ? Number(metadata.produto_id)
        : null;

    let produtoNome = "Produto";

    if (produtoId) {
      const produtoResponse = await fetch(
        `${supabaseUrl}/rest/v1/produtos?id=eq.${encodeURIComponent(produtoId)}&limit=1`,
        {
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`
          }
        }
      );

      if (produtoResponse.ok) {
        const produtos = await produtoResponse.json();

        if (produtos.length) {
          produtoNome = produtos[0].nome || "Produto";
        }
      }
    }

    const consultaPedido = await fetch(
      `${supabaseUrl}/rest/v1/pedidos?mercado_pago_id=eq.${encodeURIComponent(String(paymentId))}&limit=1`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`
        }
      }
    );

    const pedidosExistentes = consultaPedido.ok
      ? await consultaPedido.json()
      : [];

    const statusPagamento =
      pagamento.status || "pending";

    let statusPedido = "aguardando_pagamento";

    if (statusPagamento === "approved") {
      statusPedido = "pago";
    } else if (statusPagamento === "pending") {
      statusPedido = "aguardando_pagamento";
    } else if (statusPagamento === "in_process") {
      statusPedido = "em_analise";
    } else if (
      statusPagamento === "rejected" ||
      statusPagamento === "cancelled"
    ) {
      statusPedido = "cancelado";
    } else if (statusPagamento === "refunded") {
      statusPedido = "reembolsado";
    }

    const dadosPedido = {
      produto_id: produtoId,
      produto_nome: produtoNome,
      quantidade: 1,
      valor: Number(pagamento.transaction_amount || 0),

      cliente_nome:
        metadata.cliente_nome ||
        pagamento.payer?.first_name ||
        "Cliente",

      cliente_cpf:
        metadata.cliente_cpf || "",

      cliente_telefone:
        metadata.cliente_telefone ||
        pagamento.payer?.phone?.number ||
        "",

      cliente_cep:
        metadata.cliente_cep || "",

      cliente_endereco:
        metadata.cliente_endereco || "",

      cliente_numero:
        metadata.cliente_numero || "",

      cliente_complemento:
        metadata.cliente_complemento || "",

      cliente_bairro:
        metadata.cliente_bairro || "",

      cliente_cidade:
        metadata.cliente_cidade || "",

      cliente_estado:
        metadata.cliente_estado || "",

      mercado_pago_id:
        String(paymentId),

      mercado_pago_status:
        statusPagamento,

      status_pedido:
        statusPedido,

      referencia:
        referencia
    };

    let jaEstavaPago = false;

    if (pedidosExistentes.length) {

      jaEstavaPago = pedidosExistentes[0].status_pedido === "pago";

      const pedidoId = pedidosExistentes[0].id;

      const atualizar = await fetch(
        `${supabaseUrl}/rest/v1/pedidos?id=eq.${encodeURIComponent(pedidoId)}`,
        {
          method: "PATCH",

          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal"
          },

          body: JSON.stringify({
            mercado_pago_status: statusPagamento,
            status_pedido: statusPedido,
            atualizado_em: new Date().toISOString()
          })
        }
      );

      if (!atualizar.ok) {
        throw new Error("Erro ao atualizar pedido");
      }

    } else {

      const criar = await fetch(
        `${supabaseUrl}/rest/v1/pedidos`,
        {
          method: "POST",

          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal"
          },

          body: JSON.stringify(dadosPedido)
        }
      );

      if (!criar.ok) {
        const erro = await criar.text();

        console.error("Erro Supabase:", erro);

        throw new Error("Erro ao criar pedido");
      }
    }

    if (statusPedido === "pago" && !jaEstavaPago) {
      await enviarEmailVenda(dadosPedido);
    }

    return res.status(200).json({
      received: true,
      payment_id: String(paymentId),
      status: statusPagamento
    });

  } catch (error) {

    console.error("WEBHOOK ERROR:", error);

    return res.status(500).json({
      error: "Erro ao processar notificação"
    });
  }
};
        
