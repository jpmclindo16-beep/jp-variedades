async function enviarEmailVenda(pedidosCriados) {
  const resendKey = process.env.RESEND_API_KEY;
  const emailDestino = process.env.NOTIFICACAO_EMAIL;

  if (!resendKey || !emailDestino || !pedidosCriados || !pedidosCriados.length) {
    if (!resendKey || !emailDestino) {
      console.error("Resend nao configurado (RESEND_API_KEY ou NOTIFICACAO_EMAIL faltando)");
    }
    return;
  }

  const itensHtml = pedidosCriados.map(function (p) {
    return `<li>${p.produto_nome}${p.tamanho ? " (" + p.tamanho + ")" : ""} — ${p.quantidade || 1}x — R$ ${Number(p.valor || 0).toFixed(2).replace(".", ",")}</li>`;
  }).join("");

  const primeiro = pedidosCriados[0];

  const endereco = [primeiro.cliente_endereco, primeiro.cliente_numero, primeiro.cliente_complemento]
    .filter(Boolean).join(", ");

  const cidadeUf = [primeiro.cliente_cidade, primeiro.cliente_estado].filter(Boolean).join("/");

  const totalGeral = pedidosCriados.reduce(function (a, p) { return a + Number(p.valor || 0); }, 0);

  const html = `
    <h2>🎉 Nova venda na JP Shoppew!</h2>
    <ul>${itensHtml}</ul>
    <p><strong>Total:</strong> R$ ${totalGeral.toFixed(2).replace(".", ",")}</p>
    <hr>
    <p><strong>Cliente:</strong> ${primeiro.cliente_nome}</p>
    <p><strong>CPF:</strong> ${primeiro.cliente_cpf || "-"}</p>
    <p><strong>Telefone:</strong> ${primeiro.cliente_telefone || "-"}</p>
    <p><strong>Endereço:</strong> ${endereco || "-"}</p>
    <p><strong>Bairro:</strong> ${primeiro.cliente_bairro || "-"}</p>
    <p><strong>Cidade/UF:</strong> ${cidadeUf || "-"}</p>
    <p><strong>CEP:</strong> ${primeiro.cliente_cep || "-"}</p>
  `;

  try {
    const resposta = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "JP Shoppew <onboarding@resend.dev>",
        to: [emailDestino],
        subject: `Nova venda: ${pedidosCriados.length} item(ns)`,
        html: html
      })
    });

    if (!resposta.ok) {
      console.error("Erro ao enviar email:", await resposta.text());
    }
  } catch (e) {
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

    let itensPedido = [];
    try {
      itensPedido = JSON.parse(metadata.itens || "[]");
    } catch (e) {
      itensPedido = [];
    }

    // fallback pra pedidos antigos sem "itens" no metadata (fluxo de 1 produto só)
    if (!itensPedido.length && metadata.produto_id) {
      let nomeProduto = "Produto";

      const produtoResponse = await fetch(
        `${supabaseUrl}/rest/v1/produtos?id=eq.${encodeURIComponent(metadata.produto_id)}&limit=1`,
        {
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`
          }
        }
      );

      if (produtoResponse.ok) {
        const produtos = await produtoResponse.json();
        if (produtos.length) nomeProduto = produtos[0].nome || "Produto";
      }

      itensPedido = [{
        id: metadata.produto_id,
        nome: nomeProduto,
        preco: Number(pagamento.transaction_amount || 0),
        qty: 1,
        tamanho: metadata.tamanho || metadata.opcoes || null
      }];
    }

    const statusPagamento = pagamento.status || "pending";

    let statusPedido = "aguardando_pagamento";
    if (statusPagamento === "approved") statusPedido = "pago";
    else if (statusPagamento === "pending") statusPedido = "aguardando_pagamento";
    else if (statusPagamento === "in_process") statusPedido = "em_analise";
    else if (statusPagamento === "rejected" || statusPagamento === "cancelled") statusPedido = "cancelado";
    else if (statusPagamento === "refunded") statusPedido = "reembolsado";

    // verifica se já existem linhas criadas pra esse pagamento (webhook pode chegar mais de uma vez)
    const consultaExistentes = await fetch(
      `${supabaseUrl}/rest/v1/pedidos?mercado_pago_id=eq.${encodeURIComponent(String(paymentId))}`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`
        }
      }
    );
    const existentes = consultaExistentes.ok ? await consultaExistentes.json() : [];

    if (existentes.length) {

      const jaEstavaPago = existentes[0].status_pedido === "pago";

      const atualizar = await fetch(
        `${supabaseUrl}/rest/v1/pedidos?mercado_pago_id=eq.${encodeURIComponent(String(paymentId))}`,
        {
          method: "PATCH",
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
            Prefer: "return=representation"
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

      if (statusPedido === "pago" && !jaEstavaPago) {
        const atualizados = await atualizar.json();
        await enviarEmailVenda(atualizados);
      }

    } else {

      const cliente = {
        nome: metadata.cliente_nome || "Cliente",
        cpf: metadata.cliente_cpf || "",
        telefone: metadata.cliente_telefone || "",
        cep: metadata.cliente_cep || "",
        endereco: metadata.cliente_endereco || "",
        numero: metadata.cliente_numero || "",
        complemento: metadata.cliente_complemento || "",
        bairro: metadata.cliente_bairro || "",
        cidade: metadata.cliente_cidade || "",
        estado: metadata.cliente_estado || ""
      };

      const linhas = itensPedido.map(function (item) {
        return {
          produto_id: item.id || null,
          produto_nome: item.nome || "Produto",
          quantidade: item.qty || 1,
          valor: Number(item.preco || 0) * Math.max(1, Number(item.qty || 1)),
          tamanho: item.tamanho || item.opcoes || null,

          cliente_nome: cliente.nome,
          cliente_cpf: cliente.cpf,
          cliente_telefone: cliente.telefone,
          cliente_cep: cliente.cep,
          cliente_endereco: cliente.endereco,
          cliente_numero: cliente.numero,
          cliente_complemento: cliente.complemento,
          cliente_bairro: cliente.bairro,
          cliente_cidade: cliente.cidade,
          cliente_estado: cliente.estado,

          mercado_pago_id: String(paymentId),
          mercado_pago_status: statusPagamento,
          status_pedido: statusPedido,
          referencia: referencia,
          fornecedor_status: "aguardando_compra"
        };
      });

      const criar = await fetch(
        `${supabaseUrl}/rest/v1/pedidos`,
        {
          method: "POST",
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
            Prefer: "return=representation"
          },
          body: JSON.stringify(linhas)
        }
      );

      if (!criar.ok) {
        const erro = await criar.text();
        console.error("Erro Supabase:", erro);
        throw new Error("Erro ao criar pedido");
      }

      if (statusPedido === "pago") {
        const criados = await criar.json();
        await enviarEmailVenda(criados);
      }
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
