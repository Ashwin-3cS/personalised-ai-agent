"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.aggregationPipelines = exports.RateLimit = exports.NotificationPreference = exports.ActivityLog = exports.Post = exports.Subscription = exports.User = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const UserSchema = new mongoose_1.Schema({
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
        transform: function (doc, ret) {
            const retObj = ret;
            delete retObj.password;
            delete retObj.twitterCredentials;
            return retObj;
        }
    }
});
const SubscriptionSchema = new mongoose_1.Schema({
    userId: {
        type: mongoose_1.Schema.Types.ObjectId,
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
const PostSchema = new mongoose_1.Schema({
    tweetId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    subscriptionId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Subscription',
        required: true,
        index: true
    },
    userId: {
        type: mongoose_1.Schema.Types.ObjectId,
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
const ActivityLogSchema = new mongoose_1.Schema({
    userId: {
        type: mongoose_1.Schema.Types.ObjectId,
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
    details: mongoose_1.Schema.Types.Mixed,
    ipAddress: String,
    userAgent: String
}, {
    timestamps: { createdAt: true, updatedAt: false }
});
ActivityLogSchema.index({ userId: 1, createdAt: -1 });
ActivityLogSchema.index({ action: 1, createdAt: -1 });
const NotificationPreferenceSchema = new mongoose_1.Schema({
    userId: {
        type: mongoose_1.Schema.Types.ObjectId,
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
const RateLimitSchema = new mongoose_1.Schema({
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
exports.User = mongoose_1.default.model('User', UserSchema);
exports.Subscription = mongoose_1.default.model('Subscription', SubscriptionSchema);
exports.Post = mongoose_1.default.model('Post', PostSchema);
exports.ActivityLog = mongoose_1.default.model('ActivityLog', ActivityLogSchema);
exports.NotificationPreference = mongoose_1.default.model('NotificationPreference', NotificationPreferenceSchema);
exports.RateLimit = mongoose_1.default.model('RateLimit', RateLimitSchema);
// Aggregation pipelines for common queries
exports.aggregationPipelines = {
    // Get subscription stats
    getSubscriptionStats: (userId) => [
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
    ],
    // Get trending hashtags from user's subscriptions
    getTrendingHashtags: (userId, days = 7) => [
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
    ],
    // Get engagement summary
    getEngagementSummary: (userId, days = 30) => [
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
    ]
};
//# sourceMappingURL=models.js.map