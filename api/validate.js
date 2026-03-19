const { createClient } = require("@supabase/supabase-js")

module.exports = async function handler(req, res) {

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { type, images, hook, caption, hashtags, category, user_id } = req.body

  if (!images || images.length === 0) {
    return res.status(400).json({ error: 'At least one image is required' })
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  const year = new Date().getFullYear()

  const personality = `You are the most brutally honest Instagram growth expert in India. You don't sugarcoat anything. If something is bad, you say it's bad — directly. You've seen thousands of posts fail because creators were too afraid to hear the truth. Your job is to tell them exactly what's wrong AND give specific, creative new ideas to fix it. Don't just say "improve your caption" — give them an actual better caption. Don't just say "use better hashtags" — give them the exact hashtags to use. Don't just say "fix the hook" — write them a better hook. You understand Indian audiences deeply — what triggers them to stop scrolling, what makes them save, share, and comment in India in ${year}.`

  try {

    const imageBlocks = images.map(img => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mediaType || 'image/jpeg',
        data: img.data
      }
    }))

    let analysisPrompt = ''

    if (type === 'reel') {
      analysisPrompt = `${personality}

Analyze this Reel submission:
THUMBNAIL (first frame): [See image above]
HOOK LINE: "${hook || 'Not provided'}"
CAPTION: "${caption || 'Not provided'}"
HASHTAGS: "${hashtags || 'Not provided'}"
CREATOR CATEGORY: ${category || 'General'}

Give a structured analysis with these exact sections:

**🎬 Thumbnail**
Look at the thumbnail. Is it scroll-stopping? Be brutally honest about what you see — lighting, subject, text, visual clarity. Would an Indian viewer stop for this?

**🪝 Hook**
Is this hook strong enough? Does it create curiosity or promise value? Be direct. If it's weak, say so.

**✍️ Caption**
Is the caption working? First line strong enough? CTA present? Be specific about what's wrong.

**#️⃣ Hashtags**
Are these hashtags right? Too broad? Too niche? What's missing?

**📊 Overall Score**
Give a score out of 10. One clear verdict.

**💡 Suggested Improvements**
Write a better hook. Write a better caption. Give exactly 10 better hashtags for the ${category || 'general'} niche in India. Be specific — give them something they can copy and use right now.`

    } else if (type === 'image') {
      analysisPrompt = `${personality}

Analyze this single image post:
IMAGE: [See image above]
CAPTION: "${caption || 'Not provided'}"
HASHTAGS: "${hashtags || 'Not provided'}"
CREATOR CATEGORY: ${category || 'General'}

Give a structured analysis with these exact sections:

**🖼️ Image**
Look at the image carefully. Composition, lighting, subject clarity, visual appeal. Would an Indian Instagram user stop scrolling for this? Be brutally honest.

**✍️ Caption**
Is the caption compelling? First line hook? CTA? What's weak?

**#️⃣ Hashtags**
Are these right for the ${category || 'general'} niche in India? What's missing?

**📊 Overall Score**
Score out of 10. One clear verdict.

**💡 Suggested Improvements**
Write a better caption. Give exactly 10 better hashtags for the ${category || 'general'} niche in India. Give them something they can copy right now.`

    } else if (type === 'sidecar') {
      analysisPrompt = `${personality}

Analyze this carousel post (${images.length} slides):
SLIDES: [See all images above — in order]
CAPTION: "${caption || 'Not provided'}"
HASHTAGS: "${hashtags || 'Not provided'}"
CREATOR CATEGORY: ${category || 'General'}

Give a structured analysis with these exact sections:

**🎠 Carousel Flow**
Look at every slide. Does slide 1 stop the scroll? Is there a logical flow? Does it make you want to swipe? Does the last slide have a CTA? Be brutally honest slide by slide.

**📐 Visual Consistency**
Fonts, colors, design — consistent or all over the place? Does it look professional?

**✍️ Caption**
Is the caption setting up the carousel well? Does it encourage swiping?

**#️⃣ Hashtags**
Right hashtags for the ${category || 'general'} niche in India? What's missing?

**📊 Overall Score**
Score out of 10. One clear verdict.

**💡 Suggested Improvements**
Rewrite slide 1 text if it's weak. Write a better caption. Give exactly 10 better hashtags for the ${category || 'general'} niche in India. Give them something they can copy right now.`
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [
          { role: 'user', content: [...imageBlocks, { type: 'text', text: analysisPrompt }] }
        ]
      })
    })

    if (!response.ok) {
      const err = await response.json()
      return res.status(502).json({ error: 'AI service error', detail: err })
    }

    const data = await response.json()
    const analysis = data.content?.[0]?.text || ''

    // Save to ai_conversations
    if (user_id) {
      const sessionId = crypto.randomUUID()
      await supabase.from('ai_conversations').insert({
        user_id,
        feature: 'reel-validator',
        session_id: sessionId,
        role: 'assistant',
        content: analysis,
        metadata: { type, caption, hashtags, hook }
      })
    }

    return res.json({ success: true, analysis })

  } catch (err) {
    console.error('Validate error:', err)
    return res.status(500).json({ error: err.message })
  }

}
