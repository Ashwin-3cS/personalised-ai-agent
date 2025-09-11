import express from 'express';
import mongoose, { Document } from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cron from 'node-cron';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import dotenv from 'dotenv';

import { User, Subscription, Post, ActivityLog, aggregationPipelines } from './models';
import { TwitterService } from './twitter-service';
import AISummarizationService from './services/ai-summarization';
import logger from './utils/logger';

// Load environment variables
dotenv.config();

const app = express();

// Security middleware
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '15') * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Authentication middleware
interface AuthRequest extends express.Request {
  user?: {
    userId: string;
    email: string;
  };
}

const authenticateToken = (req: AuthRequest, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET!, (err: any, user: any) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
};

// Validation middleware
const handleValidationErrors = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

// Activity logging helper
const logActivity = async (userId: string, action: string, details?: any, req?: express.Request) => {
  try {
    // Handle system activities that don't have a real user ID
    const userObjectId = userId === 'system' ? null : new mongoose.Types.ObjectId(userId);
    
    await ActivityLog.create({
      userId: userObjectId,
      action,
      details,
      ipAddress: req?.ip,
      userAgent: req?.get('User-Agent')
    });
  } catch (error) {
    logger.error('Failed to log activity:', error);
  }
};

// ROUTES

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    version: process.env.npm_package_version || '1.0.0'
  });
});

// User Registration
app.post('/api/auth/register',
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  handleValidationErrors,
  async (req, res) => {
    try {
      const { email, password } = req.body;

      // Check if user exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ error: 'User already exists with this email' });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 12);

      // Create user
      const user = new User({
        email,
        password: hashedPassword,
        isActive: true
      });

      await user.save();

      // Generate JWT
      const token = jwt.sign(
        { userId: (user._id as mongoose.Types.ObjectId).toString(), email: user.email },
        process.env.JWT_SECRET!,
        { expiresIn: '24h' }
      );

      await logActivity((user._id as mongoose.Types.ObjectId).toString(), 'user_registered', { email }, req);

      res.status(201).json({
        success: true,
        token,
        user: {
          id: user._id,
          email: user.email,
          createdAt: user.createdAt
        }
      });

    } catch (error: any) {
      logger.error('Registration error:', error);
      res.status(500).json({ error: 'Registration failed' });
    }
  }
);

// User Login
app.post('/api/auth/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  handleValidationErrors,
  async (req, res) => {
    try {
      const { email, password } = req.body;

      // Find user
      const user = await User.findOne({ email, isActive: true });
      if (!user || !await bcrypt.compare(password, user.password)) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // Generate JWT
      const token = jwt.sign(
        { userId: (user._id as mongoose.Types.ObjectId).toString(), email: user.email },
        process.env.JWT_SECRET!,
        { expiresIn: '24h' }
      );

      await logActivity((user._id as mongoose.Types.ObjectId).toString(), 'user_login', { email }, req);

      res.json({
        success: true,
        token,
        user: {
          id: user._id,
          email: user.email,
          twitterUsername: user.twitterUsername,
          hasTwitterCredentials: !!user.twitterCredentials
        }
      });

    } catch (error: any) {
      logger.error('Login error:', error);
      res.status(500).json({ error: 'Login failed' });
    }
  }
);

// Setup Twitter credentials
app.post('/api/twitter/setup',
  authenticateToken,
  body('apiKey').notEmpty(),
  body('apiSecret').notEmpty(),
  body('accessToken').notEmpty(),
  body('accessTokenSecret').notEmpty(),
  handleValidationErrors,
  async (req: AuthRequest, res) => {
    try {
      const { apiKey, apiSecret, accessToken, accessTokenSecret } = req.body;
      const userId = req.user!.userId;

      // Test credentials
      const twitterService = new TwitterService({
        apiKey, apiSecret, accessToken, accessTokenSecret
      }, new mongoose.Types.ObjectId(userId));

      const profile = await twitterService.verifyCredentials();

      // Encrypt and store credentials
      const encryptedCredentials = TwitterService.encryptCredentials({
        apiKey, apiSecret, accessToken, accessTokenSecret
      });

      await User.findByIdAndUpdate(userId, {
        twitterCredentials: encryptedCredentials,
        twitterUsername: profile.username
      });

      await logActivity(userId, 'twitter_setup', { username: profile.username }, req);

      res.json({
        success: true,
        message: 'Twitter credentials setup successfully',
        profile: {
          username: profile.username,
          name: profile.name,
          followersCount: profile.public_metrics?.followers_count,
          followingCount: profile.public_metrics?.following_count
        }
      });

    } catch (error: any) {
      logger.error('Twitter setup error:', error);
      res.status(400).json({ error: error.message || 'Failed to setup Twitter credentials' });
    }
  }
);

// Create subscription
app.post('/api/subscriptions',
  authenticateToken,
  body('targetUsername').notEmpty().trim().toLowerCase(),
  body('checkInterval').optional().isInt({ min: 15, max: 1440 }),
  body('keywords').optional().isArray(),
  body('includeReplies').optional().isBoolean(),
  body('includeRetweets').optional().isBoolean(),
  handleValidationErrors,
  async (req: AuthRequest, res) => {
    try {
      const { targetUsername, checkInterval = 60, keywords = [], includeReplies = false, includeRetweets = false } = req.body;
      const userId = req.user!.userId;

      // Check if Twitter is setup
      const user = await User.findById(userId);
      if (!user?.twitterCredentials) {
        return res.status(400).json({ error: 'Twitter credentials not setup' });
      }

      // Verify target user exists
      const twitterService = await TwitterService.createForUser(new mongoose.Types.ObjectId(userId));
      if (!twitterService) {
        return res.status(400).json({ error: 'Failed to initialize Twitter service' });
      }

      const targetUser = await twitterService.getUserByUsername(targetUsername);
      
      // Check if subscription already exists
      const existingSub = await Subscription.findOne({
        userId: new mongoose.Types.ObjectId(userId),
        targetUsername
      });

      if (existingSub) {
        if (existingSub.isActive) {
          return res.status(400).json({ error: 'Already subscribed to this user' });
        } else {
          // Reactivate existing subscription
          existingSub.isActive = true;
          existingSub.checkInterval = checkInterval;
          existingSub.keywords = keywords;
          existingSub.includeReplies = includeReplies;
          existingSub.includeRetweets = includeRetweets;
          existingSub.lastChecked = new Date();
          await existingSub.save();

          await logActivity(userId, 'subscription_created', { targetUsername, reactivated: true }, req);

          return res.json({
            success: true,
            subscription: existingSub
          });
        }
      }

      // Create new subscription
      const subscription = new Subscription({
        userId: new mongoose.Types.ObjectId(userId),
        targetUsername,
        checkInterval,
        keywords,
        includeReplies,
        includeRetweets,
        isActive: true,
        lastChecked: new Date()
      });

      await subscription.save();

      await logActivity(userId, 'subscription_created', { targetUsername }, req);

      res.status(201).json({
        success: true,
        subscription,
        targetUserInfo: {
          name: targetUser.name,
          followersCount: targetUser.public_metrics?.followers_count,
          verified: targetUser.verified
        }
      });

    } catch (error: any) {
      logger.error('Subscription creation error:', error);
      res.status(500).json({ error: error.message || 'Failed to create subscription' });
    }
  }
);

// Get user subscriptions
app.get('/api/subscriptions', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;

    const subscriptions = await Subscription.aggregate(
      aggregationPipelines.getSubscriptionStats(new mongoose.Types.ObjectId(userId))
    );

    res.json({ subscriptions });

  } catch (error: any) {
    logger.error('Get subscriptions error:', error);
    res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
});

// Get updates
app.get('/api/updates', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const since = req.query.since ? new Date(req.query.since as string) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const limit = parseInt(req.query.limit as string) || 50;
    const unreadOnly = req.query.unreadOnly === 'true';

    const query: any = {
      userId: new mongoose.Types.ObjectId(userId),
      tweetCreatedAt: { $gte: since }
    };

    if (unreadOnly) {
      query.isRead = false;
    }

    const posts = await Post.find(query)
      .populate('subscriptionId', 'targetUsername')
      .sort({ tweetCreatedAt: -1 })
      .limit(limit)
      .lean();

    await logActivity(userId, 'updates_viewed', { count: posts.length, since }, req);

    res.json({
      posts,
      count: posts.length,
      unreadCount: unreadOnly ? posts.length : await Post.countDocuments({
        userId: new mongoose.Types.ObjectId(userId),
        isRead: false
      })
    });

  } catch (error: any) {
    logger.error('Get updates error:', error);
    res.status(500).json({ error: 'Failed to fetch updates' });
  }
});

// Manual refresh subscription
app.post('/api/subscriptions/:id/refresh', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const subscriptionId = req.params.id;
    const userId = req.user!.userId;

    const subscription = await Subscription.findOne({
      _id: subscriptionId,
      userId: new mongoose.Types.ObjectId(userId)
    });

    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    const twitterService = await TwitterService.createForUser(new mongoose.Types.ObjectId(userId));
    if (!twitterService) {
      return res.status(400).json({ error: 'Twitter service unavailable' });
    }

    const newTweetsCount = await twitterService.processSubscriptionTweets(subscription);

    await logActivity(userId, 'subscription_refreshed', { 
      subscriptionId, 
      targetUsername: subscription.targetUsername,
      newTweetsCount 
    }, req);

    res.json({
      success: true,
      message: `Refresh completed. ${newTweetsCount} new tweets found.`,
      newTweetsCount
    });

  } catch (error: any) {
    logger.error('Subscription refresh error:', error);
    res.status(500).json({ error: error.message || 'Failed to refresh subscription' });
  }
});

// Delete subscription
app.delete('/api/subscriptions/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const subscriptionId = req.params.id;
    const userId = req.user!.userId;

    const subscription = await Subscription.findOneAndUpdate(
      { _id: subscriptionId, userId: new mongoose.Types.ObjectId(userId) },
      { isActive: false },
      { new: true }
    );

    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    await logActivity(userId, 'subscription_deleted', { 
      subscriptionId, 
      targetUsername: subscription.targetUsername 
    }, req);

    res.json({
      success: true,
      message: 'Subscription deleted successfully'
    });

  } catch (error: any) {
    logger.error('Delete subscription error:', error);
    res.status(500).json({ error: 'Failed to delete subscription' });
  }
});

// Mark posts as read
app.post('/api/posts/mark-read', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { postIds } = req.body;
    const userId = req.user!.userId;

    if (!Array.isArray(postIds)) {
      return res.status(400).json({ error: 'postIds must be an array' });
    }

    const result = await Post.updateMany(
      {
        _id: { $in: postIds.map(id => new mongoose.Types.ObjectId(id)) },
        userId: new mongoose.Types.ObjectId(userId)
      },
      { isRead: true }
    );

    res.json({
      success: true,
      updatedCount: result.modifiedCount
    });

  } catch (error: any) {
    logger.error('Mark posts as read error:', error);
    res.status(500).json({ error: 'Failed to mark posts as read' });
  }
});

// Get user analytics
app.get('/api/analytics', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const days = parseInt(req.query.days as string) || 30;

    const [subscriptionStats, engagementSummary, trendingHashtags] = await Promise.all([
      Subscription.aggregate(aggregationPipelines.getSubscriptionStats(new mongoose.Types.ObjectId(userId))),
      Post.aggregate(aggregationPipelines.getEngagementSummary(new mongoose.Types.ObjectId(userId), days)),
      Post.aggregate(aggregationPipelines.getTrendingHashtags(new mongoose.Types.ObjectId(userId), days))
    ]);

    res.json({
      subscriptionStats,
      engagementSummary: engagementSummary[0] || {},
      trendingHashtags,
      period: `${days} days`
    });

  } catch (error: any) {
    logger.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// AI SUMMARIZATION ENDPOINTS

// Get AI-summarized updates
app.get('/api/updates/summarized', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const since = req.query.since ? new Date(req.query.since as string) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const analysisType = (req.query.type as string) || 'quick'; // quick, detailed, insights
    const limit = parseInt(req.query.limit as string) || 20;

    // Get posts from subscriptions
    const posts = await Post.find({
      userId: new mongoose.Types.ObjectId(userId),
      tweetCreatedAt: { $gte: since }
    })
    .populate('subscriptionId', 'targetUsername')
    .sort({ tweetCreatedAt: -1 })
    .limit(limit)
    .lean();

    if (posts.length === 0) {
      return res.json({
        summary: 'No recent tweets found from your subscriptions.',
        posts: [],
        count: 0,
        analysis: null
      });
    }

    // Generate AI summary
    const analysis = await AISummarizationService.summarizeTweets(posts, {
      userId,
      analysisType: analysisType as 'quick' | 'detailed' | 'insights'
    });

    // Log activity
    await logActivity(userId, 'ai_summary_generated', {
      postCount: posts.length,
      analysisType,
      tokensUsed: analysis.tokensUsed
    }, req);

    res.json({
      summary: analysis.summary,
      keyTopics: analysis.keyTopics,
      sentiment: analysis.sentiment,
      insights: (analysis as any).insights,
      posts: posts.map(post => ({
        id: post._id,
        tweetId: post.tweetId,
        content: post.content.substring(0, 150) + '...',
        authorUsername: post.authorUsername,
        engagement: post.engagement,
        tweetCreatedAt: post.tweetCreatedAt,
        tweetUrl: post.tweetUrl
      })),
      count: posts.length,
      analysis: {
        tokensUsed: analysis.tokensUsed,
        model: analysisType,
        generatedAt: new Date()
      }
    });

  } catch (error: any) {
    logger.error('AI summarization error:', error);
    res.status(500).json({
      error: error.message || 'Failed to generate AI summary',
      fallback: 'Try using the regular /api/updates endpoint'
    });
  }
});

// Quick summary endpoint (optimized for speed)
app.get('/api/updates/quick-summary', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const since = req.query.since ? new Date(req.query.since as string) : new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Get only recent posts (limit to 10 for quick processing)
    const posts = await Post.find({
      userId: new mongoose.Types.ObjectId(userId),
      tweetCreatedAt: { $gte: since }
    })
    .sort({ tweetCreatedAt: -1 })
    .limit(10)
    .lean();

    if (posts.length === 0) {
      return res.json({
        summary: 'No recent activity from your subscriptions.',
        count: 0
      });
    }

    // Use quick summarization
    const summary = await AISummarizationService.quickSummarize(posts, userId);

    await logActivity(userId, 'quick_summary_generated', { postCount: posts.length }, req);

    res.json({
      summary,
      count: posts.length,
      lastUpdated: new Date(),
      type: 'quick'
    });

  } catch (error: any) {
    logger.error('Quick summary error:', error);
    res.status(500).json({ error: 'Failed to generate quick summary' });
  }
});

// Detailed analysis endpoint
app.get('/api/updates/detailed-analysis', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const days = parseInt(req.query.days as string) || 1;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Get more posts for detailed analysis
    const posts = await Post.find({
      userId: new mongoose.Types.ObjectId(userId),
      tweetCreatedAt: { $gte: since }
    })
    .populate('subscriptionId', 'targetUsername')
    .sort({ tweetCreatedAt: -1 })
    .limit(50)
    .lean();

    if (posts.length === 0) {
      return res.json({
        error: 'No tweets found for analysis',
        suggestion: 'Try refreshing your subscriptions first'
      });
    }

    // Generate detailed analysis
    const analysis = await AISummarizationService.detailedAnalysis(posts, userId);

    // Get additional stats
    const subscriptionStats = await Subscription.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId), isActive: true } },
      {
        $lookup: {
          from: 'posts',
          localField: '_id',
          foreignField: 'subscriptionId',
          as: 'recentPosts',
          pipeline: [
            { $match: { tweetCreatedAt: { $gte: since } } },
            { $sort: { tweetCreatedAt: -1 } }
          ]
        }
      },
      {
        $project: {
          targetUsername: 1,
          postCount: { $size: '$recentPosts' },
          avgEngagement: {
            $cond: {
              if: { $gt: [{ $size: '$recentPosts' }, 0] },
              then: {
                $avg: {
                  $map: {
                    input: '$recentPosts',
                    as: 'post',
                    in: {
                      $add: [
                        { $ifNull: ['$post.engagement.likes', 0] },
                        { $ifNull: ['$post.engagement.retweets', 0] }
                      ]
                    }
                  }
                }
              },
              else: 0
            }
          }
        }
      }
    ]);

    await logActivity(userId, 'detailed_analysis_generated', {
      postCount: posts.length,
      days,
      tokensUsed: analysis.tokensUsed
    }, req);

    res.json({
      summary: analysis.summary,
      keyTopics: analysis.keyTopics,
      sentiment: analysis.sentiment,
      insights: (analysis as any).insights,
      stats: {
        totalPosts: posts.length,
        daysCovered: days,
        subscriptionBreakdown: subscriptionStats,
        tokensUsed: analysis.tokensUsed
      },
      generatedAt: new Date(),
      type: 'detailed'
    });

  } catch (error: any) {
    logger.error('Detailed analysis error:', error);
    res.status(500).json({ 
      error: 'Failed to generate detailed analysis',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Refresh and summarize endpoint (combines refresh with AI summary)
app.post('/api/subscriptions/refresh-and-summarize', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;

    // Get all active subscriptions
    const subscriptions = await Subscription.find({
      userId: new mongoose.Types.ObjectId(userId),
      isActive: true
    });

    if (subscriptions.length === 0) {
      return res.status(400).json({ error: 'No active subscriptions found' });
    }

    // Refresh all subscriptions
    let totalNewTweets = 0;
    const errors: string[] = [];

    const twitterService = await TwitterService.createForUser(new mongoose.Types.ObjectId(userId));
    if (!twitterService) {
      return res.status(400).json({ error: 'Twitter service unavailable' });
    }

    for (const subscription of subscriptions) {
      try {
        const newTweetsCount = await twitterService.processSubscriptionTweets(subscription);
        totalNewTweets += newTweetsCount;

        // Add small delay between subscriptions
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error: any) {
        errors.push(`${subscription.targetUsername}: ${error.message}`);
      }
    }

    // Get the newly fetched tweets for summarization
    const recentPosts = await Post.find({
      userId: new mongoose.Types.ObjectId(userId),
      createdAt: { $gte: new Date(Date.now() - 10 * 60 * 1000) } // Last 10 minutes
    })
    .sort({ tweetCreatedAt: -1 })
    .limit(20)
    .lean();

    let aiSummary = null;
    if (recentPosts.length > 0) {
      try {
        aiSummary = await AISummarizationService.quickSummarize(recentPosts, userId);
      } catch (summaryError: any) {
        logger.error('AI summary failed during refresh:', summaryError);
      }
    }

    await logActivity(userId, 'refresh_and_summarize', {
      subscriptionsProcessed: subscriptions.length,
      totalNewTweets,
      errorCount: errors.length,
      aiSummaryGenerated: !!aiSummary
    }, req);

    res.json({
      success: true,
      message: `Refresh completed. ${totalNewTweets} new tweets found.`,
      stats: {
        subscriptionsProcessed: subscriptions.length,
        newTweets: totalNewTweets,
        errors: errors.length > 0 ? errors : undefined
      },
      aiSummary: aiSummary || 'No new tweets to summarize',
      timestamp: new Date()
    });

  } catch (error: any) {
    logger.error('Refresh and summarize error:', error);
    res.status(500).json({ error: 'Failed to refresh and summarize' });
  }
});

// AI service health check
app.get('/api/ai/health', authenticateToken, async (req: AuthRequest, res) => {
  try {
    // Test with a simple summarization request
    const testTweets = [{
      content: 'This is a test tweet to verify AI service connectivity.',
      authorUsername: 'test',
      engagement: { likes: 0, retweets: 0, replies: 0, quotes: 0 },
      tweetCreatedAt: new Date()
    }];

    const result = await AISummarizationService.quickSummarize(testTweets, req.user!.userId);

    res.json({
      status: 'healthy',
      aiService: 'openrouter',
      testSummary: result.substring(0, 100),
      timestamp: new Date()
    });

  } catch (error: any) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      suggestion: 'Check OPENROUTER_API_KEY configuration'
    });
  }
});

// Background job to process all subscriptions
cron.schedule('*/30 * * * *', async () => {
  logger.info('Starting scheduled subscription processing...');
  
  try {
    const activeUsers = await User.find({
      isActive: true,
      twitterCredentials: { $exists: true }
    }).select('_id');

    let totalProcessed = 0;
    let totalNewTweets = 0;
    const errors: string[] = [];

    for (const user of activeUsers) {
      try {
        const twitterService = await TwitterService.createForUser(user._id as mongoose.Types.ObjectId);
        if (twitterService) {
          const result = await twitterService.processAllUserSubscriptions(user._id as mongoose.Types.ObjectId);
          totalProcessed += result.processed;
          totalNewTweets += result.newTweets;
          errors.push(...result.errors);
        }

        // Add delay between users to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error: any) {
        logger.error(`Error processing user ${user._id}:`, error);
        errors.push(`User ${user._id}: ${error.message}`);
      }
    }

    await logActivity('system', 'posts_fetched', {
      totalUsers: activeUsers.length,
      totalProcessed,
      totalNewTweets,
      errorCount: errors.length
    });

    logger.info(`Scheduled processing completed: ${totalProcessed} subscriptions processed, ${totalNewTweets} new tweets found`);

  } catch (error) {
    logger.error('Scheduled processing error:', error);
  }
});

// Error handling middleware
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Database connection and server startup
async function startServer() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI!, {
      retryWrites: true,
      w: 'majority'
    });
    
    logger.info('Connected to MongoDB');

    // Start server
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
      logger.info(`Twitter Agent Backend running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  await mongoose.connection.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  await mongoose.connection.close();
  process.exit(0);
});

startServer();