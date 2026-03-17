const { createClient } = require("@supabase/supabase-js")

module.exports = async function handler(req, res) {

  // Vercel cron sends GET requests — verify it's a cron call
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" })
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  // Find all users where last_scraped_at is null or older than 24 hours
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, instagram, last_scraped_at")
    .not("instagram", "is", null)
    .or(`last_scraped_at.is.null,last_scraped_at.lt.${cutoff}`)

  if (error) {
    console.error("Cron fetch error:", error)
    return res.status(500).json({ error: error.message })
  }

  if (!profiles || profiles.length === 0) {
    return res.json({ success: true, message: "No users due for scrape", count: 0 })
  }

  console.log(`Cron: ${profiles.length} users due for scrape`)

  const results = []

  for (const profile of profiles) {
    try {
      // Fire scrape for each user
      const scrapeUrl = `${process.env.VERCEL_URL}/api/scrape?user_id=${profile.id}&username=${profile.instagram}`

      const scrapeRes = await fetch(scrapeUrl)
      const scrapeData = await scrapeRes.json()

      results.push({
        user_id: profile.id,
        instagram: profile.instagram,
        success: scrapeRes.ok,
        result: scrapeData
      })

      // Small delay between users to avoid hammering Apify
      await new Promise(r => setTimeout(r, 2000))

    } catch (err) {
      console.error(`Cron scrape failed for ${profile.instagram}:`, err)
      results.push({
        user_id: profile.id,
        instagram: profile.instagram,
        success: false,
        error: err.message
      })
    }
  }

  const succeeded = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length

  console.log(`Cron complete: ${succeeded} succeeded, ${failed} failed`)

  return res.json({
    success: true,
    total: profiles.length,
    succeeded,
    failed,
    results
  })

}
