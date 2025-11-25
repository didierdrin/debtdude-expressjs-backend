const express = require('express');
const cors = require('cors');
const axios = require('axios');
const moment = require('moment');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory storage for demo (use database in production)
let conversations = [];
let messages = {};

// Utility functions
function analyzeTransactions(transactions, period = 'week') {
  const now = moment();
  let startDate;
  
  switch(period) {
    case 'day':
      startDate = now.clone().subtract(1, 'day');
      break;
    case 'week':
      startDate = now.clone().subtract(1, 'week');
      break;
    case 'month':
      startDate = now.clone().subtract(1, 'month');
      break;
    case 'year':
      startDate = now.clone().subtract(1, 'year');
      break;
    default:
      startDate = now.clone().subtract(1, 'week');
  }
  
  const filteredTransactions = transactions.filter(t => 
    moment(t.timestamp).isAfter(startDate)
  );
  
  const totalSpent = filteredTransactions
    .filter(t => t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);
    
  const totalReceived = filteredTransactions
    .filter(t => t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0);
    
  const topSenders = getTopPeople(filteredTransactions.filter(t => t.amount > 0));
  const topReceivers = getTopPeople(filteredTransactions.filter(t => t.amount < 0));
  
  return {
    period,
    totalSpent,
    totalReceived,
    netAmount: totalReceived - totalSpent,
    transactionCount: filteredTransactions.length,
    topSenders,
    topReceivers
  };
}

function getTopPeople(transactions) {
  const people = {};
  transactions.forEach(t => {
    if (!people[t.name]) {
      people[t.name] = { name: t.name, amount: 0, count: 0 };
    }
    people[t.name].amount += Math.abs(t.amount);
    people[t.name].count += 1;
  });
  
  return Object.values(people)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);
}

function requiresTransactionData(message) {
  const transactionKeywords = [
    'balance', 'spend', 'spent', 'expense', 'income', 'receive', 'received',
    'transaction', 'money', 'payment', 'transfer', 'budget', 'financial',
    'analysis', 'summary', 'total', 'amount', 'cost', 'price', 'bill'
  ];
  
  return transactionKeywords.some(keyword => 
    message.toLowerCase().includes(keyword)
  );
}

async function generateChatResponse(message, userTransactions) {
  try {
    // Check if question requires transaction data
    if (requiresTransactionData(message)) {
      if (!userTransactions || userTransactions.length === 0) {
        return null; // No fallback - return null if no transaction data available
      }
      
      const analysis = analyzeTransactions(userTransactions);
      const prompt = `You are DebtDude, a financial assistant. Based on the user's Firebase transaction data and their message: "${message}", provide a helpful response about their finances.
      
      Transaction analysis:
      ${JSON.stringify(analysis, null, 2)}
      
      Raw transactions (last 10):
      ${JSON.stringify(userTransactions.slice(-10), null, 2)}
      
      Respond in a conversational, helpful manner. Keep responses concise and actionable. Focus specifically on answering their question using the transaction data.`;
    } else {
      // For general questions, don't require transaction data
      const prompt = `You are DebtDude, a financial assistant. The user asked: "${message}"
      
      Provide a helpful response about general financial advice, budgeting tips, or financial concepts. Keep responses concise and actionable.`;
    }
    
    const response = await axios.post(`${process.env.GEMINI_API_URL}?key=${process.env.GEMINI_API_KEY}`, {
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 500
      }
    });
    
    return response.data.candidates[0].content.parts[0].text;
  } catch (error) {
    console.error('Chat API error:', error);
    return null; // No fallback responses
  }
}

// Routes

// Get financial analysis for a specific period
app.post('/api/analyze', (req, res) => {
  try {
    const { transactions, period = 'week' } = req.body;
    
    if (!transactions || !Array.isArray(transactions)) {
      return res.status(400).json({ error: 'Transactions array is required' });
    }
    
    const analysis = analyzeTransactions(transactions, period);
    res.json({ success: true, data: analysis });
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze transactions' });
  }
});

// Get spending analysis for dashboard
app.post('/api/dashboard', (req, res) => {
  try {
    const { transactions } = req.body;
    
    if (!transactions || !Array.isArray(transactions)) {
      return res.status(400).json({ error: 'Transactions array is required' });
    }
    
    const weeklyAnalysis = analyzeTransactions(transactions, 'week');
    const totalBalance = transactions.reduce((sum, t) => sum + t.amount, 0);
    
    res.json({
      success: true,
      data: {
        totalBalance,
        weeklySpending: weeklyAnalysis.totalSpent,
        weeklyReceived: weeklyAnalysis.totalReceived,
        netWeekly: weeklyAnalysis.netAmount
      }
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Failed to get dashboard data' });
  }
});

// Get conversations list
app.get('/api/conversations', (req, res) => {
  res.json({ success: true, data: conversations });
});

// Create new conversation
app.post('/api/conversations', (req, res) => {
  try {
    const { title, userId } = req.body;
    const conversationId = Date.now().toString();
    
    const conversation = {
      id: conversationId,
      title: title || 'New Conversation',
      userId,
      createdAt: new Date().toISOString(),
      lastMessage: 'Conversation started',
      lastMessageTime: new Date().toISOString()
    };
    
    conversations.push(conversation);
    messages[conversationId] = [];
    
    res.json({ success: true, data: conversation });
  } catch (error) {
    console.error('Create conversation error:', error);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

// Get messages for a conversation
app.get('/api/conversations/:id/messages', (req, res) => {
  try {
    const { id } = req.params;
    const conversationMessages = messages[id] || [];
    
    res.json({ success: true, data: conversationMessages });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

// Send message to conversation
app.post('/api/conversations/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const { message, userId, transactions } = req.body;
    
    if (!message || !userId) {
      return res.status(400).json({ error: 'Message and userId are required' });
    }
    
    // Add user message
    const userMessage = {
      id: Date.now().toString(),
      text: message,
      isMe: true,
      timestamp: new Date().toISOString(),
      time: moment().format('HH:mm')
    };
    
    if (!messages[id]) messages[id] = [];
    messages[id].push(userMessage);
    
    // Generate AI response
    const aiResponse = await generateChatResponse(message, transactions);
    
    // If no response generated (requires transaction data but none provided), return error
    if (aiResponse === null) {
      return res.status(400).json({ 
        error: 'This question requires transaction data to answer properly. Please ensure your Firebase transactions are synced.' 
      });
    }
    
    const aiMessage = {
      id: (Date.now() + 1).toString(),
      text: aiResponse,
      isMe: false,
      timestamp: new Date().toISOString(),
      time: moment().format('HH:mm')
    };
    
    messages[id].push(aiMessage);
    
    // Update conversation last message
    const conversationIndex = conversations.findIndex(c => c.id === id);
    if (conversationIndex !== -1) {
      conversations[conversationIndex].lastMessage = message;
      conversations[conversationIndex].lastMessageTime = new Date().toISOString();
    }
    
    res.json({ 
      success: true, 
      data: { 
        userMessage, 
        aiMessage 
      } 
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`DebtDude backend server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});