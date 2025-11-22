export enum AppMode {
  LIVE_CONVERSATION = 'LIVE_CONVERSATION',
  TEXT_TO_SPEECH = 'TEXT_TO_SPEECH',
}

export interface ChatLog {
  id: string;
  role: 'user' | 'model' | 'system';
  text: string;
  timestamp: number;
}

export interface VoiceConfig {
  name: string;
  languageCode: string; // informative only for UI
}
