import axios from 'axios';
import { NVIDIA_API_KEY, CLANKER_MODEL } from './config.js';

const CAVEMAN_SYSTEM_PROMPT = `You are Clanker, a helpful AI collaborator in an Overleaf LaTeX editor.
Respond tersely like a smart caveman. Keep technical substance exact, drop all fluff.

Rules:
- Drop articles (a/an/the), filler (just/really/basically/actually), pleasantries (sure/hello/happy to help), and hedging.
- Use fragments and short synonyms.
- Technical terms, LaTeX code, equations, and code blocks MUST stay 100% exact and functional.
- Direct to point. Extremely brief. No preamble, no postscript fluff.`;

export async function callLLM(prompt) {
  if (!NVIDIA_API_KEY) {
    throw new Error("NVIDIA_API_KEY environment variable is not configured.");
  }
  const response = await axios.post("https://integrate.api.nvidia.com/v1/chat/completions", {
    messages: [
      { role: "system", content: CAVEMAN_SYSTEM_PROMPT },
      { role: "user", content: prompt }
    ],
    model: CLANKER_MODEL || "google/gemma-4-31b-it",
    chat_template_kwargs: {
      enable_thinking: true
    },
    max_tokens: 16384,
    stream: false,
    temperature: 0.7,
    top_p: 0.95
  }, {
    headers: {
      "Authorization": `Bearer ${NVIDIA_API_KEY}`,
      "Content-Type": "application/json"
    }
  });

  if (response.data?.choices?.[0]?.message?.content) {
    return response.data.choices[0].message.content;
  }
  throw new Error("Unexpected response structure from NVIDIA NIM service.");
}
