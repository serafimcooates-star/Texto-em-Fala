import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality } from '@google/genai';
import { Play, Languages, Loader2, Download, Mic, Zap, Settings2, Info, AlertCircle, Timer, Gauge, AudioLines } from 'lucide-react';
import { decodeAudioData, decodeBase64, getAudioContext } from '../services/audioUtils';

// Lista oficial de vozes suportadas e testadas
const VOICES = [
  { id: 'puck', label: 'Puck (Masculino)' },
  { id: 'charon', label: 'Charon (Masculino)' },
  { id: 'fenrir', label: 'Fenrir (Masculino)' },
  { id: 'kore', label: 'Kore (Feminino)' },
  { id: 'zephyr', label: 'Zephyr (Feminino)' },
  { id: 'aoede', label: 'Aoede (Feminino)' },
  { id: 'orion', label: 'Orion (Masculino)' },
  { id: 'pegasus', label: 'Pegasus (Masculino)' },
  { id: 'dipper', label: 'Dipper (Masculino)' },
  { id: 'perseus', label: 'Perseus (Masculino)' },
];

const TONE_STYLES = [
  { id: 'standard', label: 'Padrão (Fluido)', instruction: 'in a standard, highly fluid and natural conversational tone' },
  { id: 'enthusiastic', label: 'Entusiasta / Alegre', instruction: 'with an enthusiastic, cheerful, and energetic tone' },
  { id: 'professional', label: 'Profissional / Noticiário', instruction: 'in a professional, formal, news-anchor style' },
  { id: 'calm', label: 'Calmo / Sereno', instruction: 'in a calm, soothing, and soft tone' },
  { id: 'dramatic', label: 'Dramático / Narrativa', instruction: 'in a dramatic, storytelling tone with strong emotional emphasis' },
  { id: 'didactic', label: 'Didático / Explicativo', instruction: 'in a slow, clear, and didactic tone, emphasizing key words' },
];

const TextToSpeech: React.FC = () => {
  const [text, setText] = useState('');
  const [targetLang, setTargetLang] = useState('Inglês');
  const [voice, setVoice] = useState('kore');
  const [sampleRate, setSampleRate] = useState(24000);
  const [speed, setSpeed] = useState<'slow' | 'normal' | 'fast'>('normal');
  const [tone, setTone] = useState('standard');
  const [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoGenerate, setAutoGenerate] = useState(false);
  const [pauseDuration, setPauseDuration] = useState(1);

  const debounceTimerRef = useRef<any>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const handleGenerate = useCallback(async () => {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    
    try {
      if (!process.env.API_KEY) throw new Error("Chave da API ausente. Verifique suas configurações.");

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      let prompt;
      const pauseInstruction = ' Interpret <break time="Xs" /> tags as silent pauses of X seconds. Do not read the tags aloud.';
      
      // Speed Instruction
      let speedInstruction = "naturally";
      if (speed === 'slow') speedInstruction = "slowly, clearly and articulately";
      if (speed === 'fast') speedInstruction = "quickly, efficiently and fluidly";

      // Tone Instruction
      const selectedTone = TONE_STYLES.find(t => t.id === tone) || TONE_STYLES[0];
      const toneInstruction = selectedTone.instruction;

      // Intonation/Fluency instruction - APRIMORADO PARA REMOVER TROPEÇOS
      const fluencyInstruction = "Ensure the speech is completely fluid, seamless, and continuous. Avoid awkward stumbling, robotic pauses at commas, or hesitation. Connect phrases naturally like a professional voice actor with perfect breath control.";

      if (targetLang === 'auto') {
        prompt = `Read the following text aloud ${speedInstruction} and ${toneInstruction} in its original language. ${fluencyInstruction}${pauseInstruction} Text: "${text}"`;
      } else {
        prompt = `Translate the following text to ${targetLang} and read it aloud ${speedInstruction} and ${toneInstruction}. ${fluencyInstruction}${pauseInstruction} Text: "${text}"`;
      }

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: prompt,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice },
            },
          },
        },
      });

      const candidate = response.candidates?.[0];
      const base64Audio = candidate?.content?.parts?.[0]?.inlineData?.data;
      
      if (base64Audio) {
        // Create context with user-selected sample rate (Quality)
        // The browser will handle resampling from the source (24k) to the destination (sampleRate)
        const audioCtx = getAudioContext(sampleRate);
        
        // We must tell decodeAudioData the *source* rate (24000 for Gemini Flash TTS)
        // so it calculates duration correctly before resampling to ctx rate.
        const audioBuffer = await decodeAudioData(
             decodeBase64(base64Audio),
             audioCtx,
             24000 
        );
        
        const wavBlob = audioBufferToWav(audioBuffer);
        const url = URL.createObjectURL(wavBlob);
        setAudioUrl(url);
        audioCtx.close();
      } else {
          // Check if the model returned text instead (e.g. refusal or error message)
          const textPart = candidate?.content?.parts?.[0]?.text;
          if (textPart) {
             throw new Error(`O modelo retornou texto em vez de áudio: "${textPart}"`);
          }
          
          // Check if there is a finish reason other than STOP
          const finishReason = candidate?.finishReason;
          if (finishReason) {
              throw new Error(`Geração finalizada com motivo: ${finishReason}`);
          }

          throw new Error("A resposta da API não contém dados de áudio válidos.");
      }

    } catch (e: any) {
      console.error("TTS Error:", e);
      // Capture detailed error message from API if available
      const errorMessage = e.message || e.toString() || "Ocorreu um erro desconhecido durante a geração.";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [text, targetLang, voice, sampleRate, speed, tone]);

  // Effect for Auto-Generate with Debounce
  useEffect(() => {
    if (!autoGenerate) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (text.trim().length > 0) {
      debounceTimerRef.current = setTimeout(() => {
        handleGenerate();
      }, 1500); // Espera 1.5 segundos após parar de digitar
    }

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [text, autoGenerate, handleGenerate]);

  const insertPause = () => {
    if (textAreaRef.current) {
        const start = textAreaRef.current.selectionStart;
        const end = textAreaRef.current.selectionEnd;
        
        // Inserir tag explícita de pausa que será interpretada via instrução do prompt
        const pauseMarker = ` <break time="${pauseDuration}s" /> `;
        
        const newText = text.substring(0, start) + pauseMarker + text.substring(end);
        setText(newText);

        // Recuperar o foco e mover o cursor para após a inserção
        setTimeout(() => {
            if (textAreaRef.current) {
                textAreaRef.current.focus();
                const newCursorPos = start + pauseMarker.length;
                textAreaRef.current.setSelectionRange(newCursorPos, newCursorPos);
            }
        }, 0);
    }
  };

  // Helper para descrever a qualidade
  const getQualityInfo = (rate: number) => {
    if (rate < 24000) {
        return {
            label: "Baixa Fidelidade (Compacto)",
            description: "Gera arquivos menores, ideais para conexões lentas. O áudio pode ter menos brilho.",
            color: "text-amber-400",
            borderColor: "border-amber-500/30",
            bg: "bg-amber-500/10"
        };
    }
    if (rate === 24000) {
        return {
            label: "Qualidade Padrão (Nativa)",
            description: "Equilíbrio ideal. Esta é a taxa nativa do modelo Gemini, sem perda nem upsampling.",
            color: "text-green-400",
            borderColor: "border-green-500/30",
            bg: "bg-green-500/10"
        };
    }
    return {
        label: "Alta Fidelidade (Upsampled)",
        description: "Áudio mais suave e detalhado (48kHz). Gera arquivos significativamente maiores.",
        color: "text-blue-400",
        borderColor: "border-blue-500/30",
        bg: "bg-blue-500/10"
    };
  };

  const qualityInfo = getQualityInfo(sampleRate);

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6 animate-fade-in">
      <div className="bg-slate-800 p-6 rounded-2xl shadow-xl border border-slate-700">
        <div className="flex items-center gap-3 mb-6">
            <Languages className="w-6 h-6 text-purple-400" />
            <h2 className="text-xl font-semibold text-white">Tradutor de Texto para Áudio</h2>
        </div>

        <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">Idioma de Destino</label>
                    <select 
                        value={targetLang}
                        onChange={(e) => setTargetLang(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg p-3 focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                    >
                        <option value="auto">✨ Idioma Original (Auto-detectar)</option>
                        <option value="Português">Português</option>
                        <option value="Inglês">Inglês</option>
                        <option value="Espanhol">Espanhol</option>
                        <option value="Francês">Francês</option>
                        <option value="Alemão">Alemão</option>
                        <option value="Japonês">Japonês</option>
                        <option value="Coreano">Coreano</option>
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">Voz do Modelo</label>
                    <div className="relative">
                        <select 
                            value={voice}
                            onChange={(e) => setVoice(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg p-3 pl-10 focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none appearance-none"
                        >
                            {VOICES.map((v) => (
                                <option key={v.id} value={v.id}>{v.label}</option>
                            ))}
                        </select>
                        <Mic className="w-4 h-4 text-slate-500 absolute left-3 top-3.5 pointer-events-none" />
                    </div>
                </div>
            </div>

            {/* Settings Row */}
            <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/50 transition-all space-y-6">
                <div className="flex items-center gap-2 mb-2">
                    <Settings2 className="w-4 h-4 text-purple-400" />
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Configurações de Áudio</span>
                </div>
                
                {/* Tone & Style Selector */}
                <div>
                    <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider flex items-center gap-2">
                        <AudioLines className="w-3 h-3" /> Estilo e Entoação
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {TONE_STYLES.map((t) => (
                            <button
                                key={t.id}
                                onClick={() => setTone(t.id)}
                                className={`px-3 py-2 rounded-lg text-xs font-medium transition-all text-left border ${
                                    tone === t.id 
                                    ? 'bg-purple-500/20 text-purple-300 border-purple-500/40 shadow-sm' 
                                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                                }`}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1.5">
                        Controla a expressividade e garante que o modelo respeite acentuações e pontuações gramaticais.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-700/50">
                    {/* Sample Rate Control */}
                    <div className="space-y-4">
                        <div>
                            <div className="flex justify-between text-xs text-slate-400 mb-2">
                                <span>Taxa de Amostragem (Hz)</span>
                                <span className={`font-mono font-bold ${qualityInfo.color}`}>{sampleRate} Hz</span>
                            </div>
                            <input 
                                type="range" 
                                min="16000" 
                                max="48000" 
                                step="4000" 
                                value={sampleRate}
                                onChange={(e) => setSampleRate(Number(e.target.value))}
                                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-purple-500 hover:accent-purple-400"
                            />
                            <div className="flex justify-between text-[10px] text-slate-600 mt-1 font-mono">
                                <span>16k</span>
                                <span>24k</span>
                                <span>32k</span>
                                <span>40k</span>
                                <span>48k</span>
                            </div>
                        </div>

                        {/* Dynamic Feedback Box */}
                        <div className={`flex gap-3 p-3 rounded-lg border ${qualityInfo.borderColor} ${qualityInfo.bg}`}>
                            <Info className={`w-5 h-5 flex-shrink-0 ${qualityInfo.color}`} />
                            <div>
                                <p className={`text-xs font-bold mb-1 ${qualityInfo.color}`}>{qualityInfo.label}</p>
                                <p className="text-[11px] text-slate-300 leading-relaxed opacity-90">
                                    {qualityInfo.description}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Speed Control */}
                    <div className="flex flex-col justify-between">
                         <div className="mb-2">
                            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider flex items-center gap-2">
                                <Gauge className="w-3 h-3" /> Velocidade da Fala
                            </span>
                         </div>
                         <div className="flex-1 bg-slate-800/50 rounded-lg p-1 flex items-center gap-1 border border-slate-700 max-h-[42px]">
                            <button
                                onClick={() => setSpeed('slow')}
                                className={`flex-1 py-2 rounded text-xs font-bold transition-all ${
                                    speed === 'slow' 
                                    ? 'bg-slate-700 text-white shadow-sm' 
                                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                                }`}
                            >
                                Lento
                            </button>
                            <button
                                onClick={() => setSpeed('normal')}
                                className={`flex-1 py-2 rounded text-xs font-bold transition-all ${
                                    speed === 'normal' 
                                    ? 'bg-slate-700 text-white shadow-sm' 
                                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                                }`}
                            >
                                Normal
                            </button>
                            <button
                                onClick={() => setSpeed('fast')}
                                className={`flex-1 py-2 rounded text-xs font-bold transition-all ${
                                    speed === 'fast' 
                                    ? 'bg-slate-700 text-white shadow-sm' 
                                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                                }`}
                            >
                                Rápido
                            </button>
                         </div>
                         <p className="text-[10px] text-slate-500 mt-2">
                            Define a velocidade da leitura gerada pelo modelo.
                         </p>
                    </div>
                </div>
            </div>

            <div>
                <div className="flex justify-between items-end mb-2">
                    <div className="flex gap-3 items-center">
                        <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider">Texto de Origem</label>
                        
                        <div className="flex items-center rounded bg-slate-700 border border-slate-600">
                            <button 
                                onClick={insertPause}
                                className="flex items-center gap-1 text-[10px] px-2 py-1 text-slate-200 hover:bg-slate-600 rounded-l transition-colors border-r border-slate-600"
                                title={`Insere uma pausa de ${pauseDuration}s na posição do cursor`}
                            >
                                <Timer className="w-3 h-3" />
                                Pausa
                            </button>
                            <select
                                value={pauseDuration}
                                onChange={(e) => setPauseDuration(Number(e.target.value))}
                                className="bg-transparent text-[10px] text-slate-300 outline-none px-1 py-1 hover:text-white cursor-pointer appearance-none text-center w-[40px]"
                                title="Duração da pausa em segundos"
                            >
                                 <option value="0.5" className="bg-slate-800">0.5s</option>
                                 <option value="1" className="bg-slate-800">1s</option>
                                 <option value="2" className="bg-slate-800">2s</option>
                                 <option value="3" className="bg-slate-800">3s</option>
                            </select>
                        </div>
                    </div>
                    
                    <label className="flex items-center cursor-pointer group">
                        <div className="relative">
                            <input 
                                type="checkbox" 
                                className="sr-only" 
                                checked={autoGenerate}
                                onChange={(e) => setAutoGenerate(e.target.checked)}
                            />
                            <div className={`block w-10 h-6 rounded-full transition-colors ${autoGenerate ? 'bg-purple-600' : 'bg-slate-600'}`}></div>
                            <div className={`absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${autoGenerate ? 'translate-x-4' : ''}`}></div>
                        </div>
                        <span className={`ml-2 text-xs font-medium transition-colors ${autoGenerate ? 'text-purple-400' : 'text-slate-500'}`}>
                            <Zap className="w-3 h-3 inline mr-1" />
                            Auto-gerar
                        </span>
                    </label>
                </div>
                <textarea 
                    ref={textAreaRef}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Digite o texto para traduzir e falar... (Use pontuação correta para melhor entoação)"
                    className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg p-4 h-32 focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none resize-none"
                />
            </div>

            <button 
                onClick={handleGenerate}
                disabled={loading || !text.trim()}
                className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-bold text-white shadow-lg flex items-center justify-center gap-2 transition-all"
            >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5 fill-current" />}
                {loading ? "Gerando Áudio..." : "Gerar Áudio Manualmente"}
            </button>

            {error && (
                <div className="p-4 bg-red-950/30 border border-red-500/30 rounded-xl flex items-start gap-3 animate-in fade-in zoom-in-95">
                    <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                    <div className="flex-1">
                        <h3 className="text-sm font-bold text-red-400 mb-1">Falha na Geração</h3>
                        <p className="text-xs text-red-300/90 font-mono break-words leading-relaxed">
                            {error}
                        </p>
                    </div>
                </div>
            )}

            {audioUrl && (
                <div className="mt-6 p-4 bg-slate-900/50 rounded-xl border border-slate-700 space-y-4 animate-in fade-in slide-in-from-top-2">
                    <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-slate-300">Resultado ({sampleRate} Hz)</span>
                    </div>
                    <audio controls src={audioUrl} className="w-full h-10 rounded" autoPlay={autoGenerate} />
                    
                    <div className="flex justify-end pt-2 border-t border-slate-800/50">
                         <a 
                            href={audioUrl} 
                            download={`gemini_tts_${new Date().toISOString().slice(0,19).replace(/[-:T]/g, '')}.wav`}
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-lg transition-all shadow-lg shadow-indigo-900/20 hover:translate-y-[-1px]"
                        >
                            <Download className="w-4 h-4" />
                            Exportar como WAV
                        </a>
                    </div>
                </div>
            )}
        </div>
      </div>
    </div>
  );
};

// Helper function to convert AudioBuffer to WAV Blob
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArr = new ArrayBuffer(length);
  const view = new DataView(bufferArr);
  const channels = [];
  let i;
  let sample;
  let offset = 0;
  let pos = 0;

  // write WAVE header
  setUint32(0x46464952);                         // "RIFF"
  setUint32(length - 8);                         // file length - 8
  setUint32(0x45564157);                         // "WAVE"

  setUint32(0x20746d66);                         // "fmt " chunk
  setUint32(16);                                 // length = 16
  setUint16(1);                                  // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan);  // avg. bytes/sec
  setUint16(numOfChan * 2);                      // block-align
  setUint16(16);                                 // 16-bit (hardcoded in this example)

  setUint32(0x61746164);                         // "data" - chunk
  setUint32(length - pos - 4);                   // chunk length

  for(i = 0; i < buffer.numberOfChannels; i++)
    channels.push(buffer.getChannelData(i));

  while(pos < buffer.length) {
    for(i = 0; i < numOfChan; i++) {             // interleave channels
      sample = Math.max(-1, Math.min(1, channels[i][pos])); // clamp
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0; // scale to 16-bit signed int
      view.setInt16(44 + offset, sample, true);  // write 16-bit sample
      offset += 2;
    }
    pos++;
  }

  return new Blob([bufferArr], { type: 'audio/wav' });

  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }
}

export default TextToSpeech;