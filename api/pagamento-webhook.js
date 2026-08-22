module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  try {
    const paymentId = req.body?.data?.id || req.body?.id || req.query?.id;
    if (!paymentId) return res.status(200).json({ ok: true, ignored: true });

    const mpToken = process.env.MP_ACCESS_TOKEN;
    const sbUrl = process.env.SUPABASE_URL;
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!mpToken || !sbUrl || !sbKey) return res.status(500).json({ error: 'Variáveis da Vercel não configuradas' });

    const mp = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${mpToken}` }
    });
    const payment = await mp.json();
    if (!mp.ok) return res.status(502).json({ error: 'Não foi possível consultar o pagamento' });

    // Só libera o pedido para fornecedor quando o pagamento estiver aprovado.
    if (payment.status !== 'approved') return res.status(200).json({ ok: true, status: payment.status });

    const meta = payment.metadata || {};
    let itens = [];
    try { itens = JSON.parse(meta.itens || '[]'); } catch (_) {}
    if (!Array.isArray(itens) || !itens.length) return res.status(200).json({ ok: true, ignored: true });

    const cliente = {
      nome: meta.cliente_nome || '', cpf: meta.cliente_cpf || '', telefone: meta.cliente_telefone || '',
      cep: meta.cliente_cep || '', endereco: meta.cliente_endereco || '', numero: meta.cliente_numero || '',
      complemento: meta.cliente_complemento || '', bairro: meta.cliente_bairro || '',
      cidade: meta.cliente_cidade || '', estado: meta.cliente_estado || ''
    };

    // Evita duplicar um mesmo pagamento.
    const exists = await fetch(`${sbUrl}/rest/v1/pedidos?mp_pagamento_id=eq.${encodeURIComponent(String(paymentId))}&limit=1`, {
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }
    });
    const existing = await exists.json();
    if (Array.isArray(existing) && existing.length) return res.status(200).json({ ok: true, duplicate: true });

    const rows = itens.map((item) => ({
      produto_id: item.id,
      produto_nome: item.nome,
      valor: Number(item.preco || 0) * Math.max(1, Number(item.qty || 1)),
      status_pedido: 'pago',
      tamanho: item.opcoes || item.tamanho || null,
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
      mp_pagamento_id: String(paymentId),
      fornecedor_status: 'aguardando_compra',
      criado_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString()
    }));

    const ins = await fetch(`${sbUrl}/rest/v1/pedidos`, {
      method: 'POST',
      headers: {
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(rows)
    });
    if (!ins.ok) {
      const txt = await ins.text();
      console.error('Supabase:', txt);
      return res.status(500).json({ error: 'Pagamento aprovado, mas não foi possível registrar o pedido' });
    }

    return res.status(200).json({ ok: true, status: 'pedido_criado' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Erro interno' });
  }
};
