"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AISummarizationService = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../utils/logger"));
class AISummarizationService {
    constructor() {
        this.baseURL = 'https://openrouter.ai/api/v1/chat/completions';
        this.defaultModel = 'anthropic/claude-3-haiku';
        this.apiKey = process.env.OPENROUTER_API_KEY;
        if (!this.apiKey) {
            throw new Error('OPENROUTER_API_KEY is required');
        }
    }
    async summarizeTweets(tweets, options) {
        try {
            const model = options.model || this.getOptimalModel(tweets.length, options.analysisType);
            const systemPrompt = this.buildSystemPrompt(options.analysisType || 'quick');
            const userPrompt = this.buildUserPrompt(tweets);
            const response = await axios_1.default.post(this.baseURL, {
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.3,
                max_tokens: this.getMaxTokens(options.analysisType),
                stream: false
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': process.env.YOUR_SITE_URL || 'http://localhost:3001',
                    'X-Title': 'Twitter Agent Summarizer'
                },
                timeout: 30000
            });
            const content = response.data.choices[0]?.message?.content;
            if (!content) {
                throw new Error('No content received from OpenRouter');
            }
            // Parse the structured response
            const parsed = this.parseAIResponse(content);
            logger_1.default.info(`AI summarization completed for user ${options.userId}`, {
                tweetCount: tweets.length,
                model,
                tokensUsed: response.data.usage.total_tokens
            });
            return {
                summary: parsed.summary,
                keyTopics: parsed.keyTopics,
                sentiment: parsed.sentiment,
                tokensUsed: response.data.usage.total_tokens
            };
        }
        catch (error) {
            logger_1.default.error('AI summarization failed:', error);
            if (error.response?.status === 429) {
                throw new Error('AI service rate limit exceeded. Please try again later.');
            }
            else if (error.response?.status === 401) {
                throw new Error('AI service authentication failed. Check API key.');
            }
            else {
                throw new Error(`AI summarization failed: ${error.message}`);
            }
        }
    }
    getOptimalModel(tweetCount, analysisType) {
        if (analysisType === 'detailed' || tweetCount > 20) {
            return 'anthropic/claude-3-sonnet'; // Better for complex analysis
        }
        else if (analysisType === 'insights') {
            return 'openai/gpt-4o'; // Good for insights
        }
        return 'anthropic/claude-3-haiku'; // Fast and cost-effective
    }
    getMaxTokens(analysisType) {
        switch (analysisType) {
            case 'detailed': return 800;
            case 'insights': return 600;
            default: return 400;
        }
    }
    buildSystemPrompt(analysisType) {
        const basePrompt = `You are an expert Twitter content analyst. Analyze the provided tweets and respond in this exact JSON format:

{
  "summary": "A concise summary of the main points",
  "keyTopics": ["topic1", "topic2", "topic3"],
  "sentiment": "positive|negative|neutral|mixed",
  "insights": "Key insights and trends"
}`;
        if (analysisType === 'detailed') {
            return `${basePrompt}

For detailed analysis, provide:
- Comprehensive summary with context
- Identify emerging trends and patterns
- Note any significant announcements or news
- Analyze sentiment and engagement patterns`;
        }
        else if (analysisType === 'insights') {
            return `${basePrompt}

For insights analysis, focus on:
- Strategic implications of the content
- Market trends and opportunities
- Notable quotes or key statements
- Actionable takeaways`;
        }
        else {
            return `${basePrompt}

For quick analysis, provide:
- Brief but informative summary
- 3-5 main topics
- Overall sentiment
- One key insight`;
        }
    }
    buildUserPrompt(tweets) {
        const tweetTexts = tweets.map((tweet, index) => {
            const timestamp = new Date(tweet.tweetCreatedAt).toLocaleString();
            return `${index + 1}. @${tweet.authorUsername} (${timestamp}):
${tweet.content}
[Likes: ${tweet.engagement.likes}, RTs: ${tweet.engagement.retweets}]`;
        }).join('\n\n');
        return `Analyze these ${tweets.length} tweets from the user's subscribed accounts:

${tweetTexts}

Provide analysis in the requested JSON format.`;
    }
    parseAIResponse(content) {
        try {
            // Try to parse as JSON first
            const parsed = JSON.parse(content);
            return {
                summary: parsed.summary || 'Summary not available',
                keyTopics: parsed.keyTopics || [],
                sentiment: parsed.sentiment || 'neutral',
                insights: parsed.insights
            };
        }
        catch {
            // Fallback: parse manually if JSON parsing fails
            return {
                summary: content.substring(0, 300) + '...',
                keyTopics: this.extractTopicsFromText(content),
                sentiment: 'neutral'
            };
        }
    }
    extractTopicsFromText(text) {
        // Simple topic extraction as fallback
        const topics = [];
        const words = text.toLowerCase().split(/\s+/);
        const commonTopics = ['ai', 'technology', 'business', 'politics', 'crypto', 'market'];
        commonTopics.forEach(topic => {
            if (words.some(word => word.includes(topic))) {
                topics.push(topic);
            }
        });
        return topics.slice(0, 5);
    }
    // Alternative methods for different use cases
    async quickSummarize(tweets, userId) {
        const result = await this.summarizeTweets(tweets, {
            userId,
            analysisType: 'quick',
            model: 'anthropic/claude-3-haiku'
        });
        return result.summary;
    }
    async detailedAnalysis(tweets, userId) {
        return await this.summarizeTweets(tweets, {
            userId,
            analysisType: 'detailed',
            model: 'anthropic/claude-3-sonnet'
        });
    }
}
exports.AISummarizationService = AISummarizationService;
exports.default = new AISummarizationService();
//# sourceMappingURL=ai-summarization.js.map