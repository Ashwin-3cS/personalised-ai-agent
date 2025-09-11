# AI Summarization Integration

This document describes the AI summarization feature integrated into your Twitter Agent Backend using OpenRouter.

## Overview

The AI summarization feature provides intelligent analysis of tweets from your subscriptions using state-of-the-art language models through OpenRouter. Instead of reading through individual tweets, users get concise summaries, key topics, sentiment analysis, and insights.

## Features

✅ **AI-Powered Summarization** - Uses OpenRouter with Claude/GPT models  
✅ **Multiple Analysis Types** - Quick, detailed, and insights modes  
✅ **Smart Model Selection** - Automatically chooses optimal model based on content  
✅ **Error Handling** - Graceful fallbacks when AI service fails  
✅ **Token Usage Tracking** - Monitors API costs  
✅ **Combined Operations** - Refresh + AI summary in one call

## Setup Instructions

### 1. Install Dependencies

The required `axios` dependency has already been installed.

### 2. Configure Environment Variables

Add your OpenRouter API key to the `.env` file:

```bash
# OpenRouter AI Configuration
OPENROUTER_API_KEY=sk-or-your-actual-key-here
YOUR_SITE_URL=http://localhost:3001

# Optional: Model preferences
OPENROUTER_DEFAULT_MODEL=anthropic/claude-3-haiku
OPENROUTER_DETAILED_MODEL=anthropic/claude-3-sonnet
OPENROUTER_INSIGHTS_MODEL=openai/gpt-4o
```

### 3. Get OpenRouter API Key

1. Visit [OpenRouter.ai](https://openrouter.ai)
2. Sign up for an account
3. Generate an API key
4. Replace `sk-or-your-actual-key-here` in your `.env` file

## New API Endpoints

### GET /api/updates/summarized
Get AI-summarized updates from subscriptions.

**Query Parameters:**
- `type` (optional): Analysis type - `quick`, `detailed`, or `insights` (default: `quick`)
- `since` (optional): Date to fetch tweets from (default: last 24 hours)
- `limit` (optional): Maximum number of tweets to analyze (default: 20)

**Response:**
```json
{
  "summary": "AI-generated summary of the tweets",
  "keyTopics": ["topic1", "topic2", "topic3"],
  "sentiment": "positive|negative|neutral|mixed",
  "insights": "Key insights and trends",
  "posts": [...],
  "count": 15,
  "analysis": {
    "tokensUsed": 450,
    "model": "quick",
    "generatedAt": "2024-01-15T10:30:00Z"
  }
}
```

### GET /api/updates/quick-summary
Fast AI summary optimized for speed (uses only 10 most recent tweets).

**Response:**
```json
{
  "summary": "Brief AI summary",
  "count": 10,
  "lastUpdated": "2024-01-15T10:30:00Z",
  "type": "quick"
}
```

### GET /api/updates/detailed-analysis
Comprehensive AI analysis with additional statistics.

**Query Parameters:**
- `days` (optional): Number of days to analyze (default: 1)

**Response:**
```json
{
  "summary": "Detailed AI analysis",
  "keyTopics": [...],
  "sentiment": "mixed",
  "insights": "Strategic insights and trends",
  "stats": {
    "totalPosts": 45,
    "daysCovered": 1,
    "subscriptionBreakdown": [...],
    "tokensUsed": 750
  },
  "generatedAt": "2024-01-15T10:30:00Z",
  "type": "detailed"
}
```

### POST /api/subscriptions/refresh-and-summarize
Refresh all subscriptions and generate AI summary of new tweets.

**Response:**
```json
{
  "success": true,
  "message": "Refresh completed. 12 new tweets found.",
  "stats": {
    "subscriptionsProcessed": 5,
    "newTweets": 12,
    "errors": []
  },
  "aiSummary": "AI summary of new tweets",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### GET /api/ai/health
Check AI service health and connectivity.

**Response:**
```json
{
  "status": "healthy",
  "aiService": "openrouter",
  "testSummary": "Test summary generated successfully",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

## Analysis Types

### Quick Analysis
- **Model**: Claude 3 Haiku (fast and cost-effective)
- **Max Tokens**: 400
- **Use Case**: Daily updates, quick overviews
- **Features**: Brief summary, main topics, overall sentiment

### Detailed Analysis
- **Model**: Claude 3 Sonnet (better for complex analysis)
- **Max Tokens**: 800
- **Use Case**: Weekly reports, comprehensive insights
- **Features**: Comprehensive summary, trend analysis, engagement patterns

### Insights Analysis
- **Model**: GPT-4o (good for strategic insights)
- **Max Tokens**: 600
- **Use Case**: Strategic planning, market analysis
- **Features**: Strategic implications, actionable takeaways, market trends

## Testing

Run the AI integration test script:

```bash
./ai-test.sh
```

This script will:
1. Login to get authentication token
2. Test AI service health
3. Test all AI endpoints
4. Verify functionality

## Error Handling

The AI service includes comprehensive error handling:

- **Rate Limit Exceeded**: Returns helpful message with retry suggestion
- **Authentication Failed**: Indicates API key issues
- **Service Unavailable**: Falls back to regular endpoints
- **Invalid Response**: Provides manual parsing fallback

## Cost Management

- **Token Usage Tracking**: All responses include token usage information
- **Smart Model Selection**: Automatically chooses cost-effective models
- **Request Limits**: Built-in limits prevent excessive API usage
- **Fallback Options**: Graceful degradation when AI service fails

## Usage Examples

### Frontend Integration

```javascript
// Get quick AI summary
const quickSummary = await fetch('/api/updates/quick-summary', {
  headers: { 'Authorization': `Bearer ${token}` }
});

// Get detailed analysis
const detailedAnalysis = await fetch('/api/updates/detailed-analysis?days=7', {
  headers: { 'Authorization': `Bearer ${token}` }
});

// Refresh and get AI summary
const refreshResult = await fetch('/api/subscriptions/refresh-and-summarize', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` }
});
```

### CLI Usage

```bash
# Quick summary
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/updates/quick-summary"

# Detailed analysis
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/updates/detailed-analysis?days=3"
```

## Monitoring

Monitor AI usage through:
- Activity logs (stored in MongoDB)
- Token usage tracking
- Error rate monitoring
- Response time metrics

## Security

- All AI endpoints require authentication
- API keys are stored securely in environment variables
- Rate limiting prevents abuse
- Input validation and sanitization

## Troubleshooting

### Common Issues

1. **"OPENROUTER_API_KEY is required"**
   - Add your OpenRouter API key to `.env`

2. **"AI service rate limit exceeded"**
   - Wait before making more requests
   - Consider upgrading OpenRouter plan

3. **"AI service authentication failed"**
   - Verify your OpenRouter API key is correct
   - Check if key has sufficient credits

4. **"No content received from OpenRouter"**
   - Check OpenRouter service status
   - Verify model availability

### Debug Mode

Enable debug logging by setting `LOG_LEVEL=debug` in your `.env` file.

## Future Enhancements

Potential improvements:
- Caching of AI responses
- Custom prompt templates
- Multi-language support
- Sentiment trend tracking
- Automated alerts based on AI insights

## Support

For issues related to:
- **OpenRouter API**: Visit [OpenRouter Documentation](https://openrouter.ai/docs)
- **Integration Issues**: Check the logs and error messages
- **Performance**: Monitor token usage and consider model optimization