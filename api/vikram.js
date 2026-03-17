export default async function handler(req, res) {

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { messages, systemPrompt } = req.body

  if (!messages || !systemPrompt) {
    return res.status(400).json({ error: 'messages and systemPrompt are required' })
  }

  try {

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages
      })
    })

    if (!response.ok) {
      const err = await response.json()
      console.error('Anthropic API error:', err)
      return res.status(502).json({ error: 'AI service error', detail: err })
    }

    const data = await response.json()
    const text = data.content?.[0]?.text || ''
    return res.json({ reply: text })

  } catch (err) {
    console.error('Vikram error:', err)
    return res.status(500).json({ error: err.message })
  }

}
