export interface OpenRouterResponse {
    id: string;
    choices: Array<{
        message: {
            role: string;
            content: string;
        };
        finish_reason: string;
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}
export declare class AISummarizationService {
    private apiKey;
    private baseURL;
    private defaultModel;
    constructor();
    summarizeTweets(tweets: any[], options: {
        userId: string;
        analysisType?: 'quick' | 'detailed' | 'insights';
        model?: string;
    }): Promise<{
        summary: string;
        keyTopics: string[];
        sentiment: string;
        tokensUsed: number;
    }>;
    private getOptimalModel;
    private getMaxTokens;
    private buildSystemPrompt;
    private buildUserPrompt;
    private parseAIResponse;
    private extractTopicsFromText;
    quickSummarize(tweets: any[], userId: string): Promise<string>;
    detailedAnalysis(tweets: any[], userId: string): Promise<any>;
}
declare const _default: AISummarizationService;
export default _default;
//# sourceMappingURL=ai-summarization.d.ts.map