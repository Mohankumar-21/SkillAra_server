import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

let openaiInstance = null;

const getOpenAiClient = () => {
  if (openaiInstance) return openaiInstance;
  
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing from .env. Please add it to use AI features.");
  }

  openaiInstance = new OpenAI({
    apiKey: apiKey,
  });
  return openaiInstance;
};

/**
 * Get AI Tutor response for a student query
 */
export const getAiTutorResponse = async (query, context = "") => {
  try {
    const client = getOpenAiClient();
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are Skillara AI Tutor, a friendly and helpful educational assistant. 
          Use the following lesson context to answer student questions. 
          If you don't know the answer based on the context, say so, but try to be helpful. 
          Context: ${context}`,
        },
        {
          role: "user",
          content: query,
        },
      ],
      temperature: 0.7,
    });

    return response.choices[0].message.content;
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
    const client = getOpenAiClient();
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an expert educational content creator. 
          Generate a multiple-choice quiz based on the provided content. 
          Return the quiz in JSON format: 
          [
            {
              "question": "...",
              "options": ["A", "B", "C", "D"],
              "correctAnswer": "...",
              "explanation": "..."
            }
          ]`,
        },
        {
          role: "user",
          content: `Generate ${questionCount} questions for the following content: ${content}`,
        },
      ],
      response_format: { type: "json_object" },
    });

    return JSON.parse(response.choices[0].message.content);
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
    const client = getOpenAiClient();
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an expert at condensing information. Provide a concise, structured summary of the following lesson content. Use bullet points where appropriate.",
        },
        {
          role: "user",
          content: `Summarize this: ${content}`,
        },
      ],
      temperature: 0.5,
    });

    return response.choices[0].message.content;
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
    const client = getOpenAiClient();
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an academic evaluator. Grade the student's work based on the assignment requirements. 
          Provide constructive feedback and a score out of 100.
          Requirements: ${assignmentContext}
          Return JSON: { "feedback": "...", "score": 85 }`,
        },
        {
          role: "user",
          content: `Student Work: ${studentWork}`,
        },
      ],
      response_format: { type: "json_object" },
    });

    return JSON.parse(response.choices[0].message.content);
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
