const { createClient } = require("@supabase/supabase-js")

module.exports = async function handler(req, res) {

  const { username } = req.query

  if (!username) {
    return res.status(400).json({ error: "username is required" })
  }

  try {

    // Start Apify run
    const runRes = await fetch(
      `https://api.apify.com/v2/acts/apify~instagram-profile-scraper/runs?token=${process.env.APIFY_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usernames: [username],
          resultsLimit: 20
        })
      }
    )

    if (!runRes.ok) {
      const errText = await runRes.text()
      return res.status(502).json({ error: "Apify run failed to start", detail: errText })
    }

    const runData = await runRes.json()
    const runId = runData.data?.id

    if (!runId) {
      return res.status(502).json({ error: "No run ID from Apify" })
    }

    // Poll every 5 seconds up to 10 times
    let igProfile = null

    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 5000))

      const dataRes = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${process.env.APIFY_TOKEN}`
      )

      if (!dataRes.ok) continue

      const items = await dataRes.json()
      if (items && items.length > 0) {
        igProfile = items[0]
        break
      }
    }

    if (!igProfile) {
      return res.status(504).json({ error: "Profile not found or Apify timed out" })
    }

    // Return profile + posts data — no DB storage
    return res.json({
      success: true,
      profile: {
        username:             igProfile.username,
        id:                   igProfile.id,
        fullName:             igProfile.fullName            || null,
        biography:            igProfile.biography           || null,
        externalUrl:          igProfile.externalUrl         || null,
        followersCount:       igProfile.followersCount      || 0,
        followsCount:         igProfile.followsCount        || 0,
        postsCount:           igProfile.postsCount          || 0,
        highlightReelCount:   igProfile.highlightReelCount  || 0,
        isBusinessAccount:    igProfile.isBusinessAccount   ?? false,
        businessCategoryName: igProfile.businessCategoryName || null,
        private:              igProfile.private             ?? false,
        verified:             igProfile.verified            ?? false,
        profilePicUrl:        igProfile.profilePicUrl       || null,
        latestPosts:          (igProfile.latestPosts || []).map(p => ({
          id:              p.id,
          type:            p.type,
          caption:         p.caption         || '',
          hashtags:        p.hashtags        || [],
          likesCount:      p.likesCount      || 0,
          commentsCount:   p.commentsCount   || 0,
          videoViewCount:  p.videoViewCount  || null,
          timestamp:       p.timestamp       || null,
          isPinned:        p.isPinned        ?? false,
          displayUrl:      p.displayUrl      || null
        }))
      }
    })

  } catch (err) {
    console.error("Competitor scrape error:", err)
    return res.status(500).json({ error: err.message })
  }

}
