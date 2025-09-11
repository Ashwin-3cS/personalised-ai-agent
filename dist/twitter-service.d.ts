import { UserV2 } from 'twitter-api-v2';
import mongoose from 'mongoose';
import { ISubscription } from './models';
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
export declare class TwitterService {
    private client;
    private readonly encryptionKey;
    private userId;
    constructor(credentials: TwitterCredentials, userId: mongoose.Types.ObjectId);
    static encryptCredentials(credentials: TwitterCredentials): any;
    static decryptCredentials(encryptedData: any): TwitterCredentials;
    verifyCredentials(): Promise<UserV2>;
    getUserByUsername(username: string): Promise<UserV2>;
    getUserTweets(userId: string, options?: {
        sinceTime?: Date;
        maxResults?: number;
        includeReplies?: boolean;
        includeRetweets?: boolean;
        keywords?: string[];
    }): Promise<TweetData[]>;
    processSubscriptionTweets(subscription: ISubscription): Promise<number>;
    processAllUserSubscriptions(userId: mongoose.Types.ObjectId): Promise<{
        processed: number;
        newTweets: number;
        errors: string[];
    }>;
    getTweetById(tweetId: string): Promise<TweetData | null>;
    getRateLimitStatus(): Promise<any>;
    private extractMediaUrls;
    private formatTweetUrl;
    private delay;
    static cleanTweetText(text: string): string;
    static createForUser(userId: mongoose.Types.ObjectId): Promise<TwitterService | null>;
}
//# sourceMappingURL=twitter-service.d.ts.map