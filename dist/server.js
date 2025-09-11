"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const mongoose_1 = __importDefault(require("mongoose"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const compression_1 = __importDefault(require("compression"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const node_cron_1 = __importDefault(require("node-cron"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const express_validator_1 = require("express-validator");
const dotenv_1 = __importDefault(require("dotenv"));
const models_1 = require("./models");
const twitter_service_1 = require("./twitter-service");
const ai_summarization_1 = __importDefault(require("./services/ai-summarization"));
const logger_1 = __importDefault(require("./utils/logger"));
// Load environment variables
dotenv_1.default.config();
const app = (0, express_1.default)();
// Security middleware
app.use((0, helmet_1.default)());
app.use((0, compression_1.default)());
app.use((0, cors_1.default)({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
}));
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
// Rate limiting
const limiter = (0, express_rate_limit_1.default)({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '15') * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
    message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }
    jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err)
            return res.status(403).json({ error: 'Invalid or expired token' });
        req.user = user;
        next();
    });
};
// Validation middleware
const handleValidationErrors = (req, res, next) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: 'Validation failed',
            details: errors.array()
        });
    }
    next();
};
// Activity logging helper
const logActivity = async (userId, action, details, req) => {
    try {
        // Handle system activities that don't have a real user ID
        const userObjectId = userId === 'system' ? null : new mongoose_1.default.Types.ObjectId(userId);
        await models_1.ActivityLog.create({
            userId: userObjectId,
            action,
            details,
            ipAddress: req?.ip,
            userAgent: req?.get('User-Agent')
        });
    }
    catch (error) {
        logger_1.default.error('Failed to log activity:', error);
    }
};
// ROUTES
// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        database: mongoose_1.default.connection.readyState === 1 ? 'connected' : 'disconnected',
        version: process.env.npm_package_version || '1.0.0'
    });
});
// User Registration
app.post('/api/auth/register', (0, express_validator_1.body)('email').isEmail().normalizeEmail(), (0, express_validator_1.body)('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'), handleValidationErrors, async (req, res) => {
    try {
        const { email, password } = req.body;
        // Check if user exists
        const existingUser = await models_1.User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists with this email' });
        }
        // Hash password
        const hashedPassword = await bcrypt_1.default.hash(password, 12);
        // Create user
        const user = new models_1.User({
            email,
            password: hashedPassword,
            isActive: true
        });
        await user.save();
        // Generate JWT
        const token = jsonwebtoken_1.default.sign({ userId: user._id.toString(), email: user.email }, process.env.JWT_SECRET, { expiresIn: '24h' });
        await logActivity(user._id.toString(), 'user_registered', { email }, req);
        res.status(201).json({
            success: true,
            token,
            user: {
                id: user._id,
                email: user.email,
                createdAt: user.createdAt
            }
        });
    }
    catch (error) {
        logger_1.default.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});
// User Login
app.post('/api/auth/login', (0, express_validator_1.body)('email').isEmail().normalizeEmail(), (0, express_validator_1.body)('password').notEmpty(), handleValidationErrors, async (req, res) => {
    try {
        const { email, password } = req.body;
        // Find user
        const user = await models_1.User.findOne({ email, isActive: true });
        if (!user || !await bcrypt_1.default.compare(password, user.password)) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        // Generate JWT
        const token = jsonwebtoken_1.default.sign({ userId: user._id.toString(), email: user.email }, process.env.JWT_SECRET, { expiresIn: '24h' });
        await logActivity(user._id.toString(), 'user_login', { email }, req);
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
    }
    catch (error) {
        logger_1.default.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});
// Setup Twitter credentials
app.post('/api/twitter/setup', authenticateToken, (0, express_validator_1.body)('apiKey').notEmpty(), (0, express_validator_1.body)('apiSecret').notEmpty(), (0, express_validator_1.body)('accessToken').notEmpty(), (0, express_validator_1.body)('accessTokenSecret').notEmpty(), handleValidationErrors, async (req, res) => {
    try {
        const { apiKey, apiSecret, accessToken, accessTokenSecret } = req.body;
        const userId = req.user.userId;
        // Test credentials
        const twitterService = new twitter_service_1.TwitterService({
            apiKey, apiSecret, accessToken, accessTokenSecret
        }, new mongoose_1.default.Types.ObjectId(userId));
        const profile = await twitterService.verifyCredentials();
        // Encrypt and store credentials
        const encryptedCredentials = twitter_service_1.TwitterService.encryptCredentials({
            apiKey, apiSecret, accessToken, accessTokenSecret
        });
        await models_1.User.findByIdAndUpdate(userId, {
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
    }
    catch (error) {
        logger_1.default.error('Twitter setup error:', error);
        res.status(400).json({ error: error.message || 'Failed to setup Twitter credentials' });
    }
});
// Create subscription
app.post('/api/subscriptions', authenticateToken, (0, express_validator_1.body)('targetUsername').notEmpty().trim().toLowerCase(), (0, express_validator_1.body)('checkInterval').optional().isInt({ min: 15, max: 1440 }), (0, express_validator_1.body)('keywords').optional().isArray(), (0, express_validator_1.body)('includeReplies').optional().isBoolean(), (0, express_validator_1.body)('includeRetweets').optional().isBoolean(), handleValidationErrors, async (req, res) => {
    try {
        const { targetUsername, checkInterval = 60, keywords = [], includeReplies = false, includeRetweets = false } = req.body;
        const userId = req.user.userId;
        // Check if Twitter is setup
        const user = await models_1.User.findById(userId);
        if (!user?.twitterCredentials) {
            return res.status(400).json({ error: 'Twitter credentials not setup' });
        }
        // Verify target user exists
        const twitterService = await twitter_service_1.TwitterService.createForUser(new mongoose_1.default.Types.ObjectId(userId));
        if (!twitterService) {
            return res.status(400).json({ error: 'Failed to initialize Twitter service' });
        }
        const targetUser = await twitterService.getUserByUsername(targetUsername);
        // Check if subscription already exists
        const existingSub = await models_1.Subscription.findOne({
            userId: new mongoose_1.default.Types.ObjectId(userId),
            targetUsername
        });
        if (existingSub) {
            if (existingSub.isActive) {
                return res.status(400).json({ error: 'Already subscribed to this user' });
            }
            else {
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
        const subscription = new models_1.Subscription({
            userId: new mongoose_1.default.Types.ObjectId(userId),
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
    }
    catch (error) {
        logger_1.default.error('Subscription creation error:', error);
        res.status(500).json({ error: error.message || 'Failed to create subscription' });
    }
});
// Get user subscriptions
app.get('/api/subscriptions', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const subscriptions = await models_1.Subscription.aggregate(models_1.aggregationPipelines.getSubscriptionStats(new mongoose_1.default.Types.ObjectId(userId)));
        res.json({ subscriptions });
    }
    catch (error) {
        logger_1.default.error('Get subscriptions error:', error);
        res.status(500).json({ error: 'Failed to fetch subscriptions' });
    }
});
// Get updates
app.get('/api/updates', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const since = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 24 * 60 * 60 * 1000);
        const limit = parseInt(req.query.limit) || 50;
        const unreadOnly = req.query.unreadOnly === 'true';
        const query = {
            userId: new mongoose_1.default.Types.ObjectId(userId),
            tweetCreatedAt: { $gte: since }
        };
        if (unreadOnly) {
            query.isRead = false;
        }
        const posts = await models_1.Post.find(query)
            .populate('subscriptionId', 'targetUsername')
            .sort({ tweetCreatedAt: -1 })
            .limit(limit)
            .lean();
        await logActivity(userId, 'updates_viewed', { count: posts.length, since }, req);
        res.json({
            posts,
            count: posts.length,
            unreadCount: unreadOnly ? posts.length : await models_1.Post.countDocuments({
                userId: new mongoose_1.default.Types.ObjectId(userId),
                isRead: false
            })
        });
    }
    catch (error) {
        logger_1.default.error('Get updates error:', error);
        res.status(500).json({ error: 'Failed to fetch updates' });
    }
});
// Manual refresh subscription
app.post('/api/subscriptions/:id/refresh', authenticateToken, async (req, res) => {
    try {
        const subscriptionId = req.params.id;
        const userId = req.user.userId;
        const subscription = await models_1.Subscription.findOne({
            _id: subscriptionId,
            userId: new mongoose_1.default.Types.ObjectId(userId)
        });
        if (!subscription) {
            return res.status(404).json({ error: 'Subscription not found' });
        }
        const twitterService = await twitter_service_1.TwitterService.createForUser(new mongoose_1.default.Types.ObjectId(userId));
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
    }
    catch (error) {
        logger_1.default.error('Subscription refresh error:', error);
        res.status(500).json({ error: error.message || 'Failed to refresh subscription' });
    }
});
// Delete subscription
app.delete('/api/subscriptions/:id', authenticateToken, async (req, res) => {
    try {
        const subscriptionId = req.params.id;
        const userId = req.user.userId;
        const subscription = await models_1.Subscription.findOneAndUpdate({ _id: subscriptionId, userId: new mongoose_1.default.Types.ObjectId(userId) }, { isActive: false }, { new: true });
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
    }
    catch (error) {
        logger_1.default.error('Delete subscription error:', error);
        res.status(500).json({ error: 'Failed to delete subscription' });
    }
});
// Mark posts as read
app.post('/api/posts/mark-read', authenticateToken, async (req, res) => {
    try {
        const { postIds } = req.body;
        const userId = req.user.userId;
        if (!Array.isArray(postIds)) {
            return res.status(400).json({ error: 'postIds must be an array' });
        }
        const result = await models_1.Post.updateMany({
            _id: { $in: postIds.map(id => new mongoose_1.default.Types.ObjectId(id)) },
            userId: new mongoose_1.default.Types.ObjectId(userId)
        }, { isRead: true });
        res.json({
            success: true,
            updatedCount: result.modifiedCount
        });
    }
    catch (error) {
        logger_1.default.error('Mark posts as read error:', error);
        res.status(500).json({ error: 'Failed to mark posts as read' });
    }
});
// Get user analytics
app.get('/api/analytics', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const days = parseInt(req.query.days) || 30;
        const [subscriptionStats, engagementSummary, trendingHashtags] = await Promise.all([
            models_1.Subscription.aggregate(models_1.aggregationPipelines.getSubscriptionStats(new mongoose_1.default.Types.ObjectId(userId))),
            models_1.Post.aggregate(models_1.aggregationPipelines.getEngagementSummary(new mongoose_1.default.Types.ObjectId(userId), days)),
            models_1.Post.aggregate(models_1.aggregationPipelines.getTrendingHashtags(new mongoose_1.default.Types.ObjectId(userId), days))
        ]);
        res.json({
            subscriptionStats,
            engagementSummary: engagementSummary[0] || {},
            trendingHashtags,
            period: `${days} days`
        });
    }
    catch (error) {
        logger_1.default.error('Analytics error:', error);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});
// AI SUMMARIZATION ENDPOINTS
// Get AI-summarized updates
app.get('/api/updates/summarized', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const since = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 24 * 60 * 60 * 1000);
        const analysisType = req.query.type || 'quick'; // quick, detailed, insights
        const limit = parseInt(req.query.limit) || 20;
        // Get posts from subscriptions
        const posts = await models_1.Post.find({
            userId: new mongoose_1.default.Types.ObjectId(userId),
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
        const analysis = await ai_summarization_1.default.summarizeTweets(posts, {
            userId,
            analysisType: analysisType
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
            insights: analysis.insights,
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
    }
    catch (error) {
        logger_1.default.error('AI summarization error:', error);
        res.status(500).json({
            error: error.message || 'Failed to generate AI summary',
            fallback: 'Try using the regular /api/updates endpoint'
        });
    }
});
// Quick summary endpoint (optimized for speed)
app.get('/api/updates/quick-summary', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const since = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 24 * 60 * 60 * 1000);
        // Get only recent posts (limit to 10 for quick processing)
        const posts = await models_1.Post.find({
            userId: new mongoose_1.default.Types.ObjectId(userId),
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
        const summary = await ai_summarization_1.default.quickSummarize(posts, userId);
        await logActivity(userId, 'quick_summary_generated', { postCount: posts.length }, req);
        res.json({
            summary,
            count: posts.length,
            lastUpdated: new Date(),
            type: 'quick'
        });
    }
    catch (error) {
        logger_1.default.error('Quick summary error:', error);
        res.status(500).json({ error: 'Failed to generate quick summary' });
    }
});
// Detailed analysis endpoint
app.get('/api/updates/detailed-analysis', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const days = parseInt(req.query.days) || 1;
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        // Get more posts for detailed analysis
        const posts = await models_1.Post.find({
            userId: new mongoose_1.default.Types.ObjectId(userId),
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
        const analysis = await ai_summarization_1.default.detailedAnalysis(posts, userId);
        // Get additional stats
        const subscriptionStats = await models_1.Subscription.aggregate([
            { $match: { userId: new mongoose_1.default.Types.ObjectId(userId), isActive: true } },
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
                        $avg: {
                            $add: [
                                '$recentPosts.engagement.likes',
                                '$recentPosts.engagement.retweets'
                            ]
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
            insights: analysis.insights,
            stats: {
                totalPosts: posts.length,
                daysCovered: days,
                subscriptionBreakdown: subscriptionStats,
                tokensUsed: analysis.tokensUsed
            },
            generatedAt: new Date(),
            type: 'detailed'
        });
    }
    catch (error) {
        logger_1.default.error('Detailed analysis error:', error);
        res.status(500).json({ error: 'Failed to generate detailed analysis' });
    }
});
// Refresh and summarize endpoint (combines refresh with AI summary)
app.post('/api/subscriptions/refresh-and-summarize', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        // Get all active subscriptions
        const subscriptions = await models_1.Subscription.find({
            userId: new mongoose_1.default.Types.ObjectId(userId),
            isActive: true
        });
        if (subscriptions.length === 0) {
            return res.status(400).json({ error: 'No active subscriptions found' });
        }
        // Refresh all subscriptions
        let totalNewTweets = 0;
        const errors = [];
        const twitterService = await twitter_service_1.TwitterService.createForUser(new mongoose_1.default.Types.ObjectId(userId));
        if (!twitterService) {
            return res.status(400).json({ error: 'Twitter service unavailable' });
        }
        for (const subscription of subscriptions) {
            try {
                const newTweetsCount = await twitterService.processSubscriptionTweets(subscription);
                totalNewTweets += newTweetsCount;
                // Add small delay between subscriptions
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            catch (error) {
                errors.push(`${subscription.targetUsername}: ${error.message}`);
            }
        }
        // Get the newly fetched tweets for summarization
        const recentPosts = await models_1.Post.find({
            userId: new mongoose_1.default.Types.ObjectId(userId),
            createdAt: { $gte: new Date(Date.now() - 10 * 60 * 1000) } // Last 10 minutes
        })
            .sort({ tweetCreatedAt: -1 })
            .limit(20)
            .lean();
        let aiSummary = null;
        if (recentPosts.length > 0) {
            try {
                aiSummary = await ai_summarization_1.default.quickSummarize(recentPosts, userId);
            }
            catch (summaryError) {
                logger_1.default.error('AI summary failed during refresh:', summaryError);
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
    }
    catch (error) {
        logger_1.default.error('Refresh and summarize error:', error);
        res.status(500).json({ error: 'Failed to refresh and summarize' });
    }
});
// AI service health check
app.get('/api/ai/health', authenticateToken, async (req, res) => {
    try {
        // Test with a simple summarization request
        const testTweets = [{
                content: 'This is a test tweet to verify AI service connectivity.',
                authorUsername: 'test',
                engagement: { likes: 0, retweets: 0, replies: 0, quotes: 0 },
                tweetCreatedAt: new Date()
            }];
        const result = await ai_summarization_1.default.quickSummarize(testTweets, req.user.userId);
        res.json({
            status: 'healthy',
            aiService: 'openrouter',
            testSummary: result.substring(0, 100),
            timestamp: new Date()
        });
    }
    catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message,
            suggestion: 'Check OPENROUTER_API_KEY configuration'
        });
    }
});
// Background job to process all subscriptions
node_cron_1.default.schedule('*/30 * * * *', async () => {
    logger_1.default.info('Starting scheduled subscription processing...');
    try {
        const activeUsers = await models_1.User.find({
            isActive: true,
            twitterCredentials: { $exists: true }
        }).select('_id');
        let totalProcessed = 0;
        let totalNewTweets = 0;
        const errors = [];
        for (const user of activeUsers) {
            try {
                const twitterService = await twitter_service_1.TwitterService.createForUser(user._id);
                if (twitterService) {
                    const result = await twitterService.processAllUserSubscriptions(user._id);
                    totalProcessed += result.processed;
                    totalNewTweets += result.newTweets;
                    errors.push(...result.errors);
                }
                // Add delay between users to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            catch (error) {
                logger_1.default.error(`Error processing user ${user._id}:`, error);
                errors.push(`User ${user._id}: ${error.message}`);
            }
        }
        await logActivity('system', 'posts_fetched', {
            totalUsers: activeUsers.length,
            totalProcessed,
            totalNewTweets,
            errorCount: errors.length
        });
        logger_1.default.info(`Scheduled processing completed: ${totalProcessed} subscriptions processed, ${totalNewTweets} new tweets found`);
    }
    catch (error) {
        logger_1.default.error('Scheduled processing error:', error);
    }
});
// Error handling middleware
app.use((error, req, res, next) => {
    logger_1.default.error('Unhandled error:', error);
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
        await mongoose_1.default.connect(process.env.MONGODB_URI, {
            retryWrites: true,
            w: 'majority'
        });
        logger_1.default.info('Connected to MongoDB');
        // Start server
        const PORT = process.env.PORT || 3001;
        app.listen(PORT, () => {
            logger_1.default.info(`Twitter Agent Backend running on port ${PORT}`);
            logger_1.default.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
        });
    }
    catch (error) {
        logger_1.default.error('Failed to start server:', error);
        process.exit(1);
    }
}
// Handle graceful shutdown
process.on('SIGTERM', async () => {
    logger_1.default.info('Received SIGTERM, shutting down gracefully...');
    await mongoose_1.default.connection.close();
    process.exit(0);
});
process.on('SIGINT', async () => {
    logger_1.default.info('Received SIGINT, shutting down gracefully...');
    await mongoose_1.default.connection.close();
    process.exit(0);
});
startServer();
//# sourceMappingURL=server.js.map