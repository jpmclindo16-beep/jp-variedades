module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const { type, data } = req.body || {};

    // Mercado Pago envia notificações de pagamento
    if (type === "payment" && data && data.id) {
      const paymentId = data.id;

      // Busca detalhes do pagamento na API do MP
      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: {
          Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`
        }
      });

      if (!mpRes.ok) {
        return res.status(200).json({ ok: true });
      }

      const payment = await mpRes.json();
      const externalRef = payment.external_reference;
      const status = payment.status; // approved, pending, rejected, etc.

      if (!externalRef) {
        return res.status(200).json({ ok: true });
      }

      // Mapeia status do MP para status interno
      let novoStatus = "aguardando_pagamento";
      if (status === "approved") novoStatus = "pago";
      else if (status === "rejected" || status === "cancelled") novoStatus = "cancelado";
      else if (status === "in_process" || status === "pending") novoStatus = "aguardando_pagamento";

      // Atualiza pedido no Supabase
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      await fetch(
        `${supabaseUrl}/rest/v1/pedidos?external_reference=eq.${encodeURIComponent(externalRef)}`,
        {
          method: "PATCH",
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal"
          },
          body: JSON.stringify({
            status: novoStatus,
            mp_payment_id: String(paymentId),
            atualizado_em: new Date().toISOString()
          })
        }
      );
    }

    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error("Webhook error:", error);
    return res.status(200).json({ ok: true });
  }
};
