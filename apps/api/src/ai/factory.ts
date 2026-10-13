import { env } from '../config/env';
import { DocumentAIService } from './documentAiService';
import { ClaudeProvider } from './providers/claude';
import { GeminiProvider } from './providers/gemini';
import { TesseractOcr } from './providers/tesseract';

export function createDocumentAIService(): DocumentAIService {
  return new DocumentAIService(
    { GEMINI: new GeminiProvider(env.GEMINI_API_KEY), CLAUDE: new ClaudeProvider(env.CLAUDE_API_KEY) },
    new TesseractOcr(env.TESSERACT_PATH, env.PDFTOPPM_PATH, env.TESSERACT_LANG),
  );
}
