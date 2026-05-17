import React, { useState } from 'react';
import { AppMode } from './types';
import LiveSession from './components/LiveSession';
import TextToSpeech from './components/TextToSpeech';
import { Sparkles, MessageSquare, Mic } from 'lucide-react';

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>(AppMode.LIVE_CONVERSATION);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 selection:bg-purple-500/30">
      
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-xl sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-purple-600 flex items-center justify-center shadow-lg shadow-purple-900/20">
               <Sparkles className="text-white w-5 h-5" />
            </div>
            <div>
                <h1 className="text-xl font-bold text-white tracking-tight">Gemini Voice Bridge</h1>
                <p className="text-xs text-slate-400">Áudio ao Vivo e Tradução</p>
            </div>
          </div>
          
          <nav className="flex p-1 bg-slate-800/80 rounded-lg border border-slate-700/50">
            <button
              onClick={() => setMode(AppMode.LIVE_CONVERSATION)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                mode === AppMode.LIVE_CONVERSATION
                  ? 'bg-slate-700 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Mic className="w-4 h-4" />
              Conversa ao Vivo
            </button>
            <button
              onClick={() => setMode(AppMode.TEXT_TO_SPEECH)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                mode === AppMode.TEXT_TO_SPEECH
                  ? 'bg-slate-700 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              Texto para Áudio
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-6 py-12">
        
        <div className="mb-12 text-center space-y-4">
            <h1 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white via-blue-100 to-slate-400 tracking-tight">
                {mode === AppMode.LIVE_CONVERSATION ? "Converse com o Gemini em Tempo Real" : "Transforme Texto em Fala"}
            </h1>
            <p className="text-lg text-slate-400 max-w-2xl mx-auto">
                {mode === AppMode.LIVE_CONVERSATION 
                    ? "Experimente a API Gemini 3.1 Live. Fale naturalmente, interrompa a qualquer momento e obtenha respostas de áudio instantâneas com baixa latência."
                    : "Gere áudio realista de alta qualidade a partir de texto usando os modelos TTS avançados do Gemini. Perfeito para tradução e acessibilidade."}
            </p>
        </div>

        <div className="transition-all duration-300 ease-in-out">
             {mode === AppMode.LIVE_CONVERSATION ? <LiveSession /> : <TextToSpeech />}
        </div>
      </main>

      <footer className="border-t border-slate-800 mt-12 py-8">
          <div className="text-center text-slate-500 text-sm">
              Desenvolvido com Gemini 3.1 Flash • Live API • Web Audio API
          </div>
      </footer>
    </div>
  );
};

export default App;