const { createClient } = require("@supabase/supabase-js")

module.exports = async function handler(req, res) {

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { messages, systemPrompt, user_id, session_id } = req.body

  if (!messages || !systemPrompt) {
    return res.status(400).json({ error: 'messages and systemPrompt are required' })
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

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
      return res.status(502).json({ error: 'AI service error', detail: err })
    }

    const data = await response.json()
    const reply = data.content?.[0]?.text || ''

    // Save messages to ai_conversations
    if (user_id && session_id) {
      const lastUserMsg = messages[messages.length - 1]

      // Save user message
      await supabase.from('ai_conversations').insert({
        user_id,
        feature: 'vikram',
        session_id,
        role: 'user',
        content: lastUserMsg.content,
        metadata: {}
      })

      // Save AI response
      await supabase.from('ai_conversations').insert({
        user_id,
        feature: 'vikram',
        session_id,
        role: 'assistant',
        content: reply,
        metadata: {}
      })
    }

    return res.json({ reply })

  } catch (err) {
    console.error('Vikram error:', err)
    return res.status(500).json({ error: err.message })
  }

}
