/import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const MATT_WORD = process.env.ML_MATT_WORD;
const MATT_TOOL = process.env.ML_MATT_TOOL;

const TERMOS_BUSCA = ['fone bluetooth', 'smartwatch', 'panela eletrica', 'fritadeira sem oleo', 'carregador portatil', 'mochila'];
const DESCONTO_MINIMO = 10;

export default async function handler(req, res) {
  try {
    // MODO DEBUG: acesse /api/buscar-ofertas?debug=1 pra ver a estrutura real de um produto
    if (req.query.debug) {
      const url = `https://api.mercadolibre.com/sites/MLB/search?q=fone bluetooth&limit=3`;
      const resp = await fetch(url);
      const data = await resp.json();
      return res.status(200).json({ amostra: data.results?.slice(0, 2) || data });
    }

    const ofertasEncontradas = [];

    for (const termo of TERMOS_BUSCA) {
      const url = `https://api.mercadolibre.com/sites/MLB/search?q=${encodeURIComponent(termo)}&limit=10`;
      const resp = await fetch(url);
      const data = await resp.json();

      for (const item of data.results || []) {
        const precoOriginal = item.original_price;
        const precoAtual = item.price;

        if (!precoOriginal || precoOriginal <= precoAtual) continue;

        const desconto = Math.round(((precoOriginal - precoAtual) / precoOriginal) * 100);
        if (desconto < DESCONTO_MINIMO) continue;

        ofertasEncontradas.push({
          id: item.id,
          titulo: item.title,
          precoOriginal,
          precoAtual,
          desconto,
          imagem: item.thumbnail?.replace('http://', 'https://'),
          linkProduto: item.permalink,
        });
      }
    }

    let postados = 0;

    for (const oferta of ofertasEncontradas) {
      const { data: jaExiste } = await supabase
        .from('ofertas_postadas')
        .select('id')
        .eq('produto_id', oferta.id)
        .maybeSingle();

      if (jaExiste) continue;

      const linkAfiliado = `${oferta.linkProduto}?matt_word=${MATT_WORD}&matt_tool=${MATT_TOOL}`;

      const mensagem =
        `🔥 *${oferta.titulo}*\n\n` +
        `~De R$ ${oferta.precoOriginal.toFixed(2)}~\n` +
        `Por *R$ ${oferta.precoAtual.toFixed(2)}* (${oferta.desconto}% OFF)\n\n` +
        `👉 [Ver produto](${linkAfiliado})`;

      await postarNoTelegram(mensagem, oferta.imagem);

      await supabase.from('ofertas_postadas').insert({
        produto_id: oferta.id,
        titulo: oferta.titulo,
        preco: oferta.precoAtual,
      });

      postados++;
      await new Promise((r) => setTimeout(r, 1500));
    }

    return res.status(200).json({ ok: true, encontradas: ofertasEncontradas.length, postadas: postados });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

async function postarNoTelegram(texto, imagemUrl) {
  const base = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

  if (imagemUrl) {
    await fetch(`${base}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, photo: imagemUrl, caption: texto, parse_mode: 'Markdown' }),
    });
  } else {
    await fetch(`${base}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: texto, parse_mode: 'Markdown' }),
    });
  }njjhh
}nmmmbvhoknb
