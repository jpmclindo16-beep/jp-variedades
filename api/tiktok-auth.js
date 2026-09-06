export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
  const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
  const TIKTOK_REDIRECT_URI = 'https://jp-variedades.vercel.app/tiktok-callback.html';

  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ ok: false, error: 'Código de autorização ausente.' });
    }

    const tokenResp = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache',
      },
      body: new URLSearchParams({
        client_key: TIKTOK_CLIENT_KEY,
        client_secret: TIKTOK_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: TIKTOK_REDIRECT_URI,
      }),
    });

    const tokenData = await tokenResp.json();
    console.log('TikTok token resposta:', JSON.stringify(tokenData));

    if (tokenData.error) {
      return res.status(400).json({ ok: false, error: tokenData.error_description || tokenData.error });
    }

    return res.status(200).json({
      ok: true,
      access_token: tokenData.access_token,
      open_id: tokenData.open_id,
      expires_in: tokenData.expires_in,
    });

  } catch (err) {
    console.error('Erro TikTok Auth:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
