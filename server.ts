import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";

const PORT = 3000;
const isProd = process.env.NODE_ENV === "production";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  
  app.use(express.json());

  // Initialize Gemini AI
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  // API endpoint for Text-to-Speech
  app.post("/api/tts", async (req, res) => {
    try {
      const { prompt, voice } = req.body;
      
      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      console.log(`Generating TTS for: "${prompt.substring(0, 50)}..." with voice: ${voice}`);

      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice || 'Kore' },
            },
          },
        },
      });

      const firstCandidate = response.candidates?.[0];
      const parts = firstCandidate?.content?.parts;
      const audioPart = parts?.find(p => p.inlineData?.data);
      const base64Audio = audioPart?.inlineData?.data;
      
      if (base64Audio) {
        console.log("TTS Success: Audio data received");
        res.json({ audio: base64Audio });
      } else {
        const textPart = response.text || parts?.[0]?.text;
        const finishReason = firstCandidate?.finishReason;
        const msg = textPart 
          ? `Model returned text instead of audio: ${textPart}` 
          : (finishReason ? `Model finished without audio. Reason: ${finishReason}` : "No audio returned from Gemini");
        
        console.error("TTS Failure:", msg);
        res.status(500).json({ error: msg });
      }
    } catch (error: any) {
      console.error("TTS Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // WebSocket for Live API Proxy
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url || '', `http://${request.headers.host}`);
    
    if (pathname === '/ws-live') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on("connection", async (clientWs) => {
    console.log("Client connected to Live Proxy");
    let session: any = null;

    try {
      session = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        callbacks: {
          onopen: () => {
             clientWs.send(JSON.stringify({ status: 'open' }));
          },
          onmessage: (message: LiveServerMessage) => {
            // Forward everything to client
            clientWs.send(JSON.stringify(message));
          },
          onclose: () => {
             clientWs.send(JSON.stringify({ status: 'closed' }));
          },
          onerror: (err) => {
             clientWs.send(JSON.stringify({ error: err.message }));
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: "Você é um assistente de tradução útil, espirituoso e poliglota. Você pode traduzir frases, discutir idiomas ou apenas conversar casualmente. Mantenha as respostas concisas. Fale principalmente em Português do Brasil.",
        },
      });

      clientWs.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.realtimeInput) {
             session.sendRealtimeInput(msg.realtimeInput);
          }
        } catch (e) {
          console.error("Error processing client message:", e);
        }
      });

      clientWs.on("close", () => {
        console.log("Client disconnected, closing Gemini session");
        if (session) session.close();
      });

    } catch (error: any) {
      console.error("Gemini Live Connection Error:", error);
      clientWs.send(JSON.stringify({ error: error.message }));
      clientWs.close();
    }
  });

  // Vite middleware setup
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
