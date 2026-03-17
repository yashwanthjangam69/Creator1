
export default async function handler(req, res) {

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { type, images, hook, caption, hashtags, category } = req.body

  if (!images || images.length === 0) {
    return res.status(400).json({ error: 'At least one image is required' })
  }

  try {

    // Build image content blocks for Claude vision
    const imageBlocks = images.map(img => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mediaType || 'image/jpeg',
        data: img.data
      }
    }))

    // Build the analysis prompt based on content type
    let analysisPrompt = ''

    if (type === 'reel') {
      analysisPrompt = `You are an expert Instagram Reel strategist who deeply understands the Indian Instagram ecosystem, Indian audience psychology, and what makes content go viral in India in ${new Date().getFullYear()}.

Analyze this Reel submission:

THUMBNAIL (first frame): [See image above]
HOOK LINE: "${hook || 'Not provided'}"
CAPTION: "${caption || 'Not provided'}"
HASHTAGS: "${hashtags || 'Not provided'}"
CREATOR CATEGORY: ${category || 'General'}

Give a structured analysis with these exact sections:

**🎬 Thumbnail Analysis**
Look at the thumbnail image carefully. Is it scroll-stopping? Does it have a clear subject? Is there too much text? Would an Indian Instagram user stop scrolling for this? Be specific about what you see.

**🪝 Hook Analysis**
Is the hook strong enough to make someone watch past 3 seconds? Does it create curiosity, promise value, or trigger emotion? For Indian audiences specifically — does it work?

**✍️ Caption Analysis**
Is the caption compelling? Does it complement the reel? Does it have a call to action? Is the length appropriate?

**#️⃣ Hashtag Analysis**
Are these hashtags relevant? Too broad or too niche? Mix of sizes? Any missing hashtags for the ${category || 'general'} niche in India?

**📊 Overall Score**
Give a score out of 10 and one clear thing to fix before posting.

Be direct and specific. Reference what you actually see in the thumbnail.`

    } else if (type === 'image') {
      analysisPrompt = `You are an expert Instagram strategist who deeply understands the Indian Instagram ecosystem and what makes single image posts perform well in India in ${new Date().getFullYear()}.

Analyze this single image post:

IMAGE: [See image above]
CAPTION: "${caption || 'Not provided'}"
HASHTAGS: "${hashtags || 'Not provided'}"
CREATOR CATEGORY: ${category || 'General'}

Give a structured analysis with these exact sections:

**🖼️ Image Analysis**
Look at the image carefully. Is it visually strong? Good composition? Lighting? Does it stop the scroll? What emotion does it evoke? Would an Indian Instagram user engage with this?

**✍️ Caption Analysis**
Is the caption compelling? Does it add context or emotion to the image? Is there a hook in the first line? Call to action?

**#️⃣ Hashtag Analysis**
Are these hashtags relevant and well-mixed? Any missing tags for the ${category || 'general'} niche in India?

**📊 Overall Score**
Score out of 10 and one clear thing to fix before posting.

Be direct and specific about what you see in the image.`

    } else if (type === 'sidecar') {
      analysisPrompt = `You are an expert Instagram strategist who deeply understands carousel/sidecar posts and what makes them perform well in India in ${new Date().getFullYear()}.

Analyze this carousel/sidecar post (${images.length} slides):

SLIDES: [See images above — in order from first to last]
CAPTION: "${caption || 'Not provided'}"
HASHTAGS: "${hashtags || 'Not provided'}"
CREATOR CATEGORY: ${category || 'General'}

Give a structured analysis with these exact sections:

**🎠 Carousel Flow Analysis**
Look at all slides carefully. Does the first slide stop the scroll? Is there a logical flow from slide to slide? Does it make the viewer want to swipe? Is the visual style consistent? Does the last slide have a clear CTA or conclusion?

**📐 Visual Consistency**
Are the fonts, colors, and design consistent across slides? Does it look professionally designed or thrown together?

**✍️ Caption Analysis**
Does the caption complement the carousel? Is it setting up the content well? Does it encourage swiping?

**#️⃣ Hashtag Analysis**
Are these hashtags relevant and well-mixed for the ${category || 'general'} niche in India?

**📊 Overall Score**
Score out of 10 and the single most important thing to fix.

Be specific about what you see in each slide.`
    }

    // Build messages array for Claude
    const userContent = [
      ...imageBlocks,
      { type: 'text', text: analysisPrompt }
    ]

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
          { role: 'user', content: userContent }
        ]
      })
    })

    if (!response.ok) {
      const err = await response.json()
      console.error('Claude API error:', err)
      return res.status(502).json({ error: 'AI service error', detail: err })
    }

    const data = await response.json()
    const analysis = data.content?.[0]?.text || ''

    return res.json({ success: true, analysis })

  } catch (err) {
    console.error('Validate error:', err)
    return res.status(500).json({ error: err.message })
  }

}
