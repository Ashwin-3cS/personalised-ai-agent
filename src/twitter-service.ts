import { TwitterApi, TweetV2, UserV2 } from 'twitter-api-v2';
import CryptoJS from 'crypto-js';
import mongoose from 'mongoose';
import { User, Subscription, Post, IUser, ISubscription, IPost } from './models';
import logger from './utils/logger';

export interface TwitterCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

export interface TweetData {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  public_metrics: {
    retweet_count: number;
    like_count: number;
    reply_count: number;
    quote_count: number;
  };
  attachments?: {
    media_keys?: string[];
  };
  entities?: {
    urls?: Array<{
      expanded_url: string;
      display_url: string;
    }>;
    hashtags?: Array<{
      tag: string;
    }>;
    mentions?: Array<{
      username: string;
    }>;
  };
  referenced_tweets?: Array<{
    type: string;
    id: string;
  }>;
}

export class TwitterService {
  private client: TwitterApi;
  private readonly encryptionKey: string;
  private userId: mongoose.Types.ObjectId;

  constructor(credentials: TwitterCredentials, userId: mongoose.Types.ObjectId) {
    this.client = new TwitterApi({
      appKey: credentials.apiKey,
      appSecret: credentials.apiSecret,
      accessToken: credentials.accessToken,
      accessSecret: credentials.accessTokenSecret,
    });
    
    this.encryptionKey = process.env.ENCRYPTION_KEY || 'default-encryption-key';
    this.userId = userId;
  }

  // Encrypt sensitive data before storing
  static encryptCredentials(credentials: TwitterCredentials): any {
    const encryptionKey = process.env.ENCRYPTION_KEY || 'default-encryption-key';
    return {
      apiKey: CryptoJS.AES.encrypt(credentials.apiKey, encryptionKey).toString(),
      apiSecret: CryptoJS.AES.encrypt(credentials.apiSecret, encryptionKey).toString(),
      accessToken: CryptoJS.AES.encrypt(credentials.accessToken, encryptionKey).toString(),
      accessTokenSecret: CryptoJS.AES.encrypt(credentials.accessTokenSecret, encryptionKey).toString(),
    };
  }

  // Decrypt credentials when retrieving
  static decryptCredentials(encryptedData: any): TwitterCredentials {
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
        apiKey: CryptoJS.AES.decrypt(encryptedData.apiKey, encryptionKey).toString(CryptoJS.enc.Utf8),
        apiSecret: CryptoJS.AES.decrypt(encryptedData.apiSecret, encryptionKey).toString(CryptoJS.enc.Utf8),
        accessToken: CryptoJS.AES.decrypt(encryptedData.accessToken, encryptionKey).toString(CryptoJS.enc.Utf8),
        accessTokenSecret: CryptoJS.AES.decrypt(encryptedData.accessTokenSecret, encryptionKey).toString(CryptoJS.enc.Utf8),
      };
    } catch (error) {
      throw new Error(`Failed to decrypt credentials: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Verify Twitter credentials are valid
  async verifyCredentials(): Promise<UserV2> {
    try {
      const user = await this.client.v2.me();
      return user.data;
    } catch (error: any) {
      throw new Error(`Invalid Twitter credentials: ${error.message}`);
    }
  }

  // Get user by username
  async getUserByUsername(username: string): Promise<UserV2> {
    try {
      const user = await this.client.v2.userByUsername(username, {
        'user.fields': ['public_metrics', 'verified', 'profile_image_url', 'description']
      });
      return user.data;
    } catch (error: any) {
      throw new Error(`User @${username} not found: ${error.message}`);
    }
  }

  // Get user tweets with advanced filtering
  async getUserTweets(
    userId: string,
    options: {
      sinceTime?: Date;
      maxResults?: number;
      includeReplies?: boolean;
      includeRetweets?: boolean;
      keywords?: string[];
    } = {}
  ): Promise<TweetData[]> {
    try {
      const {
        sinceTime,
        maxResults = 10,
        includeReplies = false,
        includeRetweets = false,
        keywords = []
      } = options;

      const excludeTypes: string[] = [];
      if (!includeReplies) excludeTypes.push('replies');
      if (!includeRetweets) excludeTypes.push('retweets');

      const params: any = {
        max_results: Math.min(maxResults, 100), // Twitter API limit
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
        filteredTweets = response.data.data.filter((tweet: TweetV2) => 
          keywordRegex.test(tweet.text)
        );
      }

      return filteredTweets.map((tweet: TweetV2) => ({
        id: tweet.id,
        text: tweet.text,
        author_id: tweet.author_id!,
        created_at: tweet.created_at!,
        public_metrics: tweet.public_metrics!,
        attachments: tweet.attachments,
        entities: tweet.entities,
        referenced_tweets: tweet.referenced_tweets
      }));

    } catch (error: any) {
      if (error.code === 429) {
        throw new Error('Rate limit exceeded. Please try again later.');
      }
      throw new Error(`Failed to fetch tweets: ${error.message}`);
    }
  }

  // Process and store tweets from a subscription
  async processSubscriptionTweets(subscription: ISubscription): Promise<number> {
    try {
      logger.info(`Processing tweets for subscription: ${subscription.targetUsername}`);

      // Get target user info
      const targetUser = await this.getUserByUsername(subscription.targetUsername);
      
      // Fetch tweets since last check
      const tweets = await this.getUserTweets(targetUser.id, {
        sinceTime: subscription.lastChecked,
        maxResults: 50,
        includeReplies: subscription.includeReplies,
        includeRetweets: subscription.includeRetweets,
        keywords: subscription.keywords
      });

      let newTweetsCount = 0;

      for (const tweet of tweets) {
        // Check if tweet already exists
        const existingPost = await Post.findOne({ tweetId: tweet.id });
        if (existingPost) continue;

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
        const post = new Post({
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
      await Subscription.findByIdAndUpdate(subscription._id, {
        lastChecked: new Date()
      });

      logger.info(`Processed ${newTweetsCount} new tweets for ${subscription.targetUsername}`);
      return newTweetsCount;

    } catch (error: any) {
      logger.error(`Error processing subscription ${subscription.targetUsername}:`, error);
      throw error;
    }
  }

  // Process all active subscriptions for a user
  async processAllUserSubscriptions(userId: mongoose.Types.ObjectId): Promise<{
    processed: number;
    newTweets: number;
    errors: string[];
  }> {
    const subscriptions = await Subscription.find({
      userId,
      isActive: true
    });

    let processed = 0;
    let newTweets = 0;
    const errors: string[] = [];

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
      } catch (error: any) {
        errors.push(`${subscription.targetUsername}: ${error.message}`);
      }
    }

    return { processed, newTweets, errors };
  }

  // Get tweet details by ID
  async getTweetById(tweetId: string): Promise<TweetData | null> {
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

      if (!response.data) return null;

      const tweet = response.data;
      return {
        id: tweet.id,
        text: tweet.text,
        author_id: tweet.author_id!,
        created_at: tweet.created_at!,
        public_metrics: tweet.public_metrics!,
        attachments: tweet.attachments,
        entities: tweet.entities
      };

    } catch (error) {
      logger.error(`Failed to fetch tweet ${tweetId}:`, error);
      return null;
    }
  }

  // Check rate limit status
  async getRateLimitStatus(): Promise<any> {
    try {
      return await this.client.v1.get('application/rate_limit_status.json');
    } catch (error) {
      logger.error('Failed to get rate limit status:', error);
      return null;
    }
  }

  // Extract media URLs from tweet
  private extractMediaUrls(tweet: TweetData): string[] {
    const mediaUrls: string[] = [];
    
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
  private formatTweetUrl(username: string, tweetId: string): string {
    return `https://twitter.com/${username}/status/${tweetId}`;
  }

  // Utility function to add delay
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Clean tweet text (remove URLs, normalize whitespace)
  static cleanTweetText(text: string): string {
    return text
      .replace(/https?:\/\/\S+/g, '') // Remove URLs
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  // Create Twitter service instance for user
  static async createForUser(userId: mongoose.Types.ObjectId): Promise<TwitterService | null> {
    try {
      const user = await User.findById(userId);
      if (!user || !user.twitterCredentials) {
        return null;
      }

      const credentials = TwitterService.decryptCredentials(user.twitterCredentials);
      return new TwitterService(credentials, userId);
    } catch (error) {
      logger.error(`Failed to create Twitter service for user ${userId}:`, error);
      return null;
    }
  }
}