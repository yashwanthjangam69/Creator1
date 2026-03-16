// metrics.js
// Call getMetrics(userId) from any page to get all creator metrics
// Requires supabase.js to be loaded first

async function getMetrics(userId) {

  // Fetch all posts for this user ordered by post_timestamp descending
  const { data: allPosts, error } = await client
    .from('posts_data')
    .select('*')
    .eq('user_id', userId)
    .order('post_timestamp', { ascending: false })

  if (error || !allPosts || allPosts.length === 0) {
    console.error('Error fetching posts:', error)
    return null
  }

  // Separate pinned and non-pinned
  const pinnedPosts = allPosts.filter(p => p.is_pinned)
  const nonPinnedPosts = allPosts.filter(p => !p.is_pinned)

  // Take 10 most recent non-pinned posts
  const recentNonPinned = nonPinnedPosts.slice(0, 10)

  if (recentNonPinned.length === 0) return null

  // Get date range of the 10 recent posts
  const newestDate = new Date(recentNonPinned[0].post_timestamp)
  const oldestDate = new Date(recentNonPinned[recentNonPinned.length - 1].post_timestamp)

  // Include pinned posts only if their timestamp falls within the 10 post range
  const validPinnedPosts = pinnedPosts.filter(p => {
    const postDate = new Date(p.post_timestamp)
    return postDate >= oldestDate && postDate <= newestDate
  })

  // Final set of posts to calculate metrics from
  const postsToAnalyze = [...recentNonPinned]

  // Add valid pinned posts (avoid duplicates)
  for (const pinned of validPinnedPosts) {
    if (!postsToAnalyze.find(p => p.post_id === pinned.post_id)) {
      postsToAnalyze.push(pinned)
    }
  }

  // Fetch latest profile snapshot for follower count
  const { data: snapshot } = await client
    .from('profile_snapshots')
    .select('followers_count, posts_count')
    .eq('user_id', userId)
    .order('scraped_at', { ascending: false })
    .limit(1)
    .single()

  const followersCount = snapshot?.followers_count || 0
  const totalPosts = postsToAnalyze.length

  // --- Core counts ---
  const totalLikes = postsToAnalyze.reduce((sum, p) => sum + (p.likes_count || 0), 0)
  const totalComments = postsToAnalyze.reduce((sum, p) => sum + (p.comments_count || 0), 0)
  const totalViews = postsToAnalyze.reduce((sum, p) => sum + (p.video_view_count || 0), 0)

  const avgLikes = Math.round(totalLikes / totalPosts)
  const avgComments = Math.round(totalComments / totalPosts)

  // --- Engagement Rate ---
  // Video/Reel: (likes + comments) / video_views × 100 per post
  // Image/Sidecar: (likes + comments) / followers × 100 per post
  // Then average across all posts

  let totalER = 0
  let erCount = 0

  for (const post of postsToAnalyze) {
    const engagement = (post.likes_count || 0) + (post.comments_count || 0)

    if (post.type === 'Video' && post.video_view_count > 0) {
      totalER += (engagement / post.video_view_count * 100)
      erCount++
    } else if (followersCount > 0) {
      totalER += (engagement / followersCount * 100)
      erCount++
    }
  }

  const engagementRate = erCount > 0
    ? parseFloat((totalER / erCount).toFixed(2))
    : 0

  // --- Like-to-View ratio (videos only) ---
  // High views low likes = hook worked but content didn't deliver
  const videoPosts = postsToAnalyze.filter(p => p.type === 'Video' && p.video_view_count > 0)
  const totalVideoLikes = videoPosts.reduce((sum, p) => sum + (p.likes_count || 0), 0)
  const totalVideoViews = videoPosts.reduce((sum, p) => sum + (p.video_view_count || 0), 0)
  const totalVideoComments = videoPosts.reduce((sum, p) => sum + (p.comments_count || 0), 0)

  const likeToViewRatio = totalVideoViews > 0
    ? parseFloat((totalVideoLikes / totalVideoViews * 100).toFixed(2))
    : null

  const commentToViewRatio = totalVideoViews > 0
    ? parseFloat((totalVideoComments / totalVideoViews * 100).toFixed(2))
    : null

  // Hook score interpretation
  // If like-to-view is low (<2%) = hook worked but content failed to convert
  // If like-to-view is high (>5%) = strong content quality
  let hookSignal = null
  if (likeToViewRatio !== null) {
    if (likeToViewRatio >= 5) hookSignal = 'strong'
    else if (likeToViewRatio >= 2) hookSignal = 'average'
    else hookSignal = 'weak'
  }

  // --- Best performing post type ---
  const typeGroups = {}
  for (const post of postsToAnalyze) {
    const type = post.type || 'Unknown'
    if (!typeGroups[type]) typeGroups[type] = { likes: 0, comments: 0, views: 0, count: 0 }
    typeGroups[type].likes += post.likes_count || 0
    typeGroups[type].comments += post.comments_count || 0
    typeGroups[type].views += post.video_view_count || 0
    typeGroups[type].count++
  }

  const typePerformance = Object.entries(typeGroups).map(([type, data]) => ({
    type,
    count: data.count,
    avgLikes: Math.round(data.likes / data.count),
    avgComments: Math.round(data.comments / data.count),
    avgViews: data.views > 0 ? Math.round(data.views / data.count) : 0,
    avgEngagement: Math.round((data.likes + data.comments) / data.count)
  })).sort((a, b) => b.avgEngagement - a.avgEngagement)

  const bestPostType = typePerformance[0]?.type || 'Unknown'

  // --- Top hashtags ---
  const hashtagCount = {}
  for (const post of postsToAnalyze) {
    const tags = post.hashtags || []
    for (const tag of tags) {
      hashtagCount[tag] = (hashtagCount[tag] || 0) + 1
    }
  }

  const topHashtags = Object.entries(hashtagCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }))

  // --- Posting frequency ---
  const daysDiff = (newestDate - oldestDate) / (1000 * 60 * 60 * 24)
  const weeksDiff = daysDiff / 7 || 1
  const postsPerWeek = parseFloat((totalPosts / weeksDiff).toFixed(1))

  // --- Best day to post ---
  const dayGroups = {}
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

  for (const post of postsToAnalyze) {
    if (!post.post_timestamp) continue
    const day = dayNames[new Date(post.post_timestamp).getDay()]
    if (!dayGroups[day]) dayGroups[day] = { engagement: 0, count: 0 }
    dayGroups[day].engagement += (post.likes_count || 0) + (post.comments_count || 0)
    dayGroups[day].count++
  }

  const bestDay = Object.entries(dayGroups)
    .map(([day, data]) => ({ day, avgEngagement: Math.round(data.engagement / data.count) }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement)[0]?.day || 'Unknown'

  // --- Best and worst post ---
  const sortedByEngagement = [...postsToAnalyze].sort((a, b) => {
    const engA = (a.likes_count || 0) + (a.comments_count || 0)
    const engB = (b.likes_count || 0) + (b.comments_count || 0)
    return engB - engA
  })

  const bestPost = sortedByEngagement[0] || null
  const worstPost = sortedByEngagement[sortedByEngagement.length - 1] || null

  // --- Avg video views ---
  const avgVideoViews = videoPosts.length > 0
    ? Math.round(totalVideoViews / videoPosts.length)
    : 0

  const imagePosts = postsToAnalyze.filter(p => p.type === 'Image')
  const sidecarPosts = postsToAnalyze.filter(p => p.type === 'Sidecar')

  const avgImageLikes = imagePosts.length > 0
    ? Math.round(imagePosts.reduce((sum, p) => sum + (p.likes_count || 0), 0) / imagePosts.length)
    : 0

  const avgSidecarLikes = sidecarPosts.length > 0
    ? Math.round(sidecarPosts.reduce((sum, p) => sum + (p.likes_count || 0), 0) / sidecarPosts.length)
    : 0

  return {
    // Core
    totalPostsAnalyzed: totalPosts,
    followersCount,

    // Engagement
    avgLikes,
    avgComments,
    engagementRate,

    // Video signals
    avgVideoViews,
    likeToViewRatio,
    commentToViewRatio,
    hookSignal,

    // Content type
    bestPostType,
    typePerformance,
    avgImageLikes,
    avgSidecarLikes,

    // Timing
    postsPerWeek,
    bestDay,

    // Hashtags
    topHashtags,

    // Best / worst
    bestPost,
    worstPost,

    // Raw posts (for Vikram context)
    posts: postsToAnalyze
  }
}
