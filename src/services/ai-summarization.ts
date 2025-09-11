import axios from 'axios';
import logger from '../utils/logger';

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

export class AISummarizationService {
  private apiKey: string | null = null;
  private baseURL: string = 'https://openrouter.ai/api/v1/chat/completions';
  private defaultModel: string = 'anthropic/claude-3-haiku';

  private initializeApiKey() {
    if (!this.apiKey) {
      this.apiKey = process.env.OPENROUTER_API_KEY!;
      if (!this.apiKey) {
        throw new Error('OPENROUTER_API_KEY is required. Please add it to your .env file.');
      }
    }
    return this.apiKey;
  }

  async summarizeTweets(tweets: any[], options: {
    userId: string;
    analysisType?: 'quick' | 'detailed' | 'insights';
    model?: string;
  }): Promise<{
    summary: string;
    keyTopics: string[];
    sentiment: string;
    tokensUsed: number;
  }> {
    try {
      const apiKey = this.initializeApiKey();
      const model = options.model || this.getOptimalModel(tweets.length, options.analysisType);
      const systemPrompt = this.buildSystemPrompt(options.analysisType || 'quick');
      const userPrompt = this.buildUserPrompt(tweets);

      const response = await axios.post<OpenRouterResponse>(
        this.baseURL,
        {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.3,
          max_tokens: this.getMaxTokens(options.analysisType),
          stream: false
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.YOUR_SITE_URL || 'http://localhost:3001',
            'X-Title': 'Twitter Agent Summarizer'
          },
          timeout: 30000
        }
      );

      const content = response.data.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No content received from OpenRouter');
      }

      // Parse the structured response
      const parsed = this.parseAIResponse(content);

      logger.info(`AI summarization completed for user ${options.userId}`, {
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

    } catch (error: any) {
      // Handle circular reference issues in error logging
      const errorInfo = {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      };
      logger.error('AI summarization failed:', errorInfo);
      
      if (error.response?.status === 429) {
        throw new Error('AI service rate limit exceeded. Please try again later.');
      } else if (error.response?.status === 401) {
        throw new Error('AI service authentication failed. Check API key.');
      } else {
        throw new Error(`AI summarization failed: ${error.message}`);
      }
    }
  }

  private getOptimalModel(tweetCount: number, analysisType?: string): string {
    if (analysisType === 'detailed' || tweetCount > 20) {
      return 'anthropic/claude-3-haiku'; // Use same model for now to avoid 404
    } else if (analysisType === 'insights') {
      return 'anthropic/claude-3-haiku'; // Use same model for now to avoid 404
    }
    return 'anthropic/claude-3-haiku'; // Fast and cost-effective
  }

  private getMaxTokens(analysisType?: string): number {
    switch (analysisType) {
      case 'detailed': return 800;
      case 'insights': return 600;
      default: return 400;
    }
  }

  private buildSystemPrompt(analysisType: string): string {
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
    } else if (analysisType === 'insights') {
      return `${basePrompt}

For insights analysis, focus on:
- Strategic implications of the content
- Market trends and opportunities
- Notable quotes or key statements
- Actionable takeaways`;
    } else {
      return `${basePrompt}

For quick analysis, provide:
- Brief but informative summary
- 3-5 main topics
- Overall sentiment
- One key insight`;
    }
  }

  private buildUserPrompt(tweets: any[]): string {
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

  private parseAIResponse(content: string): {
    summary: string;
    keyTopics: string[];
    sentiment: string;
    insights?: string;
  } {
    try {
      // Try to parse as JSON first
      const parsed = JSON.parse(content);
      return {
        summary: parsed.summary || 'Summary not available',
        keyTopics: parsed.keyTopics || [],
        sentiment: parsed.sentiment || 'neutral',
        insights: parsed.insights
      };
    } catch {
      // Fallback: parse manually if JSON parsing fails
      return {
        summary: content.substring(0, 300) + '...',
        keyTopics: this.extractTopicsFromText(content),
        sentiment: 'neutral'
      };
    }
  }

  private extractTopicsFromText(text: string): string[] {
    // Simple topic extraction as fallback
    const topics: string[] = [];
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
  async quickSummarize(tweets: any[], userId: string): Promise<string> {
    const result = await this.summarizeTweets(tweets, {
      userId,
      analysisType: 'quick',
      model: 'anthropic/claude-3-haiku'
    });
    return result.summary;
  }

  async detailedAnalysis(tweets: any[], userId: string): Promise<any> {
    return await this.summarizeTweets(tweets, {
      userId,
      analysisType: 'detailed',
      model: 'anthropic/claude-3-haiku'
    });
  }
}

// Export a factory function instead of instantiating immediately
let instance: AISummarizationService | null = null;

function getInstance(): AISummarizationService {
  if (!instance) {
    instance = new AISummarizationService();
  }
  return instance;
}

export default {
  getInstance,
  
  // Convenience methods that use the singleton instance
  async summarizeTweets(tweets: any[], options: {
    userId: string;
    analysisType?: 'quick' | 'detailed' | 'insights';
    model?: string;
  }) {
    return getInstance().summarizeTweets(tweets, options);
  },
  
  async quickSummarize(tweets: any[], userId: string) {
    return getInstance().quickSummarize(tweets, userId);
  },
  
  async detailedAnalysis(tweets: any[], userId: string) {
    return getInstance().detailedAnalysis(tweets, userId);
  }
};