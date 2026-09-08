import Jimp from 'jimp';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  const FACEBOOK_PAGE_ID = process.env.FACEBOOK_PAGE_ID;
  const FACEBOOK_PAGE_TOKEN = process.env.FACEBOOK_PAGE_TOKEN;
  const INSTAGRAM_BUSINESS_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const IMGBB_API_KEY = process.env.IMGBB_API_KEY;
  const THREADS_USER_ID = process.env.THREADS_USER_ID;
  const THREADS_ACCESS_TOKEN = process.env.THREADS_ACCESS_TOKEN;

  // Baixa a imagem original, converte para JPEG e re-hospeda no imgbb.
  async function rehospedarImagem(urlOriginal) {
    if (!urlOriginal || !IMGBB_API_KEY) return urlOriginal;

    try {
      const imgResp = await fetch(urlOriginal);
      if (!imgResp.ok) {
        console.error('Falha ao baixar imagem original:', imgResp.status);
        return urlOriginal;
      }

      const bufferOriginal = Buffer.from(await imgResp.arrayBuffer());

      let bufferFinal = bufferOriginal;
      try {
        const image = await Jimp.read(bufferOriginal);
        bufferFinal = await image.getBuffer('image/jpeg');
      } catch (convErr) {
        console.error('Falha ao converter imagem para JPEG, usando original:', convErr);
      }

      const base64 = bufferFinal.toString('base64');

      const uploadResp = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ image: base64 }),
      });

      const uploadData = await uploadResp.json();

      if (uploadData.success) {
        return uploadData.data.url;
      } else {
        console.error('Falha ao re-hospedar no imgbb:', JSON.stringify(uploadData));
        return urlOriginal;
      }
    } catch (err) {
      console.error('Erro ao re-hospedar imagem:', err);
      return urlOriginal;
    }
  }

  try {
    const { legenda, precoAtual, precoOriginal, imagens: imagensOriginais, link } = req.body;

    if (!legenda || !precoAtual || !link) {
      return res.status(400).json({ error: 'Preencha pelo menos legenda, preço atual e link.' });
    }

    // Normaliza a lista de imagens: aceita string única ou array, remove vazios, limita a 3
    const listaOriginal = Array.isArray(imagensOriginais)
      ? imagensOriginais
      : (imagensOriginais ? [imagensOriginais] : []);
    const listaFiltrada = listaOriginal.filter(Boolean).slice(0, 3);

    // Re-hospeda todas as imagens em paralelo e reaproveita os novos links
    // em todas as plataformas.
    const imagens = await Promise.all(listaFiltrada.map(rehospedarImagem));
    const temImagem = imagens.length > 0;

    const atual = Number(precoAtual);
    const original = precoOriginal ? Number(precoOriginal) : null;
    const temDesconto = original && original > atual;
    const desconto = temDesconto ? Math.round(((original - atual) / original) * 100) : 0;

    function montarPrecos(comMarkdown) {
      if (temDesconto) {
        return comMarkdown
          ? `~De R$ ${original.toFixed(2)}~\nPor *R$ ${atual.toFixed(2)}* (${desconto}% OFF)\n\n`
          : `De R$ ${original.toFixed(2)}\nPor R$ ${atual.toFixed(2)} (${desconto}% OFF)\n\n`;
      }
      return comMarkdown
        ? `Por *R$ ${atual.toFixed(2)}*\n\n`
        : `Por R$ ${atual.toFixed(2)}\n\n`;
    }

    const mensagemTelegram = `🔥 *${legenda}*\n\n${montarPrecos(true)}👉 [Ver produto](${link})`;
    const mensagemFacebook = `🔥 ${legenda}\n\n${montarPrecos(false)}👉 ${link}`;
    const mensagemInstagram = `🔥 ${legenda}\n\n${montarPrecos(false)}👉 Link na bio!`;
    const mensagemThreads = `🔥 ${legenda}\n\n${montarPrecos(false)}👉 Link na bio!`;

    // ---------- TELEGRAM ----------
    const baseTelegram = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
    let telegramOk = true;

    try {
      if (imagens.length === 0) {
        const r = await fetch(`${baseTelegram}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: mensagemTelegram, parse_mode: 'Markdown' }),
        });
        const d = await r.json();
        if (!d.ok) telegramOk = false;
      } else if (imagens.length === 1) {
        const r = await fetch(`${baseTelegram}/sendPhoto`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, photo: imagens[0], caption: mensagemTelegram, parse_mode: 'Markdown' }),
        });
        const d = await r.json();
        if (!d.ok) telegramOk = false;
      } else {
        // Álbum: legenda só entra no primeiro item
        const media = imagens.map((url, i) => ({
          type: 'photo',
          media: url,
          ...(i === 0 ? { caption: mensagemTelegram, parse_mode: 'Markdown' } : {}),
        }));
        const r = await fetch(`${baseTelegram}/sendMediaGroup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, media }),
        });
        const d = await r.json();
        if (!d.ok) telegramOk = false;
      }
    } catch (err) {
      telegramOk = false;
      console.error('Erro Telegram:', err);
    }

    // ---------- FACEBOOK ----------
    let facebookOk = true;
    const baseFacebook = `https://graph.facebook.com/v21.0/${FACEBOOK_PAGE_ID}`;

    try {
      if (imagens.length === 0) {
        const r = await fetch(`${baseFacebook}/feed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: mensagemFacebook, access_token: FACEBOOK_PAGE_TOKEN }),
        });
        const d = await r.json();
        if (d.error) facebookOk = false;
      } else if (imagens.length === 1) {
        const r = await fetch(`${baseFacebook}/photos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: imagens[0], caption: mensagemFacebook, access_token: FACEBOOK_PAGE_TOKEN }),
        });
        const d = await r.json();
        if (d.error) facebookOk = false;
      } else {
        // Sobe cada foto sem publicar, depois cria um post único anexando todas
        const attachedMedia = [];
        for (const url of imagens) {
          const r = await fetch(`${baseFacebook}/photos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, published: false, access_token: FACEBOOK_PAGE_TOKEN }),
          });
          const d = await r.json();
          if (d.error) { facebookOk = false; break; }
          attachedMedia.push({ media_fbid: d.id });
        }
        if (facebookOk) {
          const r = await fetch(`${baseFacebook}/feed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: mensagemFacebook, attached_media: attachedMedia, access_token: FACEBOOK_PAGE_TOKEN }),
          });
          const d = await r.json();
          if (d.error) facebookOk = false;
        }
      }
    } catch (err) {
      facebookOk = false;
      console.error('Erro Facebook:', err);
    }

    // ---------- INSTAGRAM ----------
    let instagramOk = true;
    let instagramMsg = null;
    const baseInstagram = `https://graph.facebook.com/v21.0/${INSTAGRAM_BUSINESS_ACCOUNT_ID}`;

    if (!temImagem) {
      instagramOk = false;
      instagramMsg = 'Instagram exige pelo menos uma imagem.';
    } else {
      try {
        if (imagens.length === 1) {
          const containerResp = await fetch(`${baseInstagram}/media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_url: imagens[0], caption: mensagemInstagram, access_token: FACEBOOK_PAGE_TOKEN }),
          });
          const containerData = await containerResp.json();
          if (containerData.error) {
            instagramOk = false;
            instagramMsg = containerData.error.message;
          } else {
            const publishResp = await fetch(`${baseInstagram}/media_publish`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ creation_id: containerData.id, access_token: FACEBOOK_PAGE_TOKEN }),
            });
            const publishData = await publishResp.json();
            if (publishData.error) { instagramOk = false; instagramMsg = publishData.error.message; }
          }
        } else {
          // Carrossel: cria um container por imagem, depois o container pai
          const childIds = [];
          for (const url of imagens) {
            const r = await fetch(`${baseInstagram}/media`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ image_url: url, is_carousel_item: true, access_token: FACEBOOK_PAGE_TOKEN }),
            });
            const d = await r.json();
            if (d.error) { instagramOk = false; instagramMsg = d.error.message; break; }
            childIds.push(d.id);
          }
          if (instagramOk) {
            const parentResp = await fetch(`${baseInstagram}/media`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ media_type: 'CAROUSEL', children: childIds, caption: mensagemInstagram, access_token: FACEBOOK_PAGE_TOKEN }),
            });
            const parentData = await parentResp.json();
            if (parentData.error) {
              instagramOk = false;
              instagramMsg = parentData.error.message;
            } else {
              const publishResp = await fetch(`${baseInstagram}/media_publish`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ creation_id: parentData.id, access_token: FACEBOOK_PAGE_TOKEN }),
              });
              const publishData = await publishResp.json();
              if (publishData.error) { instagramOk = false; instagramMsg = publishData.error.message; }
            }
          }
        }
      } catch (err) {
        instagramOk = false;
        instagramMsg = err.message;
        console.error('Erro Instagram:', err);
      }
    }

    // ---------- THREADS ----------
    let threadsOk = true;
    let threadsMsg = null;
    const baseThreads = `https://graph.threads.net/v1.0/${THREADS_USER_ID}`;

    if (!THREADS_USER_ID || !THREADS_ACCESS_TOKEN) {
      threadsOk = false;
      threadsMsg = 'Threads não configurado (faltam THREADS_USER_ID / THREADS_ACCESS_TOKEN).';
    } else {
      try {
        if (imagens.length === 0) {
          const containerResp = await fetch(`${baseThreads}/threads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ media_type: 'TEXT', text: mensagemThreads, access_token: THREADS_ACCESS_TOKEN }),
          });
          const containerData = await containerResp.json();
          if (containerData.error) { threadsOk = false; threadsMsg = containerData.error.message; }
          else {
            const publishResp = await fetch(`${baseThreads}/threads_publish`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ creation_id: containerData.id, access_token: THREADS_ACCESS_TOKEN }),
            });
            const publishData = await publishResp.json();
            if (publishData.error) { threadsOk = false; threadsMsg = publishData.error.message; }
          }
        } else if (imagens.length === 1) {
          const containerResp = await fetch(`${baseThreads}/threads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ media_type: 'IMAGE', image_url: imagens[0], text: mensagemThreads, access_token: THREADS_ACCESS_TOKEN }),
          });
          const containerData = await containerResp.json();
          if (containerData.error) { threadsOk = false; threadsMsg = containerData.error.message; }
          else {
            const publishResp = await fetch(`${baseThreads}/threads_publish`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ creation_id: containerData.id, access_token: THREADS_ACCESS_TOKEN }),
            });
            const publishData = await publishResp.json();
            if (publishData.error) { threadsOk = false; threadsMsg = publishData.error.message; }
          }
        } else {
          const childIds = [];
          for (const url of imagens) {
            const r = await fetch(`${baseThreads}/threads`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ media_type: 'IMAGE', image_url: url, is_carousel_item: true, access_token: THREADS_ACCESS_TOKEN }),
            });
            const d = await r.json();
            if (d.error) { threadsOk = false; threadsMsg = d.error.message; break; }
            childIds.push(d.id);
          }
          if (threadsOk) {
            const parentResp = await fetch(`${baseThreads}/threads`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ media_type: 'CAROUSEL', children: childIds.join(','), text: mensagemThreads, access_token: THREADS_ACCESS_TOKEN }),
            });
            const parentData = await parentResp.json();
            if (parentData.error) { threadsOk = false; threadsMsg = parentData.error.message; }
            else {
              const publishResp = await fetch(`${baseThreads}/threads_publish`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ creation_id: parentData.id, access_token: THREADS_ACCESS_TOKEN }),
              });
              const publishData = await publishResp.json();
              if (publishData.error) { threadsOk = false; threadsMsg = publishData.error.message; }
            }
          }
        }
      } catch (err) {
        threadsOk = false;
        threadsMsg = err.message;
        console.error('Erro Threads:', err);
      }
    }

    if (!telegramOk && !facebookOk && !instagramOk && !threadsOk) {
      return res.status(500).json({ ok: false, error: 'Falha ao enviar para todas as plataformas.' });
    }

    return res.status(200).json({
      ok: true,
      telegram: telegramOk,
      facebook: facebookOk,
      instagram: instagramOk,
      instagramMsg,
      threads: threadsOk,
      threadsMsg,
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
