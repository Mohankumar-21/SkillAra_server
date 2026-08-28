import dotenv from "dotenv";

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
const AI_MODEL = process.env.AI_MODEL || "gemini-flash-latest";
const AI_MAX_TOKENS = Number(process.env.AI_MAX_TOKENS) || 2000;

/**
 * Helper to call Google's Gemini generateContent REST API
 */
const callGeminiApi = async (payload) => {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing from .env. Please add it to use AI features.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-goog-api-key": GEMINI_API_KEY,
      "Connection": "close"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API Error (HTTP ${response.status}): ${errText}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`Gemini API Error: ${data.error.message}`);
  }

  return data;
};

/**
 * Get AI Tutor response for a student query
 */
export const getAiTutorResponse = async (query, context = "") => {
  try {
    const payload = {
      contents: [
        {
          role: "user",
          parts: [{ text: query }]
        }
      ],
      systemInstruction: {
        role: "system",
        parts: [{
          text: `You are Skillara AI Tutor, a friendly and helpful educational assistant. 
          Use the following lesson context to answer student questions. 
          If you don't know the answer based on the context, say so, but try to be helpful. 
          Context: ${context}`
        }]
      },
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: AI_MAX_TOKENS
      }
    };

    const data = await callGeminiApi(payload);
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } catch (error) {
    console.error("AI Tutor Error:", error);
    throw error;
  }
};

/**
 * Generate a quiz based on lesson content
 */
export const generateQuiz = async (content, questionCount = 5) => {
  try {
    const payload = {
      contents: [
        {
          role: "user",
          parts: [{ text: `Generate ${questionCount} questions for the following content: ${content}` }]
        }
      ],
      systemInstruction: {
        role: "system",
        parts: [{
          text: `You are an expert educational content creator. 
          Generate a multiple-choice quiz based on the provided content. 
          Return the quiz in JSON format: 
          [
            {
              "question": "...",
              "options": ["A", "B", "C", "D"],
              "correctAnswer": "...",
              "explanation": "..."
            }
          ]`
        }]
      },
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: AI_MAX_TOKENS
      }
    };

    const data = await callGeminiApi(payload);
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    return JSON.parse(text);
  } catch (error) {
    console.error("Quiz Generator Error:", error);
    throw error;
  }
};

/**
 * Summarize lesson content
 */
export const summarizeContent = async (content) => {
  try {
    const payload = {
      contents: [
        {
          role: "user",
          parts: [{ text: `Summarize this: ${content}` }]
        }
      ],
      systemInstruction: {
        role: "system",
        parts: [{
          text: "You are an expert at condensing information. Provide a concise, structured summary of the following lesson content. Use bullet points where appropriate."
        }]
      },
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: AI_MAX_TOKENS
      }
    };

    const data = await callGeminiApi(payload);
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } catch (error) {
    console.error("Summarization Error:", error);
    throw error;
  }
};

/**
 * Evaluate a student's assignment submission
 */
export const evaluateSubmission = async (studentWork, assignmentContext) => {
  try {
    const payload = {
      contents: [
        {
          role: "user",
          parts: [{ text: `Student Work: ${studentWork}` }]
        }
      ],
      systemInstruction: {
        role: "system",
        parts: [{
          text: `You are an academic evaluator. Grade the student's work based on the assignment requirements. 
          Provide constructive feedback and a score out of 100.
          Requirements: ${assignmentContext}
          Return JSON: { "feedback": "...", "score": 85 }`
        }]
      },
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: AI_MAX_TOKENS
      }
    };

    const data = await callGeminiApi(payload);
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    return JSON.parse(text);
  } catch (error) {
    console.error("Evaluation Error:", error);
    throw error;
  }
};

/**
 * Increment AI usage for a tenant
 */
export const incrementAiUsage = async (tenantId) => {
  try {
    const month = new Date().toISOString().slice(0, 7);
    const AIUsageModel = (await import("../models/AIUsage.js")).default;
    await AIUsageModel.findOneAndUpdate(
      { tenantId, month },
      { $inc: { requestCount: 1 } },
      { upsert: true, new: true }
    );
  } catch (error) {
    console.warn("Failed to increment AI usage:", error);
  }
};
