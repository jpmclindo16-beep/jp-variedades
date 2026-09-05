export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  try {
    const { titulo, precoAtual, precoOriginal, imagem, link } = req.body;

    if (!titulo || !precoAtual || !link) {
      return res.status(400).json({ error: 'Preencha pelo menos título, preço atual e link.' });
    }

    let mensagem = `🔥 *${titulo}*\n\n`;

    const atual = Number(precoAtual);
    const original = precoOriginal ? Number(precoOriginal) : null;

    if (original && original > atual) {
      const desconto = Math.round(((original - atual) / original) * 100);
      mensagem += `~De R$ ${original.toFixed(2)}~\n`;
      mensagem += `Por *R$ ${atual.toFixed(2)}* (${desconto}% OFF)\n\n`;
    } else {
      mensagem += `Por *R$ ${atual.toFixed(2)}*\n\n`;
    }

    mensagem += `👉 [Ver produto](${link})`;

    const base = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
    let resp;

    if (imagem) {
      resp = await fetch(`${base}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          photo: imagem,
          caption: mensagem,
          parse_mode: 'Markdown',
        }),
      });
    } else {
      resp = await fetch(`${base}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: mensagem,
          parse_mode: 'Markdown',
        }),
      });
    }

    const resultado = await resp.json();

    if (!resultado.ok) {
      return res.status(500).json({ error: 'Telegram recusou o envio.', detalhes: resultado });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
