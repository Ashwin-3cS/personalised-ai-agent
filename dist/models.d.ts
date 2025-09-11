import mongoose, { Document } from 'mongoose';
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
export interface ISubscription extends Document {
    userId: mongoose.Types.ObjectId;
    targetUsername: string;
    isActive: boolean;
    checkInterval: number;
    lastChecked: Date;
    keywords: string[];
    includeReplies: boolean;
    includeRetweets: boolean;
    createdAt: Date;
    updatedAt: Date;
}
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
export interface IActivityLog extends Document {
    userId?: mongoose.Types.ObjectId | null;
    action: string;
    details?: any;
    ipAddress?: string;
    userAgent?: string;
    createdAt: Date;
}
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
export interface IRateLimit extends Document {
    identifier: string;
    requests: number;
    windowStart: Date;
    createdAt: Date;
    updatedAt: Date;
}
export declare const User: mongoose.Model<IUser, {}, {}, {}, mongoose.Document<unknown, {}, IUser> & IUser & {
    _id: mongoose.Types.ObjectId;
}, any>;
export declare const Subscription: mongoose.Model<ISubscription, {}, {}, {}, mongoose.Document<unknown, {}, ISubscription> & ISubscription & {
    _id: mongoose.Types.ObjectId;
}, any>;
export declare const Post: mongoose.Model<IPost, {}, {}, {}, mongoose.Document<unknown, {}, IPost> & IPost & {
    _id: mongoose.Types.ObjectId;
}, any>;
export declare const ActivityLog: mongoose.Model<IActivityLog, {}, {}, {}, mongoose.Document<unknown, {}, IActivityLog> & IActivityLog & {
    _id: mongoose.Types.ObjectId;
}, any>;
export declare const NotificationPreference: mongoose.Model<INotificationPreference, {}, {}, {}, mongoose.Document<unknown, {}, INotificationPreference> & INotificationPreference & {
    _id: mongoose.Types.ObjectId;
}, any>;
export declare const RateLimit: mongoose.Model<IRateLimit, {}, {}, {}, mongoose.Document<unknown, {}, IRateLimit> & IRateLimit & {
    _id: mongoose.Types.ObjectId;
}, any>;
export declare const aggregationPipelines: {
    getSubscriptionStats: (userId: mongoose.Types.ObjectId) => mongoose.PipelineStage[];
    getTrendingHashtags: (userId: mongoose.Types.ObjectId, days?: number) => mongoose.PipelineStage[];
    getEngagementSummary: (userId: mongoose.Types.ObjectId, days?: number) => mongoose.PipelineStage[];
};
//# sourceMappingURL=models.d.ts.map