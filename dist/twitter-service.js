"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TwitterService = void 0;
const twitter_api_v2_1 = require("twitter-api-v2");
const crypto_js_1 = __importDefault(require("crypto-js"));
const models_1 = require("./models");
const logger_1 = __importDefault(require("./utils/logger"));
class TwitterService {
    constructor(credentials, userId) {
        this.client = new twitter_api_v2_1.TwitterApi({
            appKey: credentials.apiKey,
            appSecret: credentials.apiSecret,
            accessToken: credentials.accessToken,
            accessSecret: credentials.accessTokenSecret,
        });
        this.encryptionKey = process.env.ENCRYPTION_KEY || 'default-encryption-key';
        this.userId = userId;
    }
    // Encrypt sensitive data before storing
    static encryptCredentials(credentials) {
        const encryptionKey = process.env.ENCRYPTION_KEY || 'default-encryption-key';
        return {
            apiKey: crypto_js_1.default.AES.encrypt(credentials.apiKey, encryptionKey).toString(),
            apiSecret: crypto_js_1.default.AES.encrypt(credentials.apiSecret, encryptionKey).toString(),
            accessToken: crypto_js_1.default.AES.encrypt(credentials.accessToken, encryptionKey).toString(),
            accessTokenSecret: crypto_js_1.default.AES.encrypt(credentials.accessTokenSecret, encryptionKey).toString(),
        };
    }
    // Decrypt credentials when retrieving
    static decryptCredentials(encryptedData) {
        const encryptionKey = process.env.ENCRYPTION_KEY || 'default-encryption-key';
        // Validate that encrypted data exists and has the required fields
        if (!encryptedData || typeof encryptedData !== 'object') {
            throw new Error('Invalid encrypted credentials data');
        }
        const requiredFields = ['apiKey', 'apiSecret', 'accessToken', 'accessTokenSecret'];
        for (const field of requiredFields) {
            if (!encryptedData[field]) {
                throw new Error(`Missing encrypted field: ${field}`);
            }
        }
        try {
            return {
                apiKey: crypto_js_1.default.AES.decrypt(encryptedData.apiKey, encryptionKey).toString(crypto_js_1.default.enc.Utf8),
                apiSecret: crypto_js_1.default.AES.decrypt(encryptedData.apiSecret, encryptionKey).toString(crypto_js_1.default.enc.Utf8),
                accessToken: crypto_js_1.default.AES.decrypt(encryptedData.accessToken, encryptionKey).toString(crypto_js_1.default.enc.Utf8),
                accessTokenSecret: crypto_js_1.default.AES.decrypt(encryptedData.accessTokenSecret, encryptionKey).toString(crypto_js_1.default.enc.Utf8),
            };
        }
        catch (error) {
            throw new Error(`Failed to decrypt credentials: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    // Verify Twitter credentials are valid
    async verifyCredentials() {
        try {
            const user = await this.client.v2.me();
            return user.data;
        }
        catch (error) {
            throw new Error(`Invalid Twitter credentials: ${error.message}`);
        }
    }
    // Get user by username
    async getUserByUsername(username) {
        try {
            const user = await this.client.v2.userByUsername(username, {
                'user.fields': ['public_metrics', 'verified', 'profile_image_url', 'description']
            });
            return user.data;
        }
        catch (error) {
            throw new Error(`User @${username} not found: ${error.message}`);
        }
    }
    // Get user tweets with advanced filtering
    async getUserTweets(userId, options = {}) {
        try {
            const { sinceTime, maxResults = 2, includeReplies = false, includeRetweets = false, keywords = [] } = options;
            const excludeTypes = [];
            if (!includeReplies)
                excludeTypes.push('replies');
            if (!includeRetweets)
                excludeTypes.push('retweets');
            const params = {
                max_results: Math.min(maxResults, 2), // Twitter API limit
                exclude: excludeTypes,
                'tweet.fields': [
                    'created_at',
                    'public_metrics',
                    'attachments',
                    'entities',
                    'referenced_tweets'
                ].join(','),
                'media.fields': ['url', 'preview_image_url'].join(','),
                expansions: ['attachments.media_keys', 'author_id'].join(',')
            };
            if (sinceTime) {
                params.start_time = sinceTime.toISOString();
            }
            const response = await this.client.v2.userTimeline(userId, params);
            if (!response.data?.data || response.data.data.length === 0) {
                return [];
            }
            // Filter by keywords if provided
            let filteredTweets = response.data.data;
            if (keywords.length > 0) {
                const keywordRegex = new RegExp(keywords.join('|'), 'i');
                filteredTweets = response.data.data.filter((tweet) => keywordRegex.test(tweet.text));
            }
            return filteredTweets.map((tweet) => ({
                id: tweet.id,
                text: tweet.text,
                author_id: tweet.author_id,
                created_at: tweet.created_at,
                public_metrics: tweet.public_metrics,
                attachments: tweet.attachments,
                entities: tweet.entities,
                referenced_tweets: tweet.referenced_tweets
            }));
        }
        catch (error) {
            if (error.code === 429) {
                throw new Error('Rate limit exceeded. Please try again later.');
            }
            throw new Error(`Failed to fetch tweets: ${error.message}`);
        }
    }
    // Process and store tweets from a subscription
    async processSubscriptionTweets(subscription) {
        try {
            logger_1.default.info(`Processing tweets for subscription: ${subscription.targetUsername}`);
            // Get target user info
            const targetUser = await this.getUserByUsername(subscription.targetUsername);
            // Fetch tweets since last check
            const tweets = await this.getUserTweets(targetUser.id, {
                sinceTime: subscription.lastChecked,
                maxResults: 2,
                includeReplies: subscription.includeReplies,
                includeRetweets: subscription.includeRetweets,
                keywords: subscription.keywords
            });
            let newTweetsCount = 0;
            for (const tweet of tweets) {
                // Check if tweet already exists
                const existingPost = await models_1.Post.findOne({ tweetId: tweet.id });
                if (existingPost)
                    continue;
                // Extract hashtags and mentions
                const hashtags = tweet.entities?.hashtags?.map(h => h.tag) || [];
                const mentions = tweet.entities?.mentions?.map(m => m.username) || [];
                const mediaUrls = this.extractMediaUrls(tweet);
                // Determine if it's a reply or retweet
                const isReply = tweet.referenced_tweets?.some(ref => ref.type === 'replied_to') || false;
                const isRetweet = tweet.referenced_tweets?.some(ref => ref.type === 'retweeted') || false;
                const retweetedFrom = isRetweet
                    ? tweet.referenced_tweets?.find(ref => ref.type === 'retweeted')?.id
                    : undefined;
                // Create new post
                const post = new models_1.Post({
                    tweetId: tweet.id,
                    subscriptionId: subscription._id,
                    userId: subscription.userId,
                    content: tweet.text,
                    authorUsername: subscription.targetUsername,
                    authorName: targetUser.name,
                    authorAvatar: targetUser.profile_image_url,
                    engagement: {
                        likes: tweet.public_metrics.like_count,
                        retweets: tweet.public_metrics.retweet_count,
                        replies: tweet.public_metrics.reply_count,
                        quotes: tweet.public_metrics.quote_count || 0
                    },
                    mediaUrls,
                    tweetCreatedAt: new Date(tweet.created_at),
                    tweetUrl: this.formatTweetUrl(subscription.targetUsername, tweet.id),
                    isReply,
                    isRetweet,
                    retweetedFrom,
                    hashtags,
                    mentions,
                    isRead: false
                });
                await post.save();
                newTweetsCount++;
            }
            // Update subscription last checked time
            await models_1.Subscription.findByIdAndUpdate(subscription._id, {
                lastChecked: new Date()
            });
            logger_1.default.info(`Processed ${newTweetsCount} new tweets for ${subscription.targetUsername}`);
            return newTweetsCount;
        }
        catch (error) {
            logger_1.default.error(`Error processing subscription ${subscription.targetUsername}:`, error);
            throw error;
        }
    }
    // Process all active subscriptions for a user
    async processAllUserSubscriptions(userId) {
        const subscriptions = await models_1.Subscription.find({
            userId,
            isActive: true
        });
        let processed = 0;
        let newTweets = 0;
        const errors = [];
        for (const subscription of subscriptions) {
            try {
                // Check if it's time to update this subscription
                const timeSinceLastCheck = Date.now() - subscription.lastChecked.getTime();
                const checkIntervalMs = subscription.checkInterval * 60 * 1000;
                if (timeSinceLastCheck >= checkIntervalMs) {
                    const count = await this.processSubscriptionTweets(subscription);
                    newTweets += count;
                    processed++;
                    // Add small delay to avoid rate limiting
                    await this.delay(1000);
                }
            }
            catch (error) {
                errors.push(`${subscription.targetUsername}: ${error.message}`);
            }
        }
        return { processed, newTweets, errors };
    }
    // Get tweet details by ID
    async getTweetById(tweetId) {
        try {
            const response = await this.client.v2.singleTweet(tweetId, {
                'tweet.fields': [
                    'created_at',
                    'public_metrics',
                    'author_id',
                    'attachments',
                    'entities'
                ].join(',')
            });
            if (!response.data)
                return null;
            const tweet = response.data;
            return {
                id: tweet.id,
                text: tweet.text,
                author_id: tweet.author_id,
                created_at: tweet.created_at,
                public_metrics: tweet.public_metrics,
                attachments: tweet.attachments,
                entities: tweet.entities
            };
        }
        catch (error) {
            logger_1.default.error(`Failed to fetch tweet ${tweetId}:`, error);
            return null;
        }
    }
    // Check rate limit status
    async getRateLimitStatus() {
        try {
            return await this.client.v1.get('application/rate_limit_status.json');
        }
        catch (error) {
            logger_1.default.error('Failed to get rate limit status:', error);
            return null;
        }
    }
    // Extract media URLs from tweet
    extractMediaUrls(tweet) {
        const mediaUrls = [];
        if (tweet.entities?.urls) {
            for (const url of tweet.entities.urls) {
                if (url.expanded_url.includes('pic.twitter.com') ||
                    url.expanded_url.includes('video.twitter.com')) {
                    mediaUrls.push(url.expanded_url);
                }
            }
        }
        return mediaUrls;
    }
    // Format tweet URL
    formatTweetUrl(username, tweetId) {
        return `https://twitter.com/${username}/status/${tweetId}`;
    }
    // Utility function to add delay
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    // Clean tweet text (remove URLs, normalize whitespace)
    static cleanTweetText(text) {
        return text
            .replace(/https?:\/\/\S+/g, '') // Remove URLs
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
    }
    // Create Twitter service instance for user
    static async createForUser(userId) {
        try {
            const user = await models_1.User.findById(userId);
            if (!user || !user.twitterCredentials) {
                return null;
            }
            const credentials = TwitterService.decryptCredentials(user.twitterCredentials);
            return new TwitterService(credentials, userId);
        }
        catch (error) {
            logger_1.default.error(`Failed to create Twitter service for user ${userId}:`, error);
            return null;
        }
    }
}
exports.TwitterService = TwitterService;
//# sourceMappingURL=twitter-service.js.map