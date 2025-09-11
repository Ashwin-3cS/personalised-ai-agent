import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User, Subscription, Post } from '../models';

// Load environment variables
dotenv.config();

const sampleTweets = [
  {
    content: "Just launched our new AI-powered analytics dashboard! 🚀 The future of data visualization is here. Machine learning algorithms now automatically detect patterns and anomalies in your data streams. #AI #Analytics #TechInnovation",
    authorUsername: "elonmusk",
    authorName: "Elon Musk",
    engagement: { likes: 15420, retweets: 3240, replies: 890, quotes: 156 },
    hashtags: ["AI", "Analytics", "TechInnovation"],
    createdHoursAgo: 2
  },
  {
    content: "Breaking: Major breakthrough in quantum computing achieved! Our team successfully demonstrated quantum supremacy with a 1000-qubit processor. This could revolutionize cryptography, drug discovery, and financial modeling. The implications are enormous! 🧬⚛️",
    authorUsername: "elonmusk", 
    authorName: "Elon Musk",
    engagement: { likes: 28750, retweets: 8920, replies: 2340, quotes: 445 },
    hashtags: ["QuantumComputing", "Science", "Innovation"],
    createdHoursAgo: 4
  },
  {
    content: "Market update: Cryptocurrency showing strong bullish signals across the board. Bitcoin up 12%, Ethereum gaining momentum at 8%. DeFi protocols experiencing unprecedented growth. Smart money is moving into blockchain infrastructure. #Crypto #DeFi #Bitcoin",
    authorUsername: "twitter",
    authorName: "Twitter",
    engagement: { likes: 9870, retweets: 2340, replies: 567, quotes: 89 },
    hashtags: ["Crypto", "DeFi", "Bitcoin"],
    createdHoursAgo: 6
  },
  {
    content: "Climate change update: New renewable energy project will power 2 million homes with solar and wind. Investment in green technology reached $500B globally this year. We're seeing a fundamental shift towards sustainable energy solutions. The transition is accelerating! 🌱⚡",
    authorUsername: "twitter",
    authorName: "Twitter", 
    engagement: { likes: 18650, retweets: 5670, replies: 1230, quotes: 234 },
    hashtags: ["ClimateChange", "RenewableEnergy", "Sustainability"],
    createdHoursAgo: 8
  },
  {
    content: "Space exploration milestone: Mars rover discovers potential signs of ancient microbial life! Soil samples contain organic compounds that suggest Mars may have supported life billions of years ago. This changes everything we know about planetary biology. 🚀🔴",
    authorUsername: "elonmusk",
    authorName: "Elon Musk",
    engagement: { likes: 45230, retweets: 12890, replies: 3450, quotes: 678 },
    hashtags: ["SpaceExploration", "Mars", "Science"],
    createdHoursAgo: 12
  },
  {
    content: "Tech industry layoffs continue as companies restructure for AI-first operations. However, demand for AI engineers, data scientists, and machine learning specialists is at an all-time high. The job market is transforming rapidly. Reskilling is crucial. #TechJobs #AI #Career",
    authorUsername: "twitter",
    authorName: "Twitter",
    engagement: { likes: 7890, retweets: 2100, replies: 890, quotes: 145 },
    hashtags: ["TechJobs", "AI", "Career"],
    createdHoursAgo: 16
  },
  {
    content: "Healthcare revolution: AI-powered diagnostic tools now detect cancer with 99.7% accuracy, outperforming human radiologists. Early detection rates improved by 40%. This technology will save millions of lives and reduce healthcare costs globally. Medical AI is the future! 🏥🤖",
    authorUsername: "elonmusk",
    authorName: "Elon Musk",
    engagement: { likes: 67890, retweets: 18900, replies: 4560, quotes: 890 },
    hashtags: ["HealthTech", "AI", "Medicine"],
    createdHoursAgo: 20
  },
  {
    content: "Financial markets experiencing volatility as central banks adjust interest rates. Inflation concerns persist despite recent economic indicators showing improvement. Investors are diversifying into commodities and real estate. Economic uncertainty continues. 📈📉",
    authorUsername: "twitter",
    authorName: "Twitter",
    engagement: { likes: 12340, retweets: 3450, replies: 1200, quotes: 234 },
    hashtags: ["Finance", "Economy", "Markets"],
    createdHoursAgo: 24
  }
];

async function createTestTweets() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI!);
    console.log('Connected to MongoDB');

    // Find a test user (you can modify this email to match your test user)
    const user = await User.findOne({ email: 'test@example.com' });
    if (!user) {
      console.error('Test user not found. Please create a user with email: test@example.com');
      process.exit(1);
    }

    console.log(`Found user: ${user.email}`);

    // Find or create subscriptions for the sample usernames
    const usernames = ['elonmusk', 'twitter'];
    const subscriptions = [];

    for (const username of usernames) {
      let subscription = await Subscription.findOne({
        userId: user._id,
        targetUsername: username
      });

      if (!subscription) {
        subscription = new Subscription({
          userId: user._id,
          targetUsername: username,
          checkInterval: 60,
          keywords: [],
          includeReplies: false,
          includeRetweets: false,
          isActive: true,
          lastChecked: new Date(Date.now() - 48 * 60 * 60 * 1000) // 48 hours ago
        });
        await subscription.save();
        console.log(`Created subscription for @${username}`);
      }
      subscriptions.push(subscription);
    }

    // Create test tweets
    let createdCount = 0;
    
    for (const tweetData of sampleTweets) {
      // Find the subscription for this username
      const subscription = subscriptions.find(sub => sub.targetUsername === tweetData.authorUsername);
      if (!subscription) continue;

      // Generate a unique tweet ID
      const tweetId = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Check if a similar tweet already exists (to avoid duplicates)
      const existingTweet = await Post.findOne({
        userId: user._id,
        content: tweetData.content
      });

      if (existingTweet) {
        console.log(`Tweet already exists: ${tweetData.content.substring(0, 50)}...`);
        continue;
      }

      // Create the tweet
      const tweetCreatedAt = new Date(Date.now() - tweetData.createdHoursAgo * 60 * 60 * 1000);
      
      const post = new Post({
        tweetId,
        subscriptionId: subscription._id,
        userId: user._id,
        content: tweetData.content,
        authorUsername: tweetData.authorUsername,
        authorName: tweetData.authorName,
        authorAvatar: `https://pbs.twimg.com/profile_images/sample_${tweetData.authorUsername}.jpg`,
        engagement: tweetData.engagement,
        mediaUrls: [],
        tweetCreatedAt,
        tweetUrl: `https://twitter.com/${tweetData.authorUsername}/status/${tweetId}`,
        isReply: false,
        isRetweet: false,
        hashtags: tweetData.hashtags,
        mentions: [],
        isRead: false
      });

      await post.save();
      createdCount++;
      console.log(`✅ Created tweet: ${tweetData.content.substring(0, 60)}...`);
    }

    console.log(`\n🎉 Successfully created ${createdCount} test tweets!`);
    console.log('\nYou can now test the AI summarization endpoints:');
    console.log('- GET /api/updates/quick-summary');
    console.log('- GET /api/updates/summarized?type=detailed');
    console.log('- GET /api/updates/detailed-analysis?days=2');

  } catch (error) {
    console.error('Error creating test tweets:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

// Run the script
createTestTweets();