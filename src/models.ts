import mongoose, { Document, Schema } from 'mongoose';

// User Interface and Schema
export interface IUser extends Document {
  email: string;
  password: string;
  isActive: boolean;
  twitterUsername?: string;
  twitterCredentials?: {
    apiKey: string;
    apiSecret: string;
    accessToken: string;
    accessTokenSecret: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  isActive: {
    type: Boolean,
    default: true
  },
  twitterUsername: {
    type: String,
    trim: true,
    lowercase: true
  },
  twitterCredentials: {
    apiKey: String,
    apiSecret: String,
    accessToken: String,
    accessTokenSecret: String
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      const retObj = ret as any;
      delete retObj.password;
      delete retObj.twitterCredentials;
      return retObj;
    }
  }
});

// Subscription Interface and Schema
export interface ISubscription extends Document {
  userId: mongoose.Types.ObjectId;
  targetUsername: string;
  isActive: boolean;
  checkInterval: number; // in minutes
  lastChecked: Date;
  keywords: string[];
  includeReplies: boolean;
  includeRetweets: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SubscriptionSchema = new Schema<ISubscription>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  targetUsername: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  checkInterval: {
    type: Number,
    default: 60,
    min: 15, // minimum 15 minutes
    max: 1440 // maximum 24 hours
  },
  lastChecked: {
    type: Date,
    default: Date.now
  },
  keywords: [{
    type: String,
    trim: true
  }],
  includeReplies: {
    type: Boolean,
    default: false
  },
  includeRetweets: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Compound index for user and target username
SubscriptionSchema.index({ userId: 1, targetUsername: 1 }, { unique: true });
SubscriptionSchema.index({ isActive: 1, lastChecked: 1 });

// Post Interface and Schema
export interface IPost extends Document {
  tweetId: string;
  subscriptionId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  content: string;
  authorUsername: string;
  authorName?: string;
  authorAvatar?: string;
  engagement: {
    likes: number;
    retweets: number;
    replies: number;
    quotes: number;
  };
  mediaUrls: string[];
  isRead: boolean;
  tweetCreatedAt: Date;
  tweetUrl?: string;
  isReply: boolean;
  isRetweet: boolean;
  retweetedFrom?: string;
  hashtags: string[];
  mentions: string[];
  createdAt: Date;
  updatedAt: Date;
}

const PostSchema = new Schema<IPost>({
  tweetId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  subscriptionId: {
    type: Schema.Types.ObjectId,
    ref: 'Subscription',
    required: true,
    index: true
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  content: {
    type: String,
    required: true,
    maxlength: 5000
  },
  authorUsername: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true
  },
  authorName: String,
  authorAvatar: String,
  engagement: {
    likes: { type: Number, default: 0 },
    retweets: { type: Number, default: 0 },
    replies: { type: Number, default: 0 },
    quotes: { type: Number, default: 0 }
  },
  mediaUrls: [String],
  isRead: {
    type: Boolean,
    default: false,
    index: true
  },
  tweetCreatedAt: {
    type: Date,
    required: true,
    index: true
  },
  tweetUrl: String,
  isReply: {
    type: Boolean,
    default: false
  },
  isRetweet: {
    type: Boolean,
    default: false
  },
  retweetedFrom: String,
  hashtags: [String],
  mentions: [String]
}, {
  timestamps: true
});

// Compound indexes for efficient queries
PostSchema.index({ userId: 1, tweetCreatedAt: -1 });
PostSchema.index({ subscriptionId: 1, tweetCreatedAt: -1 });
PostSchema.index({ userId: 1, isRead: 1 });

// Activity Log Interface and Schema
export interface IActivityLog extends Document {
  userId?: mongoose.Types.ObjectId | null;
  action: string;
  details?: any;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
}

const ActivityLogSchema = new Schema<IActivityLog>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: false,
    index: true
  },
  action: {
    type: String,
    required: true,
    enum: [
      'user_registered',
      'user_login',
      'user_logout',
      'twitter_setup',
      'subscription_created',
      'subscription_deleted',
      'posts_fetched',
      'updates_viewed',
      'subscription_refreshed'
    ]
  },
  details: Schema.Types.Mixed,
  ipAddress: String,
  userAgent: String
}, {
  timestamps: { createdAt: true, updatedAt: false }
});

ActivityLogSchema.index({ userId: 1, createdAt: -1 });
ActivityLogSchema.index({ action: 1, createdAt: -1 });

// Notification Preference Interface and Schema
export interface INotificationPreference extends Document {
  userId: mongoose.Types.ObjectId;
  emailNotifications: boolean;
  pushNotifications: boolean;
  dailyDigest: boolean;
  instantAlerts: boolean;
  keywordAlerts: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationPreferenceSchema = new Schema<INotificationPreference>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  emailNotifications: { type: Boolean, default: true },
  pushNotifications: { type: Boolean, default: true },
  dailyDigest: { type: Boolean, default: false },
  instantAlerts: { type: Boolean, default: false },
  keywordAlerts: { type: Boolean, default: false }
}, {
  timestamps: true
});

// Rate Limit Schema for API rate limiting
export interface IRateLimit extends Document {
  identifier: string; // IP address or user ID
  requests: number;
  windowStart: Date;
  createdAt: Date;
  updatedAt: Date;
}

const RateLimitSchema = new Schema<IRateLimit>({
  identifier: {
    type: String,
    required: true,
    index: true
  },
  requests: {
    type: Number,
    default: 1
  },
  windowStart: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// TTL index to automatically remove old rate limit records
RateLimitSchema.index({ createdAt: 1 }, { expireAfterSeconds: 900 }); // 15 minutes

// Export Models
export const User = mongoose.model<IUser>('User', UserSchema);
export const Subscription = mongoose.model<ISubscription>('Subscription', SubscriptionSchema);
export const Post = mongoose.model<IPost>('Post', PostSchema);
export const ActivityLog = mongoose.model<IActivityLog>('ActivityLog', ActivityLogSchema);
export const NotificationPreference = mongoose.model<INotificationPreference>('NotificationPreference', NotificationPreferenceSchema);
export const RateLimit = mongoose.model<IRateLimit>('RateLimit', RateLimitSchema);

// Aggregation pipelines for common queries
export const aggregationPipelines = {
  // Get subscription stats
  getSubscriptionStats: (userId: mongoose.Types.ObjectId) => [
    { $match: { userId, isActive: true } },
    {
      $lookup: {
        from: 'posts',
        localField: '_id',
        foreignField: 'subscriptionId',
        as: 'posts'
      }
    },
    {
      $project: {
        targetUsername: 1,
        checkInterval: 1,
        lastChecked: 1,
        totalPosts: { $size: '$posts' },
        unreadPosts: {
          $size: {
            $filter: {
              input: '$posts',
              cond: { $eq: ['$$this.isRead', false] }
            }
          }
        },
        lastPostDate: { $max: '$posts.tweetCreatedAt' }
      }
    }
  ] as mongoose.PipelineStage[],

  // Get trending hashtags from user's subscriptions
  getTrendingHashtags: (userId: mongoose.Types.ObjectId, days: number = 7) => [
    {
      $match: {
        userId,
        tweetCreatedAt: { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) }
      }
    },
    { $unwind: '$hashtags' },
    {
      $group: {
        _id: '$hashtags',
        count: { $sum: 1 },
        lastSeen: { $max: '$tweetCreatedAt' }
      }
    },
    { $sort: { count: -1 } },
    { $limit: 20 }
  ] as mongoose.PipelineStage[],

  // Get engagement summary
  getEngagementSummary: (userId: mongoose.Types.ObjectId, days: number = 30) => [
    {
      $match: {
        userId,
        tweetCreatedAt: { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) }
      }
    },
    {
      $group: {
        _id: null,
        totalPosts: { $sum: 1 },
        totalLikes: { $sum: '$engagement.likes' },
        totalRetweets: { $sum: '$engagement.retweets' },
        totalReplies: { $sum: '$engagement.replies' },
        avgLikes: { $avg: '$engagement.likes' },
        avgRetweets: { $avg: '$engagement.retweets' },
        mostEngagedPost: { $max: { $add: ['$engagement.likes', '$engagement.retweets'] } }
      }
    }
  ] as mongoose.PipelineStage[]
};