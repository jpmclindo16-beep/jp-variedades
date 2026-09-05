export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  const FACEBOOK_PAGE_ID = process.env.FACEBOOK_PAGE_ID;
  const FACEBOOK_PAGE_TOKEN = process.env.FACEBOOK_PAGE_TOKEN;

  try {
    const { titulo, precoAtual, precoOriginal, imagem, link } = req.body;

    if (!titulo || !precoAtual || !link) {
      return res.status(400).json({ error: 'Preencha pelo menos título, preço atual e link.' });
    }

    let mensagemTelegram = `🔥 *${titulo}*\n\n`;

    const atual = Number(precoAtual);
    const original = precoOriginal ? Number(precoOriginal) : null;

    if (original && original > atual) {
      const desconto = Math.round(((original - atual) / original) * 100);
      mensagemTelegram += `~De R$ ${original.toFixed(2)}~\n`;
      mensagemTelegram += `Por *R$ ${atual.toFixed(2)}* (${desconto}% OFF)\n\n`;
    } else {
      mensagemTelegram += `Por *R$ ${atual.toFixed(2)}*\n\n`;
    }

    mensagemTelegram += `👉 [Ver produto](${link})`;

    // Mensagem para o Facebook (texto simples, sem Markdown)
    let mensagemFacebook = `🔥 ${titulo}\n\n`;

    if (original && original > atual) {
      const desconto = Math.round(((original - atual) / original) * 100);
      mensagemFacebook += `De R$ ${original.toFixed(2)}\n`;
      mensagemFacebook += `Por R$ ${atual.toFixed(2)} (${desconto}% OFF)\n\n`;
    } else {
      mensagemFacebook += `Por R$ ${atual.toFixed(2)}\n\n`;
    }

    mensagemFacebook += `👉 ${link}`;

    // Enviar para o Telegram
    const baseTelegram = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
    let telegramOk = true;

    try {
      if (imagem) {
        await fetch(`${baseTelegram}/sendPhoto`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            photo: imagem,
            caption: mensagemTelegram,
            parse_mode: 'Markdown',
          }),
        });
      } else {
        await fetch(`${baseTelegram}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: mensagemTelegram,
            parse_mode: 'Markdown',
          }),
        });
      }
    } catch (err) {
      telegramOk = false;
      console.error('Erro Telegram:', err);
    }

    // Enviar para o Facebook
    let facebookOk = true;

    try {
      const baseFacebook = `https://graph.facebook.com/v21.0/${FACEBOOK_PAGE_ID}`;

      if (imagem) {
        // Publicar foto no Facebook
        await fetch(`${baseFacebook}/photos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: imagem,
            caption: mensagemFacebook,
            access_token: FACEBOOK_PAGE_TOKEN,
          }),
        });
      } else {
        // Publicar apenas texto no Facebook
        await fetch(`${baseFacebook}/feed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: mensagemFacebook,
            access_token: FACEBOOK_PAGE_TOKEN,
          }),
        });
      }
    } catch (err) {
      facebookOk = false;
      console.error('Erro Facebook:', err);
    }

    // Verificar se pelo menos um envio funcionou
    if (!telegramOk && !facebookOk) {
      return res.status(500).json({ 
        ok: false, 
        error: 'Falha ao enviar para Telegram e Facebook.' 
      });
    }

    return res.status(200).json({ 
      ok: true,
      telegram: telegramOk,
      facebook: facebookOk,
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
