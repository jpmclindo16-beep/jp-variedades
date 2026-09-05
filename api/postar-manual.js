export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  const FACEBOOK_PAGE_ID = process.env.FACEBOOK_PAGE_ID;
  const FACEBOOK_PAGE_TOKEN = process.env.FACEBOOK_PAGE_TOKEN;
  const INSTAGRAM_BUSINESS_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

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

    // Mensagem para o Instagram (sem link clicável, direciona pra bio)
    let mensagemInstagram = `🔥 ${titulo}\n\n`;

    if (original && original > atual) {
      const desconto = Math.round(((original - atual) / original) * 100);
      mensagemInstagram += `De R$ ${original.toFixed(2)}\n`;
      mensagemInstagram += `Por R$ ${atual.toFixed(2)} (${desconto}% OFF)\n\n`;
    } else {
      mensagemInstagram += `Por R$ ${atual.toFixed(2)}\n\n`;
    }

    mensagemInstagram += `👉 Link na bio!`;

    // Enviar para o Telegram
    const baseTelegram = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
    let telegramOk = true;

    try {
      if (imagem) {
        const telegramResp = await fetch(`${baseTelegram}/sendPhoto`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            photo: imagem,
            caption: mensagemTelegram,
            parse_mode: 'Markdown',
          }),
        });
        const telegramData = await telegramResp.json();
        if (!telegramData.ok) telegramOk = false;
      } else {
        const telegramResp = await fetch(`${baseTelegram}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: mensagemTelegram,
            parse_mode: 'Markdown',
          }),
        });
        const telegramData = await telegramResp.json();
        if (!telegramData.ok) telegramOk = false;
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
        const facebookResp = await fetch(`${baseFacebook}/photos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: imagem,
            caption: mensagemFacebook,
            access_token: FACEBOOK_PAGE_TOKEN,
          }),
        });
        const facebookData = await facebookResp.json();
        if (facebookData.error) facebookOk = false;
      } else {
        const facebookResp = await fetch(`${baseFacebook}/feed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: mensagemFacebook,
            access_token: FACEBOOK_PAGE_TOKEN,
          }),
        });
        const facebookData = await facebookResp.json();
        if (facebookData.error) facebookOk = false;
      }
    } catch (err) {
      facebookOk = false;
      console.error('Erro Facebook:', err);
    }

    // Enviar para o Instagram (só funciona se tiver imagem)
    let instagramOk = true;
    let instagramMsg = null;

    if (!imagem) {
      instagramOk = false;
      instagramMsg = 'Instagram exige uma imagem — nenhuma foi enviada.';
    } else {
      try {
        const baseInstagram = `https://graph.facebook.com/v21.0/${INSTAGRAM_BUSINESS_ACCOUNT_ID}`;

        // Passo 1: criar o container de mídia
        const containerResp = await fetch(`${baseInstagram}/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_url: imagem,
            caption: mensagemInstagram,
            access_token: FACEBOOK_PAGE_TOKEN,
          }),
        });
        const containerData = await containerResp.json();
        console.log('Instagram container:', containerData);

        if (containerData.error) {
          instagramOk = false;
          instagramMsg = containerData.error.message;
        } else {
          // Passo 2: publicar o container criado
          const publishResp = await fetch(`${baseInstagram}/media_publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              creation_id: containerData.id,
              access_token: FACEBOOK_PAGE_TOKEN,
            }),
          });
          const publishData = await publishResp.json();
          console.log('Instagram publish:', publishData);

          if (publishData.error) {
            instagramOk = false;
            instagramMsg = publishData.error.message;
          }
        }
      } catch (err) {
        instagramOk = false;
        instagramMsg = err.message;
        console.error('Erro Instagram:', err);
      }
    }

    if (!telegramOk && !facebookOk && !instagramOk) {
      return res.status(500).json({
        ok: false,
        error: 'Falha ao enviar para todas as plataformas.',
      });
    }

    return res.status(200).json({
      ok: true,
      telegram: telegramOk,
      facebook: facebookOk,
      instagram: instagramOk,
      instagramMsg,
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
