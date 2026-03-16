export const maxDuration = 60

import { createClient } from "@supabase/supabase-js"

export default async function handler(req, res) {

  const { user_id, username } = req.query

  if (!user_id || !username) {
    return res.status(400).json({ error: "user_id and username are required" })
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  // Check last_scraped_at for 24hr logic
  const { data: profile } = await supabase
    .from("profiles")
    .select("last_scraped_at")
    .eq("id", user_id)
    .single()

  const lastScraped = profile?.last_scraped_at ? new Date(profile.last_scraped_at) : null
  const now = new Date()
  const hoursSinceLastScrape = lastScraped ? (now - lastScraped) / (1000 * 60 * 60) : null

  if (lastScraped && hoursSinceLastScrape < 24) {
    return res.json({
      success: true,
      scraped: false,
      message: "Using existing data",
      last_scraped_at: lastScraped
    })
  }

  try {

    // Start Apify run async
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
      return res.status(502).json({ error: "No run ID returned from Apify", detail: runData })
    }

    // Poll every 5 seconds up to 10 times (50 seconds)
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
      return res.status(504).json({ error: "Apify timed out, no data returned. Please try again." })
    }

    const scrapedAt = now.toISOString()

    // Insert into profile_snapshots
    const { error: snapshotError } = await supabase
      .from("profile_snapshots")
      .insert({
        user_id:                user_id,
        instagram_username:     igProfile.username,
        instagram_user_id:      igProfile.id,
        full_name:              igProfile.fullName              || null,
        biography:              igProfile.biography             || null,
        external_url:           igProfile.externalUrl           || null,
        external_urls:          igProfile.externalUrls          || null,
        followers_count:        igProfile.followersCount        || 0,
        following_count:        igProfile.followsCount          || 0,
        posts_count:            igProfile.postsCount            || 0,
        highlight_reel_count:   igProfile.highlightReelCount    || 0,
        igtv_video_count:       igProfile.igtvVideoCount        || 0,
        is_business_account:    igProfile.isBusinessAccount     ?? false,
        business_category_name: igProfile.businessCategoryName  || null,
        is_private:             igProfile.private               ?? false,
        is_verified:            igProfile.verified              ?? false,
        profile_pic_url:        igProfile.profilePicUrl         || null,
        profile_pic_url_hd:     igProfile.profilePicUrlHD       || null,
        scraped_at:             scrapedAt
      })

    if (snapshotError) {
      console.error("profile_snapshots error:", snapshotError)
      return res.status(500).json({ error: "Failed to save profile snapshot", detail: snapshotError.message })
    }

    // Insert posts into posts_data
    let insertedPosts = 0
    const posts = igProfile.latestPosts || []

    for (const post of posts) {
      const { error: postError } = await supabase
        .from("posts_data")
        .insert({
          user_id:            user_id,
          instagram_username: igProfile.username,
          instagram_user_id:  igProfile.id,
          post_id:            post.id,
          shortcode:          post.shortCode          || null,
          post_url:           post.url                || null,
          type:               post.type               || null,
          caption:            post.caption            || null,
          hashtags:           post.hashtags           || [],
          mentions:           post.mentions           || [],
          likes_count:        post.likesCount         || 0,
          comments_count:     post.commentsCount      || 0,
          video_view_count:   post.videoViewCount     || null,
          location_name:      post.locationName       || null,
          location_id:        post.locationId         || null,
          dimensions_height:  post.dimensionsHeight   || null,
          dimensions_width:   post.dimensionsWidth    || null,
          display_url:        post.displayUrl         || null,
          video_url:          post.videoUrl           || null,
          is_pinned:          post.isPinned           ?? false,
          comments_disabled:  post.isCommentsDisabled ?? false,
          post_timestamp:     post.timestamp          || null,
          scraped_at:         scrapedAt
        })

      if (!postError) insertedPosts++
    }

    // Upsert audit_log
    await supabase
      .from("audit_log")
      .upsert({
        user_id:            user_id,
        instagram_username: igProfile.username,
        last_scraped_at:    scrapedAt,
        last_posts_count:   igProfile.postsCount || 0
      }, { onConflict: "user_id" })

    // Update last_scraped_at in profiles
    await supabase
      .from("profiles")
      .update({ last_scraped_at: scrapedAt })
      .eq("id", user_id)

    return res.json({
      success: true,
      scraped: true,
      posts_saved: insertedPosts,
      last_scraped_at: scrapedAt
    })

  } catch (err) {
    console.error("Scrape error:", err)
    return res.status(500).json({ error: err.message })
  }

}
