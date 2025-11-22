import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { Mic, MicOff, Activity, Volume2, AlertCircle, Wifi, WifiOff, Loader2, RefreshCw, Download } from 'lucide-react';
import { 
  encodeBase64, 
  decodeBase64, 
  decodeAudioData, 
  floatTo16BitPCM,
  INPUT_SAMPLE_RATE, 
  OUTPUT_SAMPLE_RATE,
  getAudioContext
} from '../services/audioUtils';
import Visualizer from './Visualizer';

const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-09-2025';
const BUFFER_SIZE = 4096;

const LiveSession: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcription, setTranscription] = useState<string>('');
  
  // Refs for audio handling to avoid re-renders
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  
  // Optimization: Reusable buffers to avoid GC in audio loop
  const pcmBufferRef = useRef<Int16Array | null>(null);
  
  // Track if disconnect was requested by user to handle unexpected drops
  const isManualDisconnect = useRef<boolean>(false);

  // Optimization: Suspend input audio context when muted to save CPU
  useEffect(() => {
    if (inputContextRef.current && inputContextRef.current.state !== 'closed') {
      if (isMuted) {
        inputContextRef.current.suspend();
      } else {
        inputContextRef.current.resume();
      }
    }
  }, [isMuted]);

  const disconnect = useCallback(() => {
    isManualDisconnect.current = true;
    if (sessionRef.current) {
       try {
           sessionRef.current.close(); 
       } catch (e) { console.warn('Error closing session', e)}
    }
    
    sourcesRef.current.forEach(source => {
      try { source.stop(); } catch(e) {}
    });
    sourcesRef.current.clear();

    if (audioContextRef.current) audioContextRef.current.close();
    if (inputContextRef.current) inputContextRef.current.close();
    
    audioContextRef.current = null;
    inputContextRef.current = null;
    sessionRef.current = null;
    pcmBufferRef.current = null; // Reset buffer
    
    setIsConnected(false);
    setIsConnecting(false);
    // Note: We do NOT clear transcription here so user can export it
    nextStartTimeRef.current = 0;
  }, []);

  const connect = async () => {
    if (isConnecting) return;
    
    setError(null);
    setIsConnecting(true);
    isManualDisconnect.current = false;
    // Clear transcription on new connection
    setTranscription('');

    try {
      if (!process.env.API_KEY) {
        throw new Error("API Key não encontrada no ambiente.");
      }

      // Initialize Audio Contexts
      const inputCtx = getAudioContext(INPUT_SAMPLE_RATE);
      const outputCtx = getAudioContext(OUTPUT_SAMPLE_RATE);
      
      inputContextRef.current = inputCtx;
      audioContextRef.current = outputCtx;
      
      // Initialize Reusable PCM Buffer
      pcmBufferRef.current = new Int16Array(BUFFER_SIZE);

      // Setup Visualizers
      const inAnalyser = inputCtx.createAnalyser();
      inAnalyser.fftSize = 256;
      inputAnalyserRef.current = inAnalyser;
      
      const outAnalyser = outputCtx.createAnalyser();
      outAnalyser.fftSize = 256;
      outputAnalyserRef.current = outAnalyser;

      // Get Mic Stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = inputCtx.createMediaStreamSource(stream);
      const scriptProcessor = inputCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);
      
      source.connect(inAnalyser);
      inAnalyser.connect(scriptProcessor);
      scriptProcessor.connect(inputCtx.destination);

      // Optimization: Define processor logic outside callback to avoid closure re-creation
      scriptProcessor.onaudioprocess = (e) => {
        // Strict mute check to avoid ANY processing
        if (isMuted || !sessionRef.current) return;
        
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmBuffer = pcmBufferRef.current;

        if (pcmBuffer) {
            // Use optimized conversion to existing buffer
            floatTo16BitPCM(inputData, pcmBuffer);
            
            // Use optimized base64 encoding
            const base64Data = encodeBase64(new Uint8Array(pcmBuffer.buffer));
            
            // Send directly to the active session
            sessionRef.current.sendRealtimeInput({ 
                media: {
                    mimeType: 'audio/pcm;rate=16000',
                    data: base64Data
                }
            });
        }
      };

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      // Start Connection
      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        callbacks: {
          onopen: () => {
            console.log('Gemini Live Session Opened');
            setIsConnected(true);
            setIsConnecting(false);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Text Transcription
            if (message.serverContent?.modelTurn?.parts?.[0]?.text) {
                setTranscription(prev => prev + message.serverContent?.modelTurn?.parts?.[0]?.text);
            }

            // Handle Audio Output
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && outputCtx) {
              const audioBuffer = await decodeAudioData(
                decodeBase64(base64Audio),
                outputCtx,
                OUTPUT_SAMPLE_RATE
              );
              
              const bufferSource = outputCtx.createBufferSource();
              bufferSource.buffer = audioBuffer;
              
              // Connect to analyser for visualization then to destination
              bufferSource.connect(outAnalyser);
              outAnalyser.connect(outputCtx.destination);
              
              // Queueing logic
              const currentTime = outputCtx.currentTime;
              if (nextStartTimeRef.current < currentTime) {
                  nextStartTimeRef.current = currentTime;
              }
              
              bufferSource.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              
              sourcesRef.current.add(bufferSource);
              bufferSource.onended = () => sourcesRef.current.delete(bufferSource);
            }

            // Handle Interruption
            if (message.serverContent?.interrupted) {
              console.log('Model interrupted');
              sourcesRef.current.forEach(s => {
                  try { s.stop(); } catch(e) {}
              });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              // Optional: Add a marker in transcription for interruption
              setTranscription(prev => prev + "\n[Interrompido]\n");
            }
          },
          onclose: () => {
            console.log('Session closed');
            setIsConnected(false);
            setIsConnecting(false);
            if (!isManualDisconnect.current) {
                setError("Conexão perdida inesperadamente. Tente reconectar.");
            }
            // Clean up resources
            if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
                audioContextRef.current.close();
            }
            if (inputContextRef.current && inputContextRef.current.state !== 'closed') {
                inputContextRef.current.close();
            }
          },
          onerror: (err) => {
            console.error('Session error', err);
            setIsConnected(false);
            setIsConnecting(false);
            setError("Ocorreu um erro de conexão.");
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } }
          },
          systemInstruction: "Você é um assistente de tradução útil, espirituoso e poliglota. Você pode traduzir frases, discutir idiomas ou apenas conversar casualmente. Mantenha as respostas concisas. Fale principalmente em Português do Brasil.",
        }
      });

      // Store session in ref immediately when resolved so onAudioProcess can use it
      sessionRef.current = await sessionPromise;

    } catch (err: any) {
      console.error(err);
      setError(err.message || "Falha ao conectar");
      setIsConnected(false);
      setIsConnecting(false);
      
      // Cleanup on fail
      if (inputContextRef.current) inputContextRef.current.close();
      if (audioContextRef.current) audioContextRef.current.close();
    }
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
  };

  const handleDownloadTranscription = () => {
    if (!transcription) return;
    const blob = new Blob([transcription], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcricao-gemini-${new Date().toISOString().slice(0,10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Determinar a cor da borda e do status com base no estado atual
  let statusColor = "bg-slate-700 text-slate-400 border-slate-600";
  let borderColor = "border-slate-700";
  let shadowClass = "";
  let statusText = "Desconectado";
  let StatusIcon = WifiOff;

  if (isConnecting) {
      statusColor = "bg-amber-500/20 text-amber-400 border-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.1)]";
      borderColor = "border-amber-500/30";
      statusText = "Conectando...";
      StatusIcon = Loader2;
  } else if (error) {
      statusColor = "bg-red-500/20 text-red-400 border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.2)]";
      borderColor = "border-red-500/60";
      statusText = "Erro / Desconectado";
      StatusIcon = AlertCircle;
  } else if (isConnected) {
      statusColor = "bg-green-500/20 text-green-400 border-green-500/30 shadow-[0_0_10px_rgba(34,197,94,0.1)]";
      borderColor = "border-green-500/40";
      statusText = "Ao Vivo";
      StatusIcon = Wifi;
  }

  return (
    <div className="flex flex-col items-center w-full max-w-3xl mx-auto space-y-8 animate-fade-in">
      <div className={`relative w-full bg-slate-800 p-6 rounded-2xl shadow-xl transition-all duration-500 ${borderColor}`}>
        
        {/* Pulsing Border Overlay for Error State */}
        {error && (
            <div className="absolute inset-0 rounded-2xl border-2 border-red-500/50 animate-pulse pointer-events-none z-0"></div>
        )}

        {/* Header com Status Aprimorado */}
        <div className="relative z-10 flex justify-between items-center mb-8">
          <div className="flex items-center gap-3">
             <div className={`p-2 rounded-lg transition-colors duration-300 ${isConnected ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-700/50 text-slate-400'}`}>
                <Activity className={`w-6 h-6 ${isConnected ? 'animate-pulse' : ''}`} />
             </div>
             <div>
                <h2 className="text-xl font-bold text-white">Conversa ao Vivo</h2>
                <p className="text-xs text-slate-400 font-medium">Gemini 2.5 Flash Native Audio</p>
             </div>
          </div>
          
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full border transition-all duration-300 ${statusColor}`}>
            <StatusIcon className={`w-4 h-4 ${isConnecting ? 'animate-spin' : ''}`} />
            <span className="text-xs font-bold uppercase tracking-wider">{statusText}</span>
          </div>
        </div>

        {/* Visualizers & Error Overlay Area */}
        <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            
            {/* Error / Reconnect Overlay */}
            {!isConnected && !isConnecting && error && (
                <div className="absolute inset-0 z-30 bg-slate-900/85 backdrop-blur-sm rounded-xl flex flex-col items-center justify-center text-center p-6 border border-red-500/30 animate-in fade-in zoom-in-95 shadow-2xl">
                    <AlertCircle className="w-12 h-12 text-red-500 mb-3 drop-shadow-lg" />
                    <h3 className="text-lg font-bold text-white mb-1">Conexão Interrompida</h3>
                    <p className="text-sm text-slate-300 mb-4 max-w-xs">{error}</p>
                    <button 
                        onClick={connect}
                        className="flex items-center gap-2 px-5 py-2 bg-red-600 hover:bg-red-500 text-white rounded-full font-semibold transition-colors shadow-lg shadow-red-900/40 hover:shadow-red-900/60"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Reconectar Agora
                    </button>
                </div>
            )}

            {/* Input / Microphone Visualizer */}
            <div className="space-y-2 relative group">
                <div className="flex justify-between items-center">
                   <p className="text-xs text-slate-400 font-medium pl-1 flex items-center gap-1">
                      <Mic className="w-3 h-3" /> Entrada (Você)
                   </p>
                   {isMuted && isConnected && <span className="text-[10px] text-red-400 font-bold uppercase tracking-wider animate-pulse">Mudo</span>}
                </div>
                <div className="relative rounded-xl overflow-hidden bg-slate-900 border border-slate-700/50 shadow-inner">
                   <Visualizer analyser={inputAnalyserRef.current} isActive={isConnected && !isMuted} color="#f472b6" />
                   
                   {/* Mute Overlay */}
                   <div className={`absolute inset-0 bg-slate-900/80 backdrop-blur-[2px] flex items-center justify-center transition-opacity duration-300 ${isMuted && isConnected ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 rounded-full border border-slate-600 text-slate-300 shadow-xl">
                          <MicOff className="w-3 h-3" />
                          <span className="text-[10px] font-bold tracking-wider uppercase">Microfone Desativado</span>
                      </div>
                   </div>
                </div>
            </div>

            {/* Output / Model Visualizer */}
            <div className="space-y-2 relative">
                <p className="text-xs text-slate-400 font-medium pl-1 flex items-center gap-1">
                    <Volume2 className="w-3 h-3" /> Saída (Gemini)
                </p>
                <div className="relative rounded-xl overflow-hidden bg-slate-900 border border-slate-700/50 shadow-inner">
                    <Visualizer analyser={outputAnalyserRef.current} isActive={isConnected} color="#38bdf8" />
                </div>
            </div>
        </div>

        {/* Controls */}
        <div className="flex justify-center gap-6 items-center relative z-20">
          {!isConnected && !isConnecting ? (
            <button 
              onClick={connect}
              className="group relative inline-flex items-center justify-center px-8 py-4 text-lg font-bold text-white transition-all duration-200 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-full hover:from-blue-500 hover:to-indigo-500 focus:outline-none hover:shadow-lg hover:shadow-blue-500/25 hover:-translate-y-0.5 active:translate-y-0"
            >
               <Volume2 className="w-6 h-6 mr-2 group-hover:scale-110 transition-transform" />
               {error ? "Reconectar" : "Iniciar Chat ao Vivo"}
            </button>
          ) : isConnecting ? (
             <button disabled className="px-8 py-4 text-lg font-bold text-slate-400 bg-slate-800 rounded-full border border-slate-700 cursor-not-allowed flex items-center">
                 <Loader2 className="w-6 h-6 mr-2 animate-spin text-indigo-500" />
                 Conectando...
             </button>
          ) : (
             <>
                <button 
                  onClick={toggleMute}
                  className={`relative p-4 rounded-full transition-all duration-300 ${
                    isMuted 
                        ? 'bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500/20 ring-2 ring-transparent' 
                        : 'bg-white text-indigo-600 hover:bg-indigo-50 shadow-[0_0_20px_rgba(79,70,229,0.3)] hover:shadow-[0_0_30px_rgba(79,70,229,0.5)] hover:scale-105 ring-4 ring-indigo-500/10'
                  }`}
                >
                    {!isMuted && (
                        <span className="absolute inset-0 rounded-full animate-ping bg-indigo-500/20 duration-1000"></span>
                    )}
                    {isMuted ? <MicOff className="w-6 h-6 relative z-10" /> : <Mic className="w-6 h-6 relative z-10" />}
                </button>

                <button 
                  onClick={disconnect}
                  className="px-6 py-3 text-sm font-bold text-red-400 bg-red-500/5 rounded-full hover:bg-red-500/15 transition-all border border-red-500/10 hover:border-red-500/30"
                >
                  Encerrar
                </button>
             </>
          )}
        </div>

        <div className="mt-8 p-4 bg-slate-950/50 rounded-xl border border-slate-800/80 min-h-[100px] relative z-10">
            <div className="flex justify-between items-center mb-2">
                 <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Transcrição em Tempo Real</p>
                 <div className="flex items-center gap-3">
                    {transcription && (
                        <button 
                            onClick={handleDownloadTranscription}
                            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-indigo-400 hover:text-indigo-300 transition-colors bg-indigo-500/10 hover:bg-indigo-500/20 px-2 py-1 rounded border border-indigo-500/20"
                            title="Baixar Transcrição"
                        >
                            <Download className="w-3 h-3" />
                            Exportar TXT
                        </button>
                    )}
                    {isConnected && <div className="flex gap-1"><span className="w-1 h-1 rounded-full bg-green-500 animate-pulse"/><span className="w-1 h-1 rounded-full bg-green-500 animate-pulse delay-75"/><span className="w-1 h-1 rounded-full bg-green-500 animate-pulse delay-150"/></div>}
                 </div>
            </div>
            <p className="text-slate-300 text-sm leading-relaxed font-light max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                {transcription || <span className="text-slate-600 italic">A conversa aparecerá aqui...</span>}
            </p>
        </div>
      </div>

      <div className="text-center max-w-lg">
        <p className="text-slate-500 text-xs">
            Use fones de ouvido para evitar eco. A API Live oferece interação de baixa latência. <br/>
            <span className="text-slate-600">O modelo pode interromper se você começar a falar.</span>
        </p>
      </div>
    </div>
  );
};

export default LiveSession;