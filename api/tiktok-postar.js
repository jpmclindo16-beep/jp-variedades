export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const VIDEO_URL = 'https://jp-variedades.vercel.app/tiktok-demo.mp4';

  try {
    const { access_token, open_id } = req.body;

    if (!access_token) {
      return res.status(400).json({ ok: false, error: 'access_token ausente.' });
    }

    const postResp = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        post_info: {
          title: '🔥 Oferta imperdível! Confira no link da bio #ofertas #promocao',
          privacy_level: 'SELF_ONLY',
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: 'PULL_FROM_URL',
          video_url: VIDEO_URL,
        },
      }),
    });

    const postData = await postResp.json();
    console.log('TikTok publish resposta:', JSON.stringify(postData));

    if (postData.error && postData.error.code !== 'ok') {
      return res.status(400).json({ ok: false, error: postData.error.message || postData.error.code });
    }

    return res.status(200).json({
      ok: true,
      publish_id: postData.data ? postData.data.publish_id : null,
    });

  } catch (err) {
    console.error('Erro TikTok Postar:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
