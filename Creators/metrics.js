// metrics.js
// Requires supabase.js to be loaded first
// Call getMetrics(userId) for post metrics
// Call getGrowthMetrics(userId) for weekly/monthly growth

async function getMetrics(userId) {

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

  const newestDate = new Date(recentNonPinned[0].post_timestamp)
  const oldestDate = new Date(recentNonPinned[recentNonPinned.length - 1].post_timestamp)

  // Include pinned posts only if within date range of 10 posts
  const validPinnedPosts = pinnedPosts.filter(p => {
    const d = new Date(p.post_timestamp)
    return d >= oldestDate && d <= newestDate
  })

  const postsToAnalyze = [...recentNonPinned]
  for (const pinned of validPinnedPosts) {
    if (!postsToAnalyze.find(p => p.post_id === pinned.post_id)) {
      postsToAnalyze.push(pinned)
    }
  }

  // Latest profile snapshot
  const { data: snapshot } = await client
    .from('profile_snapshots')
    .select('followers_count, posts_count')
    .eq('user_id', userId)
    .order('scraped_at', { ascending: false })
    .limit(1)
    .single()

  const followersCount = snapshot?.followers_count || 0
  const totalPosts = postsToAnalyze.length

  const totalLikes = postsToAnalyze.reduce((sum, p) => sum + (p.likes_count || 0), 0)
  const totalComments = postsToAnalyze.reduce((sum, p) => sum + (p.comments_count || 0), 0)

  const avgLikes = Math.round(totalLikes / totalPosts)
  const avgComments = Math.round(totalComments / totalPosts)

  // --- Engagement Rate ---
  // Video: (comment_rate × like_rate) + like_rate
  //   where comment_rate = comments/views*100, like_rate = likes/views*100
  // Image/Carousel: comments/likes*100
  let totalER = 0
  let erCount = 0

  for (const post of postsToAnalyze) {
    const likes = post.likes_count || 0
    const comments = post.comments_count || 0
    const views = post.video_view_count || 0

    if (post.type === 'Video' && views > 0) {
      const likeRate = likes / views * 100
      const commentRate = comments / views * 100
      const er = (commentRate * likeRate) + likeRate
      totalER += er
      erCount++
    } else if ((post.type === 'Image' || post.type === 'Sidecar') && likes > 0) {
      const er = comments / likes * 100
      totalER += er
      erCount++
    }
  }

  const engagementRate = erCount > 0
    ? parseFloat((totalER / erCount).toFixed(2))
    : 0

  // --- Reach ---
  // Avg video views / followers * 100
  const videoPosts = postsToAnalyze.filter(p => p.type === 'Video' && p.video_view_count > 0)
  const totalVideoViews = videoPosts.reduce((sum, p) => sum + (p.video_view_count || 0), 0)
  const avgVideoViews = videoPosts.length > 0 ? Math.round(totalVideoViews / videoPosts.length) : 0
  const reachRate = followersCount > 0 && avgVideoViews > 0
    ? parseFloat((avgVideoViews / followersCount * 100).toFixed(1))
    : null

  // --- Like-to-view and comment-to-view (video only) ---
  const totalVideoLikes = videoPosts.reduce((sum, p) => sum + (p.likes_count || 0), 0)
  const totalVideoComments = videoPosts.reduce((sum, p) => sum + (p.comments_count || 0), 0)

  const likeToViewRatio = totalVideoViews > 0
    ? parseFloat((totalVideoLikes / totalVideoViews * 100).toFixed(2))
    : null

  const commentToViewRatio = totalVideoViews > 0
    ? parseFloat((totalVideoComments / totalVideoViews * 100).toFixed(2))
    : null

  // --- Content type performance ---
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
    for (const tag of (post.hashtags || [])) {
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
  const sortedByEngagement = [...postsToAnalyze].sort((a, b) =>
    ((b.likes_count || 0) + (b.comments_count || 0)) - ((a.likes_count || 0) + (a.comments_count || 0))
  )

  const bestPost = sortedByEngagement[0] || null
  const worstPost = sortedByEngagement[sortedByEngagement.length - 1] || null

  const imagePosts = postsToAnalyze.filter(p => p.type === 'Image')
  const sidecarPosts = postsToAnalyze.filter(p => p.type === 'Sidecar')

  const avgImageLikes = imagePosts.length > 0
    ? Math.round(imagePosts.reduce((sum, p) => sum + (p.likes_count || 0), 0) / imagePosts.length)
    : 0

  const avgSidecarLikes = sidecarPosts.length > 0
    ? Math.round(sidecarPosts.reduce((sum, p) => sum + (p.likes_count || 0), 0) / sidecarPosts.length)
    : 0

  return {
    totalPostsAnalyzed: totalPosts,
    followersCount,
    avgLikes,
    avgComments,
    engagementRate,
    reachRate,
    avgVideoViews,
    likeToViewRatio,
    commentToViewRatio,
    bestPostType,
    typePerformance,
    avgImageLikes,
    avgSidecarLikes,
    postsPerWeek,
    bestDay,
    topHashtags,
    bestPost,
    worstPost,
    posts: postsToAnalyze
  }
}

async function getGrowthMetrics(userId) {

  // Get all snapshots ordered by date
  const { data: snapshots } = await client
    .from('profile_snapshots')
    .select('followers_count, following_count, posts_count, scraped_at')
    .eq('user_id', userId)
    .order('scraped_at', { ascending: true })

  if (!snapshots || snapshots.length === 0) return null

  const minDate = new Date(snapshots[0].scraped_at)
  const maxDate = new Date(snapshots[snapshots.length - 1].scraped_at)
  const latest = snapshots[snapshots.length - 1]

  const daysSinceFirst = (maxDate - minDate) / (1000 * 60 * 60 * 24)

  // --- Weekly growth ---
  let weeklyGrowth = null
  const weekThreshold = 7

  if (daysSinceFirst >= weekThreshold) {
    const weekAgoDate = new Date(maxDate.getTime() - 7 * 24 * 60 * 60 * 1000)
    const weekAgoSnapshot = snapshots
      .filter(s => new Date(s.scraped_at) <= weekAgoDate)
      .pop()

    if (weekAgoSnapshot) {
      // Posts from last 7 days
      const { data: recentPosts } = await client
        .from('posts_data')
        .select('likes_count, comments_count, post_timestamp')
        .eq('user_id', userId)
        .gte('post_timestamp', weekAgoDate.toISOString())

      // Posts from 7-14 days ago
      const twoWeeksAgo = new Date(maxDate.getTime() - 14 * 24 * 60 * 60 * 1000)
      const { data: prevPosts } = await client
        .from('posts_data')
        .select('likes_count, comments_count, post_timestamp')
        .eq('user_id', userId)
        .gte('post_timestamp', twoWeeksAgo.toISOString())
        .lt('post_timestamp', weekAgoDate.toISOString())

      const recentAvgLikes = recentPosts?.length > 0
        ? Math.round(recentPosts.reduce((s, p) => s + (p.likes_count || 0), 0) / recentPosts.length)
        : null

      const prevAvgLikes = prevPosts?.length > 0
        ? Math.round(prevPosts.reduce((s, p) => s + (p.likes_count || 0), 0) / prevPosts.length)
        : null

      weeklyGrowth = {
        qualified: true,
        followerChange: latest.followers_count - weekAgoSnapshot.followers_count,
        followerChangePct: parseFloat(((latest.followers_count - weekAgoSnapshot.followers_count) / (weekAgoSnapshot.followers_count || 1) * 100).toFixed(1)),
        avgLikesNow: recentAvgLikes,
        avgLikesPrev: prevAvgLikes,
        avgLikesChange: recentAvgLikes !== null && prevAvgLikes !== null ? recentAvgLikes - prevAvgLikes : null,
        postsThisWeek: recentPosts?.length || 0,
        from: weekAgoDate,
        to: maxDate
      }
    }
  } else {
    const daysLeft = Math.ceil(weekThreshold - daysSinceFirst)
    weeklyGrowth = {
      qualified: false,
      daysLeft,
      availableOn: new Date(minDate.getTime() + weekThreshold * 24 * 60 * 60 * 1000)
    }
  }

  // --- Monthly growth ---
  let monthlyGrowth = null
  const monthThreshold = 30

  if (daysSinceFirst >= monthThreshold) {
    const monthAgoDate = new Date(maxDate.getTime() - 30 * 24 * 60 * 60 * 1000)
    const monthAgoSnapshot = snapshots
      .filter(s => new Date(s.scraped_at) <= monthAgoDate)
      .pop()

    if (monthAgoSnapshot) {
      const { data: recentPosts } = await client
        .from('posts_data')
        .select('likes_count, comments_count, post_timestamp')
        .eq('user_id', userId)
        .gte('post_timestamp', monthAgoDate.toISOString())

      const twoMonthsAgo = new Date(maxDate.getTime() - 60 * 24 * 60 * 60 * 1000)
      const { data: prevPosts } = await client
        .from('posts_data')
        .select('likes_count, comments_count, post_timestamp')
        .eq('user_id', userId)
        .gte('post_timestamp', twoMonthsAgo.toISOString())
        .lt('post_timestamp', monthAgoDate.toISOString())

      const recentAvgLikes = recentPosts?.length > 0
        ? Math.round(recentPosts.reduce((s, p) => s + (p.likes_count || 0), 0) / recentPosts.length)
        : null

      const prevAvgLikes = prevPosts?.length > 0
        ? Math.round(prevPosts.reduce((s, p) => s + (p.likes_count || 0), 0) / prevPosts.length)
        : null

      monthlyGrowth = {
        qualified: true,
        followerChange: latest.followers_count - monthAgoSnapshot.followers_count,
        followerChangePct: parseFloat(((latest.followers_count - monthAgoSnapshot.followers_count) / (monthAgoSnapshot.followers_count || 1) * 100).toFixed(1)),
        avgLikesNow: recentAvgLikes,
        avgLikesPrev: prevAvgLikes,
        avgLikesChange: recentAvgLikes !== null && prevAvgLikes !== null ? recentAvgLikes - prevAvgLikes : null,
        postsThisMonth: recentPosts?.length || 0,
        from: monthAgoDate,
        to: maxDate
      }
    }
  } else {
    const daysLeft = Math.ceil(monthThreshold - daysSinceFirst)
    monthlyGrowth = {
      qualified: false,
      daysLeft,
      availableOn: new Date(minDate.getTime() + monthThreshold * 24 * 60 * 60 * 1000)
    }
  }

  return {
    weeklyGrowth,
    monthlyGrowth,
    firstScrapedAt: minDate,
    latestScrapedAt: maxDate,
    daysSinceFirst: Math.floor(daysSinceFirst)
  }
}
