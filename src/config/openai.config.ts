import OpenAI from "openai";


const openaiClient = new OpenAI({
  apiKey: process.env.OPEN_AI_KEY,
});

export default openaiClient;